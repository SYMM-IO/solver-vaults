import {expect} from "chai"
import {Signer, ZeroAddress} from "ethers"
import {ethers, upgrades} from "hardhat"
import {SymmioSolverDepositor} from "../typechain-types"

function decimal(n: number, decimal: bigint = 18n): bigint {
	return BigInt(n) * (10n ** decimal)
}

enum RequestStatus {
	Pending,
	Ready,
	Done
}

describe("SymmioSolverDepositor", function () {
	let symmioSolverDepositor: SymmioSolverDepositor, collateralToken: any, symmio: any,
		symmioWithDifferentCollateral: any,
		lpToken: any
	let owner: Signer, user: Signer, depositor: Signer, balancer: Signer, receiver: Signer, setter: Signer,
		pauser: Signer, unpauser: Signer, solver: Signer, other: Signer
	let DEPOSITOR_ROLE, BALANCER_ROLE, MINTER_ROLE, PAUSER_ROLE, UNPAUSER_ROLE, SETTER_ROLE
	let collateralDecimals: bigint = 8n, symmioSolverDepositorTokenDecimals: bigint = 8n
	const depositLimit = decimal(100000)

	async function mintFor(signer: Signer, amount: BigInt) {
		await collateralToken.connect(owner).mint(signer.getAddress(), amount)
		await collateralToken.connect(user).approve(await symmioSolverDepositor.getAddress(), amount)
	}

	function convertToDepositorDecimals(depositAmount: bigint) {
		return symmioSolverDepositorTokenDecimals >= collateralDecimals ?
			depositAmount * (10n ** (symmioSolverDepositorTokenDecimals - collateralDecimals)) :
			depositAmount / 10n ** (collateralDecimals - symmioSolverDepositorTokenDecimals)
	}

	beforeEach(async function () {
		[owner, user, depositor, balancer, receiver, setter, pauser, unpauser, solver, other] = await ethers.getSigners()

		const SymmioSolverDepositor = await ethers.getContractFactory("SymmioSolverDepositor")
		const MockERC20 = await ethers.getContractFactory("MockERC20")
		const Symmio = await ethers.getContractFactory("MockSymmio")

		collateralToken = await MockERC20.connect(owner).deploy(collateralDecimals)
		await collateralToken.waitForDeployment()

		symmio = await Symmio.deploy(await collateralToken.getAddress())
		await symmio.waitForDeployment()

		lpToken = await MockERC20.deploy(symmioSolverDepositorTokenDecimals)
		await lpToken.waitForDeployment()

		symmioWithDifferentCollateral = await Symmio.deploy(await lpToken.getAddress())
		await symmioWithDifferentCollateral.waitForDeployment()

		symmioSolverDepositor = await upgrades.deployProxy(SymmioSolverDepositor, [
			await symmio.getAddress(),
			await lpToken.getAddress(),
			await solver.getAddress(),
			500000000000000000n, // 0.5,
			depositLimit,
		]) as any

		DEPOSITOR_ROLE = await symmioSolverDepositor.DEPOSITOR_ROLE()
		BALANCER_ROLE = await symmioSolverDepositor.BALANCER_ROLE()
		SETTER_ROLE = await symmioSolverDepositor.SETTER_ROLE()
		PAUSER_ROLE = await symmioSolverDepositor.PAUSER_ROLE()
		UNPAUSER_ROLE = await symmioSolverDepositor.UNPAUSER_ROLE()
		BALANCER_ROLE = await symmioSolverDepositor.BALANCER_ROLE()
		MINTER_ROLE = await lpToken.MINTER_ROLE()

		await symmioSolverDepositor.connect(owner).grantRole(DEPOSITOR_ROLE, depositor.getAddress())
		await symmioSolverDepositor.connect(owner).grantRole(BALANCER_ROLE, balancer.getAddress())
		await symmioSolverDepositor.connect(owner).grantRole(SETTER_ROLE, setter.getAddress())
		await symmioSolverDepositor.connect(owner).grantRole(PAUSER_ROLE, pauser.getAddress())
		await symmioSolverDepositor.connect(owner).grantRole(UNPAUSER_ROLE, unpauser.getAddress())
		await lpToken.connect(owner).grantRole(MINTER_ROLE, symmioSolverDepositor.getAddress())
	})

	describe("initialize", function () {
		it("should set initial values correctly", async function () {
			expect(await symmioSolverDepositor.symmio()).to.equal(await symmio.getAddress())
			expect(await symmioSolverDepositor.lpTokenAddress()).to.equal(await lpToken.getAddress())
		})

		it("Should fail to update collateral", async () => {
			await expect(symmioSolverDepositor.connect(owner).setSymmioAddress(await symmioWithDifferentCollateral.getAddress()))
				.to.be.revertedWith("SymmioSolverDepositor: Collateral can not be changed")
		})

		it("Should fail to set invalid solver", async () => {
			await expect(symmioSolverDepositor.connect(owner).setSolver(ZeroAddress))
				.to.be.revertedWith("SymmioSolverDepositor: Zero address")
			await expect(symmioSolverDepositor.connect(other).setSolver(await solver.getAddress())).to.be.reverted
		})

		it("Should fail to set symmioAddress", async () => {
			await expect(symmioSolverDepositor.connect(owner).setSymmioAddress(ZeroAddress))
				.to.be.revertedWith("SymmioSolverDepositor: Zero address")
			await expect(symmioSolverDepositor.connect(other).setSymmioAddress(await solver.getAddress())).to.be.reverted
		})

		it("Should pause/unpause with given roles", async () => {
			await symmioSolverDepositor.connect(pauser).pause()
			await symmioSolverDepositor.connect(unpauser).unpause()
			await expect(symmioSolverDepositor.connect(other).pause()).to.be.reverted
			await expect(symmioSolverDepositor.connect(other).unpause()).to.be.reverted
		})

		it("Should update deposit limit", async () => {
			await symmioSolverDepositor.connect(setter).setDepositLimit(1000)
			await expect(symmioSolverDepositor.connect(other).setDepositLimit(1000)).to.be.reverted
		})

	})


	describe("deposit", function () {
		const depositAmount = decimal(1, collateralDecimals)

		beforeEach(async function () {
			await mintFor(user, depositAmount)
		})

		it("should deposit tokens", async function () {
			await expect(symmioSolverDepositor.connect(user).deposit(depositAmount))
				.to.emit(symmioSolverDepositor, "Deposit")
				.withArgs(await user.getAddress(), depositAmount)
			let amountInSolverTokenDecimals = convertToDepositorDecimals(depositAmount)
			expect(await lpToken.balanceOf(await user.getAddress())).to.equal(amountInSolverTokenDecimals)
			expect(await collateralToken.balanceOf(await symmioSolverDepositor.getAddress())).to.equal(depositAmount)
			expect(await symmioSolverDepositor.currentDeposit()).to.equal(depositAmount)
		})

		it("should fail when is paused", async function () {
			await symmioSolverDepositor.connect(pauser).pause()
			await expect(symmioSolverDepositor.connect(user).deposit(depositAmount))
				.to.be.reverted
		})

		it("should fail if transfer fails", async function () {
			await expect(symmioSolverDepositor.connect(other).deposit(depositAmount)).to.be.reverted
		})

		it("should fail to deposit more than limit", async function () {
			await expect(symmioSolverDepositor.connect(user).deposit(depositLimit + 1n))
				.to.be.revertedWith("SymmioSolverDepositor: Deposit limit reached")
		})

		it("should update the current deposit amount", async function () {
			const amount = depositLimit - depositAmount + 1n

			await symmioSolverDepositor.connect(user).deposit(depositAmount)

			await expect(symmioSolverDepositor.connect(other).deposit(amount))
				.to.be.revertedWith("SymmioSolverDepositor: Deposit limit reached")

			let amountInSolverTokenDecimals = convertToDepositorDecimals(depositAmount)

			await lpToken.connect(user).approve(await symmioSolverDepositor.getAddress(), amountInSolverTokenDecimals)
			await symmioSolverDepositor.connect(user).requestWithdraw(amountInSolverTokenDecimals, amountInSolverTokenDecimals, await owner.getAddress())

			await mintFor(user, amount)
			await expect(symmioSolverDepositor.connect(user).deposit(amount))
				.to.not.be.reverted
		})
	})

	describe("depositToSymmio", function () {
		const depositAmount = decimal(500, collateralDecimals)

		beforeEach(async function () {
			await mintFor(user, depositAmount)
			await symmioSolverDepositor.connect(user).deposit(depositAmount)
		})

		it("should deposit to symmio", async function () {
			await expect(symmioSolverDepositor.connect(depositor).depositToSymmio(depositAmount))
				.to.emit(symmioSolverDepositor, "DepositToSymmio")
				.withArgs(await depositor.getAddress(), await solver.getAddress(), depositAmount)
			expect(await symmio.balanceOf(await solver.getAddress())).to.equal(depositAmount)
		})
		it("should fail when is paused", async function () {
			await symmioSolverDepositor.connect(pauser).pause()
			await expect(symmioSolverDepositor.connect(depositor).depositToSymmio(depositAmount))
				.to.be.reverted
		})

		it("should fail if not called by depositor role", async function () {
			await expect(symmioSolverDepositor.connect(other).depositToSymmio(depositAmount)).to.be.reverted
		})
	})

	describe("requestWithdraw", function () {
		const depositAmount = decimal(500, collateralDecimals)
		const withdrawAmountInCollateralDecimals = depositAmount
		const withdrawAmount = convertToDepositorDecimals(depositAmount)

		beforeEach(async function () {
			await mintFor(user, depositAmount)
			await symmioSolverDepositor.connect(user).deposit(depositAmount)
			await lpToken.connect(user).approve(await symmioSolverDepositor.getAddress(), withdrawAmount)
		})

		it("should request withdraw", async function () {
			const rec = await receiver.getAddress()
			await expect(symmioSolverDepositor.connect(user).requestWithdraw(withdrawAmount, withdrawAmount, rec))
				.to.emit(symmioSolverDepositor, "WithdrawRequestEvent")
				.withArgs(0, rec, withdrawAmountInCollateralDecimals)

			const request = await symmioSolverDepositor.withdrawRequests(0)
			expect(request[0]).to.equal(rec)
			expect(request[1]).to.equal(withdrawAmountInCollateralDecimals)
			expect(request[2]).to.equal(RequestStatus.Pending)
			expect(request[3]).to.equal(0n)
		})

		it("should fail when is paused", async function () {
			await symmioSolverDepositor.connect(pauser).pause()
			const rec = await receiver.getAddress()
			await expect(symmioSolverDepositor.connect(user).requestWithdraw(withdrawAmount, withdrawAmount, rec))
				.to.be.reverted
		})

		it("should fail if insufficient token balance", async function () {
			await expect(symmioSolverDepositor.connect(other).requestWithdraw(withdrawAmount, withdrawAmount, await receiver.getAddress())).to.be.reverted
		})

		describe("acceptWithdrawRequest", function () {
			const requestIds = [0]
			const paybackRatio = decimal(70, 16n)

			beforeEach(async function () {
				await symmioSolverDepositor.connect(user).requestWithdraw(withdrawAmount, withdrawAmount, await receiver.getAddress())
			})

			it("should fail on invalid Id", async function () {
				await expect(symmioSolverDepositor.connect(balancer).acceptWithdrawRequest(0, [5], paybackRatio))
					.to.be.revertedWith("SymmioSolverDepositor: Invalid request ID")
			})

			it("should accept withdraw request", async function () {
				await expect(symmioSolverDepositor.connect(balancer).acceptWithdrawRequest(0, requestIds, paybackRatio))
					.to.emit(symmioSolverDepositor, "WithdrawRequestAcceptedEvent")
					.withArgs(0, requestIds, paybackRatio)
				const request = await symmioSolverDepositor.withdrawRequests(0)
				expect(request[2]).to.equal(RequestStatus.Ready)
				expect(await symmioSolverDepositor.lockedBalance()).to.equal(request.amount * paybackRatio / decimal(1))
			})

			it("should fail on invalid role", async function () {
				await expect(symmioSolverDepositor.connect(other).acceptWithdrawRequest(0, requestIds, paybackRatio))
					.to.be.reverted
			})

			it("should fail when paused", async function () {
				await symmioSolverDepositor.connect(pauser).pause()
				await expect(symmioSolverDepositor.connect(balancer).acceptWithdrawRequest(0, requestIds, paybackRatio))
					.to.be.reverted
			})

			it("should fail to accept already accepted request", async function () {
				await symmioSolverDepositor.connect(balancer).acceptWithdrawRequest(0, requestIds, paybackRatio)
				await expect(symmioSolverDepositor.connect(balancer).acceptWithdrawRequest(0, requestIds, paybackRatio))
					.to.be.revertedWith("SymmioSolverDepositor: Invalid accepted request")
			})

			it("should accept withdraw request with provided amount", async function () {
				await symmioSolverDepositor.connect(depositor).depositToSymmio(depositAmount)
				await mintFor(balancer, depositAmount)
				await collateralToken.connect(balancer).approve(symmioSolverDepositor.getAddress(), depositAmount)
				await expect(symmioSolverDepositor.connect(balancer).acceptWithdrawRequest(depositAmount, requestIds, paybackRatio))
					.to.emit(symmioSolverDepositor, "WithdrawRequestAcceptedEvent")
					.withArgs(depositAmount, requestIds, paybackRatio)
				const request = await symmioSolverDepositor.withdrawRequests(0)
				expect(request[2]).to.equal(RequestStatus.Ready)
				expect(await symmioSolverDepositor.lockedBalance()).to.equal(request.amount * paybackRatio / decimal(1))
			})

			it("should fail to accept with insufficient balance", async function () {
				await symmioSolverDepositor.connect(depositor).depositToSymmio(depositAmount)
				await expect(symmioSolverDepositor.connect(balancer).acceptWithdrawRequest(0, requestIds, paybackRatio))
					.to.be.revertedWith("SymmioSolverDepositor: Insufficient contract balance")
			})

			it("should fail if payback ratio is too low", async function () {
				await expect(symmioSolverDepositor.connect(balancer).acceptWithdrawRequest(0, requestIds, decimal(40, 16n)))
					.to.be.revertedWith("SymmioSolverDepositor: Payback ratio is too low")
			})


			describe("claimForWithdrawRequest", function () {
				const requestId = 0
				let lockedBalance: bigint

				beforeEach(async function () {
					symmioSolverDepositor.connect(balancer).acceptWithdrawRequest(0, requestIds, paybackRatio)
					lockedBalance = (await symmioSolverDepositor.withdrawRequests(0)).amount * paybackRatio / decimal(1)
				})

				it("Should fail to deposit to symmio more than available", async function () {
					await expect(symmioSolverDepositor.connect(depositor).depositToSymmio(depositAmount - lockedBalance + BigInt(1)))
						.to.be.revertedWith("SymmioSolverDepositor: Insufficient contract balance")
				})

				it("should claim withdraw", async function () {
					await expect(symmioSolverDepositor.connect(receiver).claimForWithdrawRequest(requestId))
						.to.emit(symmioSolverDepositor, "WithdrawClaimedEvent")
						.withArgs(requestId, await receiver.getAddress())
					const request = await symmioSolverDepositor.withdrawRequests(0)
					expect(request[2]).to.equal(RequestStatus.Done)
				})

				it("should fail when paused", async function () {
					await symmioSolverDepositor.connect(pauser).pause()
					await expect(symmioSolverDepositor.connect(receiver).claimForWithdrawRequest(requestId))
						.to.be.reverted
				})

				it("should fail on invalid ID", async function () {
					await expect(symmioSolverDepositor.connect(receiver).claimForWithdrawRequest(1)).to.be.revertedWith("SymmioSolverDepositor: Invalid request ID")
				})

				it("should fail if request is not ready", async function () {
					await mintFor(user, depositAmount)
					await lpToken.connect(user).approve(await symmioSolverDepositor.getAddress(), withdrawAmount)
					await symmioSolverDepositor.connect(user).deposit(depositAmount)
					await symmioSolverDepositor.connect(user).requestWithdraw(withdrawAmount, withdrawAmount, await receiver.getAddress())
					await expect(symmioSolverDepositor.connect(receiver).claimForWithdrawRequest(1)).to.be.revertedWith("SymmioSolverDepositor: Request not ready for withdrawal")
				})
			})
		})
	})
})
