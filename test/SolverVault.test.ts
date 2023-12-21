import {expect} from "chai"
import {Signer, ZeroAddress} from "ethers"
import {ethers, upgrades} from "hardhat"

function decimal(n: number, decimal: bigint = 18n): bigint {
    return BigInt(n) * (10n ** decimal)
}

enum RequestStatus {
    Pending,
    Ready,
    Done
}

describe("SolverVault", function () {
    let solverVault: any, collateralToken: any, symmio: any, symmioWithDifferentCollateral: any, solverVaultToken: any
    let owner: Signer, user: Signer, depositor: Signer, balancer: Signer, receiver: Signer, setter: Signer,
        pauser: Signer, unpauser: Signer, solver: Signer, other: Signer
    let DEPOSITOR_ROLE, BALANCER_ROLE, MINTER_ROLE, PAUSER_ROLE, UNPAUSER_ROLE, SETTER_ROLE
    let collateralDecimals: bigint = 6n, solverVaultTokenDecimals: bigint = 8n
    const depositLimit = decimal(100000)

    async function mintFor(signer: Signer, amount: BigInt) {
        await collateralToken.connect(owner).mint(signer.getAddress(), amount)
        await collateralToken.connect(user).approve(await solverVault.getAddress(), amount)
    }

    function convertToVaultDecimals(depositAmount: bigint) {
        return solverVaultTokenDecimals >= collateralDecimals ?
            depositAmount * (10n ** (solverVaultTokenDecimals - collateralDecimals)) :
            depositAmount / 10n ** (collateralDecimals - solverVaultTokenDecimals)
    }

    beforeEach(async function () {
        [owner, user, depositor, balancer, receiver, setter, pauser, unpauser, solver, other] = await ethers.getSigners()

        const SolverVault = await ethers.getContractFactory("SolverVault")
        const MockERC20 = await ethers.getContractFactory("MockERC20")
        const Symmio = await ethers.getContractFactory("MockSymmio")

        collateralToken = await MockERC20.connect(owner).deploy(collateralDecimals)
        await collateralToken.waitForDeployment()

        symmio = await Symmio.deploy(await collateralToken.getAddress())
        await symmio.waitForDeployment()

        solverVaultToken = await MockERC20.deploy(solverVaultTokenDecimals)
        await solverVaultToken.waitForDeployment()

        symmioWithDifferentCollateral = await Symmio.deploy(await solverVaultToken.getAddress())
        await symmioWithDifferentCollateral.waitForDeployment()

        solverVault = await upgrades.deployProxy(SolverVault, [
            await symmio.getAddress(),
            await solverVaultToken.getAddress(),
            await solver.getAddress(),
            500000000000000000n, // 0.5,
            depositLimit,
        ])

        DEPOSITOR_ROLE = await solverVault.DEPOSITOR_ROLE()
        BALANCER_ROLE = await solverVault.BALANCER_ROLE()
        SETTER_ROLE = await solverVault.SETTER_ROLE()
        PAUSER_ROLE = await solverVault.PAUSER_ROLE()
        UNPAUSER_ROLE = await solverVault.UNPAUSER_ROLE()
        BALANCER_ROLE = await solverVault.BALANCER_ROLE()
        MINTER_ROLE = await solverVaultToken.MINTER_ROLE()

        await solverVault.connect(owner).grantRole(DEPOSITOR_ROLE, depositor.getAddress())
        await solverVault.connect(owner).grantRole(BALANCER_ROLE, balancer.getAddress())
        await solverVault.connect(owner).grantRole(SETTER_ROLE, setter.getAddress())
        await solverVault.connect(owner).grantRole(PAUSER_ROLE, pauser.getAddress())
        await solverVault.connect(owner).grantRole(UNPAUSER_ROLE, unpauser.getAddress())
        await solverVaultToken.connect(owner).grantRole(MINTER_ROLE, solverVault.getAddress())
    })

    describe("initialize", function () {
        it("should set initial values correctly", async function () {
            expect(await solverVault.symmio()).to.equal(await symmio.getAddress())
            expect(await solverVault.solverVaultTokenAddress()).to.equal(await solverVaultToken.getAddress())
        })

        it("Should fail to update collateral", async () => {
            await expect(solverVault.connect(owner).setSymmioAddress(await symmioWithDifferentCollateral.getAddress()))
                .to.be.revertedWith("SolverVault: Collateral can not be changed")
        })

        it("Should fail to set invalid solver", async () => {
            await expect(solverVault.connect(owner).setSolver(ZeroAddress))
                .to.be.revertedWith("SolverVault: Zero address")
            await expect(solverVault.connect(other).setSolver(await solver.getAddress())).to.be.reverted
        })

        it("Should fail to set symmioAddress", async () => {
            await expect(solverVault.connect(owner).setSymmioAddress(ZeroAddress))
                .to.be.revertedWith("SolverVault: Zero address")
            await expect(solverVault.connect(other).setSymmioAddress(await solver.getAddress())).to.be.reverted
        })

        it("Should pause/unpause with given roles", async () => {
            await solverVault.connect(pauser).pause()
            await solverVault.connect(unpauser).unpause()
            await expect(solverVault.connect(other).pause()).to.be.reverted
            await expect(solverVault.connect(other).unpause()).to.be.reverted
        })

        it("Should update deposit limit", async () => {
            await solverVault.connect(setter).setDepositLimit(1000)
            await expect(solverVault.connect(other).setDepositLimit(1000)).to.be.reverted
        })

    })


    describe("deposit", function () {
        const depositAmount = decimal(1, collateralDecimals)

        beforeEach(async function () {
            await mintFor(user, depositAmount)
        })

        it("should deposit tokens", async function () {
            await expect(solverVault.connect(user).deposit(depositAmount))
                .to.emit(solverVault, "Deposit")
                .withArgs(await user.getAddress(), depositAmount)
            let amountInSolverTokenDecimals = convertToVaultDecimals(depositAmount)
            expect(await solverVaultToken.balanceOf(await user.getAddress())).to.equal(amountInSolverTokenDecimals)
            expect(await collateralToken.balanceOf(await solverVault.getAddress())).to.equal(depositAmount)
            expect(await solverVault.currentDeposit()).to.equal(depositAmount)
        })

        it("should fail when is paused", async function () {
            await solverVault.connect(pauser).pause()
            await expect(solverVault.connect(user).deposit(depositAmount))
                .to.be.reverted
        })

        it("should fail if transfer fails", async function () {
            await expect(solverVault.connect(other).deposit(depositAmount)).to.be.reverted
        })

        it("should fail to deposit more than limit", async function () {
            await expect(solverVault.connect(user).deposit(depositLimit + 1n))
                .to.be.revertedWith("SolverVault: Deposit limit reached")
        })

        it("should update the current deposit amount", async function () {
            const amount = depositLimit - depositAmount + 1n

            await solverVault.connect(user).deposit(depositAmount)

            await expect(solverVault.connect(other).deposit(amount))
                .to.be.revertedWith("SolverVault: Deposit limit reached")

            let amountInSolverTokenDecimals = convertToVaultDecimals(depositAmount)

            await solverVaultToken.connect(user).approve(await solverVault.getAddress(), amountInSolverTokenDecimals)
            await solverVault.connect(user).requestWithdraw(amountInSolverTokenDecimals, await owner.getAddress())

            await mintFor(user, amount)
            await expect(solverVault.connect(user).deposit(amount))
                .to.not.be.reverted
        })
    })

    describe("depositToSymmio", function () {
        const depositAmount = decimal(500, collateralDecimals)

        beforeEach(async function () {
            await mintFor(user, depositAmount)
            await solverVault.connect(user).deposit(depositAmount)
        })

        it("should deposit to symmio", async function () {
            await expect(solverVault.connect(depositor).depositToSymmio(depositAmount))
                .to.emit(solverVault, "DepositToSymmio")
                .withArgs(await depositor.getAddress(), await solver.getAddress(), depositAmount)
            expect(await symmio.balanceOf(await solver.getAddress())).to.equal(depositAmount)
        })
        it("should fail when is paused", async function () {
            await solverVault.connect(pauser).pause()
            await expect(solverVault.connect(depositor).depositToSymmio(depositAmount))
                .to.be.reverted
        })

        it("should fail if not called by depositor role", async function () {
            await expect(solverVault.connect(other).depositToSymmio(depositAmount)).to.be.reverted
        })
    })

    describe("requestWithdraw", function () {
        const depositAmount = decimal(500, collateralDecimals)
        const withdrawAmountInCollateralDecimals = depositAmount
        const withdrawAmount = convertToVaultDecimals(depositAmount)

        beforeEach(async function () {
            await mintFor(user, depositAmount)
            await solverVault.connect(user).deposit(depositAmount)
            await solverVaultToken.connect(user).approve(await solverVault.getAddress(), withdrawAmount)
        })

        it("should request withdraw", async function () {
            const rec = await receiver.getAddress()
            await expect(solverVault.connect(user).requestWithdraw(withdrawAmount, rec))
                .to.emit(solverVault, "WithdrawRequestEvent")
                .withArgs(0, rec, withdrawAmountInCollateralDecimals)

            const request = await solverVault.withdrawRequests(0)
            expect(request[0]).to.equal(rec)
            expect(request[1]).to.equal(withdrawAmountInCollateralDecimals)
            expect(request[2]).to.equal(RequestStatus.Pending)
            expect(request[3]).to.equal(0n)
        })

        it("should fail when is paused", async function () {
            await solverVault.connect(pauser).pause()
            const rec = await receiver.getAddress()
            await expect(solverVault.connect(user).requestWithdraw(withdrawAmount, rec))
                .to.be.reverted
        })

        it("should fail if insufficient token balance", async function () {
            await expect(solverVault.connect(other).requestWithdraw(withdrawAmount, await receiver.getAddress())).to.be.reverted
        })

        describe("acceptWithdrawRequest", function () {
            const requestIds = [0]
            const paybackRatio = decimal(70, 16n)

            beforeEach(async function () {
                await solverVault.connect(user).requestWithdraw(withdrawAmount, await receiver.getAddress())
            })

            it("should fail on invalid Id", async function () {
                await expect(solverVault.connect(balancer).acceptWithdrawRequest(0, [5], paybackRatio))
                    .to.be.revertedWith("SolverVault: Invalid request ID")
            })

            it("should accept withdraw request", async function () {
                await expect(solverVault.connect(balancer).acceptWithdrawRequest(0, requestIds, paybackRatio))
                    .to.emit(solverVault, "WithdrawRequestAcceptedEvent")
                    .withArgs(0, requestIds, paybackRatio)
                const request = await solverVault.withdrawRequests(0)
                expect(request[2]).to.equal(RequestStatus.Ready)
                expect(await solverVault.lockedBalance()).to.equal(request.amount * paybackRatio / decimal(1))
            })

            it("should fail on invalid role", async function () {
                await expect(solverVault.connect(other).acceptWithdrawRequest(0, requestIds, paybackRatio))
                    .to.be.reverted
            })

            it("should fail when paused", async function () {
                await solverVault.connect(pauser).pause()
                await expect(solverVault.connect(balancer).acceptWithdrawRequest(0, requestIds, paybackRatio))
                    .to.be.reverted
            })

            it("should fail to accept already accepted request", async function () {
                await solverVault.connect(balancer).acceptWithdrawRequest(0, requestIds, paybackRatio)
                await expect(solverVault.connect(balancer).acceptWithdrawRequest(0, requestIds, paybackRatio))
                    .to.be.revertedWith("SolverVault: Invalid accepted request")
            })

            it("should accept withdraw request with provided amount", async function () {
                await solverVault.connect(depositor).depositToSymmio(depositAmount)
                await mintFor(balancer, depositAmount)
                await collateralToken.connect(balancer).approve(solverVault.getAddress(), depositAmount)
                await expect(solverVault.connect(balancer).acceptWithdrawRequest(depositAmount, requestIds, paybackRatio))
                    .to.emit(solverVault, "WithdrawRequestAcceptedEvent")
                    .withArgs(depositAmount, requestIds, paybackRatio)
                const request = await solverVault.withdrawRequests(0)
                expect(request[2]).to.equal(RequestStatus.Ready)
                expect(await solverVault.lockedBalance()).to.equal(request.amount * paybackRatio / decimal(1))
            })

            it("should fail to accept with insufficient balance", async function () {
                await solverVault.connect(depositor).depositToSymmio(depositAmount)
                await expect(solverVault.connect(balancer).acceptWithdrawRequest(0, requestIds, paybackRatio))
                    .to.be.revertedWith("SolverVault: Insufficient contract balance")
            })

            it("should fail if payback ratio is too low", async function () {
                await expect(solverVault.connect(balancer).acceptWithdrawRequest(0, requestIds, decimal(40, 16n)))
                    .to.be.revertedWith("SolverVault: Payback ratio is too low")
            })


            describe("claimForWithdrawRequest", function () {
                const requestId = 0
                let lockedBalance: bigint

                beforeEach(async function () {
                    solverVault.connect(balancer).acceptWithdrawRequest(0, requestIds, paybackRatio)
                    lockedBalance = (await solverVault.withdrawRequests(0)).amount * paybackRatio / decimal(1)
                })

                it("Should fail to deposit to symmio more than available", async function () {
                    await expect(solverVault.connect(depositor).depositToSymmio(depositAmount - lockedBalance + BigInt(1)))
                        .to.be.revertedWith("SolverVault: Insufficient contract balance")
                })

                it("should claim withdraw", async function () {
                    await expect(solverVault.connect(receiver).claimForWithdrawRequest(requestId))
                        .to.emit(solverVault, "WithdrawClaimedEvent")
                        .withArgs(requestId, await receiver.getAddress())
                    const request = await solverVault.withdrawRequests(0)
                    expect(request[2]).to.equal(RequestStatus.Done)
                })

                it("should fail when paused", async function () {
                    await solverVault.connect(pauser).pause()
                    await expect(solverVault.connect(receiver).claimForWithdrawRequest(requestId))
                        .to.be.reverted
                })

                it("should fail on invalid ID", async function () {
                    await expect(solverVault.connect(receiver).claimForWithdrawRequest(1)).to.be.revertedWith("SolverVault: Invalid request ID")
                })

                it("should fail if request is not ready", async function () {
                    await mintFor(user, depositAmount)
                    await solverVaultToken.connect(user).approve(await solverVault.getAddress(), withdrawAmount)
                    await solverVault.connect(user).deposit(depositAmount)
                    await solverVault.connect(user).requestWithdraw(withdrawAmount, await receiver.getAddress())
                    await expect(solverVault.connect(receiver).claimForWithdrawRequest(1)).to.be.revertedWith("SolverVault: Request not ready for withdrawal")
                })
            })
        })
    })
})
