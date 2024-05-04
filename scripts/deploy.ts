import {ethers, run} from "hardhat"

async function main() {
	const Contract = await ethers.getContractFactory("SymmioDepositorLpToken")
	const contract = await Contract.deploy()
	await contract.waitForDeployment()
	console.log(`${contract} deployed: ${await contract.getAddress()}`)

	try {
		console.log("Verifying contract...")
		await new Promise(r => setTimeout(r, 15000))
		await run("verify:verify", {address: await contract.getAddress()})
		console.log("Contract verified!")
	} catch (e) {
		console.log(e)
	}
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch(error => {
	console.error(error)
	process.exitCode = 1
})
