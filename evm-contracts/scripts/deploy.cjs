const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with:", deployer.address);

  let bridgedTokenAddress = process.env.BRIDGED_TOKEN_ADDRESS;

  if (!bridgedTokenAddress) {
    console.log("No BRIDGED_TOKEN_ADDRESS set — deploying a mock bridged ERC-20 for testnet use.");
    const ERC20Mock = await ethers.getContractFactory("ERC20Mock");
    const mockToken = await ERC20Mock.deploy(
      "Mock Axelar-Bridged REGEN Credit",
      "axlREGEN-C",
      ethers.parseEther("1000000")
    );
    await mockToken.waitForDeployment();
    bridgedTokenAddress = await mockToken.getAddress();
    console.log("Mock bridged token deployed at:", bridgedTokenAddress);
  }

  const BaseRegenCreditBasket = await ethers.getContractFactory("BaseRegenCreditBasket");
  const basket = await BaseRegenCreditBasket.deploy(bridgedTokenAddress);
  await basket.waitForDeployment();
  const basketAddress = await basket.getAddress();

  console.log("BaseRegenCreditBasket deployed at:", basketAddress);
  console.log("Bridged token:", bridgedTokenAddress);
  console.log("Network:", network.name);

  return { basketAddress, bridgedTokenAddress };
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
