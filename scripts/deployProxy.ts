import {ethers, run, upgrades} from "hardhat"

async function main() {
	const [deployer] = await ethers.getSigners()

	console.log("Deploying contracts with the account:", deployer.address)

	const Factory = await ethers.getContractFactory("RasaOnChainSymmioDepositor")
	const contract = await upgrades.deployProxy(Factory, [
		"", //_symmioAddress
		"", //_lpTokenAddress
		"", //_solver or _broker
		0, //_minimumPaybackRatio
		0, //_depositLimit
	], {initializer: "initialize"})
	await contract.waitForDeployment()

	const addresses = {
		proxy: contract.address,
		admin: await upgrades.erc1967.getAdminAddress(await contract.getAddress()),
		implementation: await upgrades.erc1967.getImplementationAddress(await contract.getAddress()),
	}
	console.log(addresses)

	try {
		console.log("Verifying contract...")
		await new Promise(r => setTimeout(r, 15000))
		await run("verify:verify", {address: addresses.implementation})
		console.log("Contract verified!")
	} catch (e) {
		console.log(e)
	}
}

main()
	.then(() => process.exit(0))
	.catch(error => {
		console.error(error)
		process.exit(1)
	})
