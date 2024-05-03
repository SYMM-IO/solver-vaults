import {ethers} from "hardhat"

async function main() {
	const Contract = await ethers.getContractFactory("SymmioDepositorLpToken")
	const contract = await Contract.deploy()
	await contract.waitForDeployment()
	console.log(`${contract} deployed: ${await contract.getAddress()}`)
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch(error => {
	console.error(error)
	process.exitCode = 1
})
