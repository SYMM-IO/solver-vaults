import {expect} from "chai";
import {Signer} from "ethers";
import {ethers, upgrades} from "hardhat";

function decimal(n: number, decimal: bigint = 18n): bigint {
    return BigInt(n) * (10n ** decimal)
}

enum RequestStatus {
    Pending,
    Ready,
    Done
}

describe("SolverVault", function () {
    let solverVault: any, collateralToken: any, symmio: any, solverVaultToken: any;
    let owner: Signer, depositor: Signer, balancer: Signer, receiver: Signer, other: Signer;
    let DEPOSITOR_ROLE, BALANCER_ROLE, MINTER_ROLE;
    let collateralDecimals: bigint = 6n, solverVaultTokenDecimals: bigint = 8n;

    beforeEach(async function () {
        [owner, depositor, balancer, receiver, other] = await ethers.getSigners();

        const SolverVault = await ethers.getContractFactory("SolverVault");
        const CollateralToken = await ethers.getContractFactory("MockERC20");
        const Symmio = await ethers.getContractFactory("MockSymmio");
        const SolverVaultToken = await ethers.getContractFactory("MockERC20");

        collateralToken = await CollateralToken.connect(owner).deploy(collateralDecimals);
        await collateralToken.waitForDeployment();

        symmio = await Symmio.deploy(await collateralToken.getAddress());
        await symmio.waitForDeployment();

        solverVaultToken = await SolverVaultToken.deploy(solverVaultTokenDecimals);
        await solverVaultToken.waitForDeployment();

        solverVault = await upgrades.deployProxy(SolverVault, [
            await symmio.getAddress(),
            await solverVaultToken.getAddress(),
            500000000000000000n // 0.5
        ]);


        DEPOSITOR_ROLE = await solverVault.DEPOSITOR_ROLE();
        BALANCER_ROLE = await solverVault.BALANCER_ROLE();
        MINTER_ROLE = await solverVaultToken.MINTER_ROLE();

        await solverVault.connect(owner).grantRole(DEPOSITOR_ROLE, depositor.getAddress());
        await solverVault.connect(owner).grantRole(BALANCER_ROLE, balancer.getAddress());
        await solverVaultToken.connect(owner).grantRole(MINTER_ROLE, solverVault.getAddress());
    });

    describe("initialize", function () {
        it("should set initial values correctly", async function () {
            expect(await solverVault.symmio()).to.equal(await symmio.getAddress());
            expect(await solverVault.symmioVaultToken()).to.equal(await solverVaultToken.getAddress());
        });
    });

    describe("deposit", function () {
        const depositAmount = decimal(1, collateralDecimals);

        beforeEach(async function () {
            await collateralToken.connect(owner).mint(depositor.getAddress(), depositAmount);
            await collateralToken.connect(depositor).approve(await solverVault.getAddress(), depositAmount);
        });

        it("should deposit tokens", async function () {
            await expect(solverVault.connect(depositor).deposit(depositAmount))
                .to.emit(solverVault, "Deposit")
                .withArgs(await depositor.getAddress(), depositAmount);
            let amountInCollateralDecimals = solverVaultTokenDecimals >= collateralDecimals ?
                depositAmount * (10n ** (solverVaultTokenDecimals - collateralDecimals)) :
                depositAmount / 10n ** (collateralDecimals - solverVaultTokenDecimals);
            expect(await solverVaultToken.balanceOf(await depositor.getAddress())).to.equal(amountInCollateralDecimals);
            expect(await collateralToken.balanceOf(await solverVault.getAddress())).to.equal(depositAmount);
        });

        it("should fail if transfer fails", async function () {
            await expect(solverVault.connect(other).deposit(depositAmount)).to.be.reverted;
        });
    });

    describe("depositToSymmio", function () {
        const depositAmount = decimal(500);

        beforeEach(async function () {
            await collateralToken.connect(owner).mint(await depositor.getAddress(), depositAmount);
            await collateralToken.connect(depositor).approve(await solverVault.getAddress(), depositAmount);
            await solverVault.connect(depositor).deposit(depositAmount);
        });

        it("should deposit to symmio", async function () {
            await expect(solverVault.connect(depositor).depositToSymmio(depositAmount, await other.getAddress()))
                .to.emit(solverVault, "DepositToSymmio")
                .withArgs(await depositor.getAddress(), await other.getAddress(), depositAmount);
            expect(await symmio.balanceOf(await other.getAddress())).to.equal(depositAmount);
        });

        it("should fail if not called by depositor role", async function () {
            await expect(solverVault.connect(other).depositToSymmio(depositAmount, await other.getAddress())).to.be.reverted;
        });
    });

    describe("requestWithdraw", function () {
        const depositAmount = decimal(500, collateralDecimals);
        const withdrawAmountInCollateralDecimals = depositAmount;
        const withdrawAmount = collateralDecimals >= solverVaultTokenDecimals ?
            depositAmount * (10n ** (collateralDecimals - solverVaultTokenDecimals)) :
            depositAmount / 10n ** (solverVaultTokenDecimals - collateralDecimals);

        beforeEach(async function () {
            await collateralToken.connect(owner).mint(await depositor.getAddress(), depositAmount);
            await collateralToken.connect(depositor).approve(await solverVault.getAddress(), depositAmount);

            await solverVaultToken.connect(depositor).approve(await solverVault.getAddress(), withdrawAmount);
            await solverVault.connect(depositor).deposit(depositAmount);
        });

        it("should request withdraw", async function () {
            const rec = await receiver.getAddress();
            await expect(solverVault.connect(depositor).requestWithdraw(withdrawAmount, rec))
                .to.emit(solverVault, "WithdrawRequestEvent")
                .withArgs(0, rec, withdrawAmountInCollateralDecimals);

            const request = await solverVault.withdrawRequests(0);
            expect(request[0]).to.equal(rec);
            expect(request[1]).to.equal(withdrawAmountInCollateralDecimals);
            expect(request[2]).to.equal(RequestStatus.Pending);
            expect(request[3]).to.equal(0n);
        });

        it("should fail if insufficient token balance", async function () {
            await expect(solverVault.connect(other).requestWithdraw(withdrawAmount, await receiver.getAddress())).to.be.reverted;
        });

        describe("acceptWithdrawRequest", function () {
            const requestIds = [0];
            const paybackRatio = decimal(70, 16n);

            beforeEach(async function () {
                await solverVault.connect(depositor).requestWithdraw(withdrawAmount, await receiver.getAddress());
            })

            it("should accept withdraw request", async function () {
                await expect(solverVault.connect(balancer).acceptWithdrawRequest(requestIds, paybackRatio))
                    .to.emit(solverVault, "WithdrawRequestAcceptedEvent")
                    .withArgs(requestIds, paybackRatio);
                const request = await solverVault.withdrawRequests(0);
                expect(request[2]).to.equal(RequestStatus.Ready);
                expect(await solverVault.lockedBalance()).to.equal(request.amount * paybackRatio / decimal(1));
            });

            it("should fail if payback ratio is too low", async function () {
                await expect(solverVault.connect(balancer).acceptWithdrawRequest(requestIds, decimal(40, 16n)))
                    .to.be.revertedWith("SolverVault: Payback ratio is too low");
            });


            describe("claimForWithdrawRequest", function () {
                const requestId = 0;
                let lockedBalance: bigint;

                beforeEach(async function () {
                    solverVault.connect(balancer).acceptWithdrawRequest(requestIds, paybackRatio);
                    lockedBalance = (await solverVault.withdrawRequests(0)).amount * paybackRatio / decimal(1);
                })

                it("Should fail to deposit to symmio more than available", async function () {
                    await expect(solverVault.connect(depositor).depositToSymmio(depositAmount - lockedBalance + BigInt(1), await other.getAddress()))
                        .to.be.revertedWith("SolverVault: Insufficient contract balance")
                })

                it("should claim withdraw", async function () {
                    await expect(solverVault.connect(receiver).claimForWithdrawRequest(requestId))
                        .to.emit(solverVault, "WithdrawClaimedEvent")
                        .withArgs(requestId, await receiver.getAddress());
                    const request = await solverVault.withdrawRequests(0);
                    expect(request[2]).to.equal(RequestStatus.Done);
                });

                it("should fail on invalid ID", async function () {
                    await expect(solverVault.connect(receiver).claimForWithdrawRequest(1)).to.be.revertedWith("SolverVault: Invalid request ID");
                });

                it("should fail if request is not ready", async function () {
                    await collateralToken.connect(owner).mint(await depositor.getAddress(), depositAmount);
                    await collateralToken.connect(depositor).approve(await solverVault.getAddress(), depositAmount);
                    await solverVaultToken.connect(depositor).approve(await solverVault.getAddress(), withdrawAmount);
                    await solverVault.connect(depositor).deposit(depositAmount);
                    await solverVault.connect(depositor).requestWithdraw(withdrawAmount, await receiver.getAddress());
                    await expect(solverVault.connect(receiver).claimForWithdrawRequest(1)).to.be.revertedWith("SolverVault: Request not ready for withdrawal");
                });
            });
        });
    });
});
