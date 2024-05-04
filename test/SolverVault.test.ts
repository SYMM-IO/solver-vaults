import { expect } from "chai"
import { Signer, ZeroAddress } from "ethers"
import { ethers, upgrades } from "hardhat"
import { MockERC20, RasaOnChainSymmioDepositor } from "../typechain-types"

function decimal(n: number, decimal: bigint = 18n): bigint {
	return BigInt(n) * (10n ** decimal)
}

enum RequestStatus {
	Pending,
	Ready,
	Done,
	Canceled
}

describe("SymmioSolverDepositor", function () {
	let symmioDepositor: RasaOnChainSymmioDepositor,
		collateralToken: any,
		collateralToken2: any,
		symmio: any,
		symmioWithDifferentCollateral: any,
		lpToken: MockERC20
	let owner: Signer, user: Signer, depositorUser: Signer, balancer: Signer, receiver: Signer, setter: Signer,
		pauser: Signer, unpauser: Signer, solver: Signer, other: Signer
	let collateralDecimals = 6n
	let DEPOSITOR_ROLE, BALANCER_ROLE, MINTER_ROLE, PAUSER_ROLE, UNPAUSER_ROLE, SETTER_ROLE
	const depositLimit = decimal(100000)

	async function mintFor(signer: Signer, amount: BigInt) {
		await collateralToken.connect(owner).mint(signer.getAddress(), amount)
		await collateralToken.connect(signer).approve(await symmioDepositor.getAddress(), amount)
	}

	beforeEach(async function () {
		[owner, user, depositorUser, balancer, receiver, setter, pauser, unpauser, solver, other] = await ethers.getSigners()

		const SymmioSolverDepositor = await ethers.getContractFactory("RasaOnChainSymmioDepositor")
		const MockERC20 = await ethers.getContractFactory("MockERC20")
		const Symmio = await ethers.getContractFactory("MockSymmio")

		collateralToken = await MockERC20.connect(owner).deploy(collateralDecimals)
		await collateralToken.waitForDeployment()

		collateralToken2 = await MockERC20.connect(owner).deploy(collateralDecimals + 1n)
		await collateralToken2.waitForDeployment()

		symmio = await Symmio.deploy(await collateralToken.getAddress())
		await symmio.waitForDeployment()

		lpToken = await MockERC20.deploy(collateralDecimals)
		await lpToken.waitForDeployment()

		symmioWithDifferentCollateral = await Symmio.deploy(await lpToken.getAddress())
		await symmioWithDifferentCollateral.waitForDeployment()

		symmioDepositor = await upgrades.deployProxy(SymmioSolverDepositor, [
			await symmio.getAddress(),
			await lpToken.getAddress(),
			500000000000000000n, // 0.5,
			depositLimit,
			await solver.getAddress(),
		]) as any

		DEPOSITOR_ROLE = await symmioDepositor.DEPOSITOR_ROLE()
		BALANCER_ROLE = await symmioDepositor.BALANCER_ROLE()
		SETTER_ROLE = await symmioDepositor.SETTER_ROLE()
		PAUSER_ROLE = await symmioDepositor.PAUSER_ROLE()
		UNPAUSER_ROLE = await symmioDepositor.UNPAUSER_ROLE()
		BALANCER_ROLE = await symmioDepositor.BALANCER_ROLE()
		MINTER_ROLE = await lpToken.MINTER_ROLE()

		await symmioDepositor.connect(owner).grantRole(DEPOSITOR_ROLE, depositorUser.getAddress())
		await symmioDepositor.connect(owner).grantRole(BALANCER_ROLE, balancer.getAddress())
		await symmioDepositor.connect(owner).grantRole(SETTER_ROLE, setter.getAddress())
		await symmioDepositor.connect(owner).grantRole(PAUSER_ROLE, pauser.getAddress())
		await symmioDepositor.connect(owner).grantRole(UNPAUSER_ROLE, unpauser.getAddress())
		await lpToken.connect(owner).grantRole(MINTER_ROLE, symmioDepositor.getAddress())
	})

	describe("initialize", function () {
		it("should set initial values correctly", async function () {
			expect(await symmioDepositor.symmio()).to.equal(await symmio.getAddress())
			expect(await symmioDepositor.lpTokenAddress()).to.equal(await lpToken.getAddress())
		})

		it("Should fail to update collateral", async () => {
			await expect(symmioDepositor.connect(owner).setSymmioAddress(await symmioWithDifferentCollateral.getAddress()))
				.to.be.revertedWith("SymmioSolverDepositor: Collateral can not be changed")
		})

		it("Should fail to set invalid solver", async () => {
			await expect(symmioDepositor.connect(owner).setSolver(ZeroAddress))
				.to.be.revertedWith("SymmioSolverDepositor: Zero address")
			await expect(symmioDepositor.connect(other).setSolver(await solver.getAddress())).to.be.reverted
		})

		it("Should fail to set symmioAddress", async () => {
			await expect(symmioDepositor.connect(owner).setSymmioAddress(ZeroAddress))
				.to.be.revertedWith("SymmioSolverDepositor: Zero address")
			await expect(symmioDepositor.connect(other).setSymmioAddress(await solver.getAddress())).to.be.reverted
		})

		it("Should fail to change collateral", async () => {
			await expect(symmioDepositor.connect(setter).setSymmioAddress(await symmioWithDifferentCollateral.getAddress()))
				.to.be.revertedWith("SymmioSolverDepositor: Collateral can not be changed")
		})

		it("Should pause/unpause with given roles", async () => {
			await symmioDepositor.connect(pauser).pause()
			await symmioDepositor.connect(unpauser).unpause()
			await expect(symmioDepositor.connect(other).pause()).to.be.reverted
			await expect(symmioDepositor.connect(other).unpause()).to.be.reverted
		})

		it("Should update deposit limit", async () => {
			await symmioDepositor.connect(setter).setDepositLimit(1000)
			await expect(symmioDepositor.connect(other).setDepositLimit(1000)).to.be.reverted
		})

	})


	describe("deposit", function () {
		const depositAmount = decimal(1, collateralDecimals)

		beforeEach(async function () {
			await mintFor(user, depositAmount)
		})

		it("should deposit tokens", async function () {
			await expect(symmioDepositor.connect(user).deposit(depositAmount))
				.to.emit(symmioDepositor, "Deposit")
				.withArgs(await user.getAddress(), depositAmount)
			expect(await lpToken.balanceOf(await user.getAddress())).to.equal(depositAmount)
			expect(await collateralToken.balanceOf(await symmioDepositor.getAddress())).to.equal(depositAmount)
			expect(await symmioDepositor.currentDeposit()).to.equal(depositAmount)
		})

		it("should fail when is paused", async function () {
			await symmioDepositor.connect(pauser).pause()
			await expect(symmioDepositor.connect(user).deposit(depositAmount)).to.be.reverted
		})

		it("should fail if transfer fails", async function () {
			await expect(symmioDepositor.connect(other).deposit(depositAmount)).to.be.reverted
		})

		it("should fail to deposit more than limit", async function () {
			await expect(symmioDepositor.connect(user).deposit(depositLimit + 1n))
				.to.be.revertedWith("SymmioSolverDepositor: Deposit limit reached")
		})

		it("should update the current deposit amount", async function () {
			const amount = depositLimit - depositAmount + 1n

			await symmioDepositor.connect(user).deposit(depositAmount)
			await expect(symmioDepositor.connect(other).deposit(amount))
				.to.be.revertedWith("SymmioSolverDepositor: Deposit limit reached")

			await lpToken.connect(user).approve(await symmioDepositor.getAddress(), depositAmount)
			await symmioDepositor.connect(user).requestWithdraw(depositAmount, 0, await owner.getAddress())
			await symmioDepositor.connect(balancer).acceptWithdrawRequest(0, [0], decimal(5, 17n))

			await mintFor(user, amount)
			await expect(symmioDepositor.connect(user).deposit(amount)).to.not.be.reverted
		})
	})

	describe("depositToSymmio", function () {
		const depositAmount = decimal(500, collateralDecimals)

		beforeEach(async function () {
			await mintFor(user, depositAmount)
			await symmioDepositor.connect(user).deposit(depositAmount)
		})

		it("should deposit to symmio", async function () {
			await expect(symmioDepositor.connect(depositorUser).depositToSymmio(depositAmount))
				.to.emit(symmioDepositor, "DepositToSymmio")
				.withArgs(await depositorUser.getAddress(), await solver.getAddress(), depositAmount)
			expect(await symmio.balanceOf(await solver.getAddress())).to.equal(depositAmount)
		})

		it("should fail when is paused", async function () {
			await symmioDepositor.connect(pauser).pause()
			await expect(symmioDepositor.connect(depositorUser).depositToSymmio(depositAmount))
				.to.be.reverted
		})

		it("should fail if not called by depositor role", async function () {
			await expect(symmioDepositor.connect(other).depositToSymmio(depositAmount)).to.be.reverted
		})
	})

	describe("requestWithdraw", function () {
		const depositAmount = decimal(500, collateralDecimals)
		const withdrawAmount = decimal(300, collateralDecimals)

		beforeEach(async function () {
			await mintFor(user, depositAmount)
			await symmioDepositor.connect(user).deposit(depositAmount)
			await lpToken.connect(user).approve(await symmioDepositor.getAddress(), withdrawAmount)
		})

		it("should request withdraw", async function () {
			const rec = await receiver.getAddress()
			const sender = await user.getAddress()
			await expect(symmioDepositor.connect(user).requestWithdraw(withdrawAmount, withdrawAmount, rec))
				.to.emit(symmioDepositor, "WithdrawRequestEvent")
				.withArgs(0, sender, rec, withdrawAmount)

			const request = await symmioDepositor.withdrawRequests(0)
			expect(request[0]).to.equal(rec)
			expect(request[1]).to.equal(sender)
			expect(request[2]).to.equal(withdrawAmount)
			expect(request[3]).to.equal(withdrawAmount)
			expect(request[4]).to.equal(RequestStatus.Pending)
			expect(request[5]).to.equal(0n)

			expect(await symmioDepositor.currentDeposit()).to.be.eq(depositAmount)
			expect(await lpToken.balanceOf(await user.getAddress())).to.equal(depositAmount - withdrawAmount)
			expect(await collateralToken.balanceOf(await symmioDepositor.getAddress())).to.equal(depositAmount)
		})

		it("should fail when is paused", async function () {
			await symmioDepositor.connect(pauser).pause()
			const rec = await receiver.getAddress()
			await expect(symmioDepositor.connect(user).requestWithdraw(withdrawAmount, withdrawAmount, rec))
				.to.be.reverted
		})

		it("should fail if insufficient token balance", async function () {
			await expect(symmioDepositor.connect(other).requestWithdraw(withdrawAmount, withdrawAmount, await receiver.getAddress())).to.be.reverted
		})

		describe("cancelWithdrawRequest", async function () {
			beforeEach(async function () {
				await symmioDepositor.connect(user).requestWithdraw(withdrawAmount, withdrawAmount, await receiver.getAddress())
			})

			it("should cancel withdraw", async function () {
				await expect(symmioDepositor.connect(user).cancelWithdrawRequest(0))
					.to.emit(symmioDepositor, "WithdrawRequestCanceled")
					.withArgs(0)
				const request = await symmioDepositor.withdrawRequests(0)
				expect(request[4]).to.equal(RequestStatus.Canceled)
				expect(await symmioDepositor.currentDeposit()).to.be.eq(depositAmount)
				expect(await lpToken.balanceOf(await user.getAddress())).to.equal(depositAmount)
				expect(await collateralToken.balanceOf(await symmioDepositor.getAddress())).to.equal(depositAmount)
			})
		})

		describe("acceptWithdrawRequest", function () {
			const requestIds = [0]
			const paybackRatio = decimal(70, 16n)
			const minAmountOut = withdrawAmount * 6n / 10n

			beforeEach(async function () {
				await symmioDepositor.connect(user).requestWithdraw(withdrawAmount, minAmountOut, await receiver.getAddress())
			})

			it("should fail on invalid Id", async function () {
				await expect(symmioDepositor.connect(balancer).acceptWithdrawRequest(0, [5], paybackRatio))
					.to.be.revertedWith("SymmioSolverDepositor: Invalid request ID")
			})

			it("should accept withdraw request", async function () {
				await expect(symmioDepositor.connect(balancer).acceptWithdrawRequest(0, requestIds, paybackRatio))
					.to.emit(symmioDepositor, "WithdrawRequestAcceptedEvent")
					.withArgs(0, requestIds, paybackRatio)
				const request = await symmioDepositor.withdrawRequests(0)
				expect(request[4]).to.equal(RequestStatus.Ready)
				expect(await symmioDepositor.lockedBalance()).to.equal(request.amount * paybackRatio / decimal(1))
			})

			it("should fail on lower than minAmountOut", async function () {
				await expect(symmioDepositor.connect(balancer).acceptWithdrawRequest(0, requestIds, decimal(55, 16n)))
					.to.be.revertedWith("SymmioSolverDepositor: Payback ratio is too low for this request")
			})

			it("should fail on invalid role", async function () {
				await expect(symmioDepositor.connect(other).acceptWithdrawRequest(0, requestIds, paybackRatio))
					.to.be.reverted
			})

			it("should fail when paused", async function () {
				await symmioDepositor.connect(pauser).pause()
				await expect(symmioDepositor.connect(balancer).acceptWithdrawRequest(0, requestIds, paybackRatio))
					.to.be.reverted
			})

			it("should fail to accept already accepted request", async function () {
				await symmioDepositor.connect(balancer).acceptWithdrawRequest(0, requestIds, paybackRatio)
				await expect(symmioDepositor.connect(balancer).acceptWithdrawRequest(0, requestIds, paybackRatio))
					.to.be.revertedWith("SymmioSolverDepositor: Invalid accepted request")
			})

			it("should accept withdraw request with provided amount", async function () {
				await symmioDepositor.connect(depositorUser).depositToSymmio(depositAmount)
				await mintFor(balancer, depositAmount)
				await collateralToken.connect(balancer).approve(symmioDepositor.getAddress(), depositAmount)
				await expect(symmioDepositor.connect(balancer).acceptWithdrawRequest(depositAmount, requestIds, paybackRatio))
					.to.emit(symmioDepositor, "WithdrawRequestAcceptedEvent")
					.withArgs(depositAmount, requestIds, paybackRatio)
				const request = await symmioDepositor.withdrawRequests(0)
				expect(request[4]).to.equal(RequestStatus.Ready)
				expect(await symmioDepositor.lockedBalance()).to.equal(request.amount * paybackRatio / decimal(1))
			})

			it("should fail to accept with insufficient balance", async function () {
				await symmioDepositor.connect(depositorUser).depositToSymmio(depositAmount)
				await expect(symmioDepositor.connect(balancer).acceptWithdrawRequest(0, requestIds, paybackRatio))
					.to.be.revertedWith("SymmioSolverDepositor: Insufficient contract balance")
			})

			it("should fail if payback ratio is too low", async function () {
				await expect(symmioDepositor.connect(balancer).acceptWithdrawRequest(0, requestIds, decimal(40, 16n)))
					.to.be.revertedWith("SymmioSolverDepositor: Payback ratio is too low")
			})


			describe("claimForWithdrawRequest", function () {
				const requestId = 0
				let lockedBalance: bigint

				beforeEach(async function () {
					symmioDepositor.connect(balancer).acceptWithdrawRequest(0, requestIds, paybackRatio)
					lockedBalance = (await symmioDepositor.withdrawRequests(0)).amount * paybackRatio / decimal(1)
				})

				it("Should fail to deposit to symmio more than available", async function () {
					await expect(symmioDepositor.connect(depositorUser).depositToSymmio(depositAmount - lockedBalance + BigInt(1)))
						.to.be.revertedWith("SymmioSolverDepositor: Insufficient contract balance")
				})

				it("should claim withdraw", async function () {
					await expect(symmioDepositor.connect(receiver).claimForWithdrawRequest(requestId))
						.to.emit(symmioDepositor, "WithdrawClaimedEvent")
						.withArgs(requestId, await receiver.getAddress())
					const request = await symmioDepositor.withdrawRequests(0)
					expect(request[4]).to.equal(RequestStatus.Done)
				})

				it("should fail when paused", async function () {
					await symmioDepositor.connect(pauser).pause()
					await expect(symmioDepositor.connect(receiver).claimForWithdrawRequest(requestId))
						.to.be.reverted
				})

				it("should fail on invalid ID", async function () {
					await expect(symmioDepositor.connect(receiver).claimForWithdrawRequest(1)).to.be.revertedWith("SymmioSolverDepositor: Invalid request ID")
				})

				it("should fail if request is not ready", async function () {
					await mintFor(user, depositAmount)
					await lpToken.connect(user).approve(await symmioDepositor.getAddress(), withdrawAmount)
					await symmioDepositor.connect(user).deposit(depositAmount)
					await symmioDepositor.connect(user).requestWithdraw(withdrawAmount, withdrawAmount, await receiver.getAddress())
					await expect(symmioDepositor.connect(receiver).claimForWithdrawRequest(1)).to.be.revertedWith("SymmioSolverDepositor: Request not ready for withdrawal")
				})
			})
		})
	})
})
