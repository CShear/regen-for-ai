const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("BaseRegenCreditBasket", function () {
  let basket;
  let mockToken;
  let owner, minter, user1, user2;

  beforeEach(async function () {
    [owner, minter, user1, user2] = await ethers.getSigners();

    // Deploy a mock ERC-20 token (simulating Axelar-wrapped token)
    const ERC20Mock = await ethers.getContractFactory(
      "ERC20Mock",
      owner
    );
    mockToken = await ERC20Mock.deploy("Regen Basket Token", "RBT", ethers.parseEther("1000000"));
    await mockToken.waitForDeployment();

    // Deploy BaseRegenCreditBasket
    const BaseRegenCreditBasket = await ethers.getContractFactory(
      "BaseRegenCreditBasket",
      owner
    );
    basket = await BaseRegenCreditBasket.deploy(await mockToken.getAddress());
    await basket.waitForDeployment();

    // Grant MINTER_ROLE to minter
    const MINTER_ROLE = await basket.MINTER_ROLE();
    await basket.grantRole(MINTER_ROLE, minter.address);

    // Transfer mock tokens to user1 and user2 for testing
    await mockToken.transfer(user1.address, ethers.parseEther("10000"));
    await mockToken.transfer(user2.address, ethers.parseEther("10000"));
  });

  describe("Deployment", function () {
    it("Should deploy with correct initial state", async function () {
      expect(await basket.owner()).to.equal(owner.address);
      expect(await basket.bridgedBasketToken()).to.equal(await mockToken.getAddress());
    });
  });

  describe("Deposit and Mint", function () {
    it("Should deposit ERC-20 and mint ERC-1155 tokens", async function () {
      const amount = ethers.parseEther("100");
      const creditClass = "VCS";
      const vintage = 2020;
      const region = "Africa";
      const metadataUri = "ipfs://QmXxxx";

      // Approve token transfer
      await mockToken.connect(user1).approve(basket.address, amount);

      // Deposit and mint
      const tx = await basket.connect(minter).depositAndMint(
        amount,
        creditClass,
        vintage,
        region,
        metadataUri
      );

      expect(tx).to.emit(basket, "BasketMinted");
      expect(tx).to.emit(basket, "Deposited");

      // Check that tokens were transferred
      expect(await mockToken.balanceOf(basket.address)).to.equal(amount);
    });

    it("Should fail if caller is not MINTER_ROLE", async function () {
      const amount = ethers.parseEther("100");
      await mockToken.connect(user1).approve(basket.address, amount);

      await expect(
        basket.connect(user1).depositAndMint(
          amount,
          "VCS",
          2020,
          "Africa",
          "ipfs://QmXxxx"
        )
      ).to.be.revertedWithCustomError(basket, "AccessControlUnauthorizedAccount");
    });

    it("Should fail if amount is zero", async function () {
      await expect(
        basket.connect(minter).depositAndMint(
          0,
          "VCS",
          2020,
          "Africa",
          "ipfs://QmXxxx"
        )
      ).to.be.revertedWith("Amount must be greater than 0");
    });
  });

  describe("Withdrawal", function () {
    it("Should withdraw ERC-1155 tokens and receive ERC-20", async function () {
      const amount = ethers.parseEther("100");
      await mockToken.connect(user1).approve(basket.address, amount);

      // First, deposit and mint
      await basket.connect(minter).depositAndMint(
        amount,
        "VCS",
        2020,
        "Africa",
        "ipfs://QmXxxx"
      );

      // Get the token ID (should be 1)
      const tokenId = 1;

      // Now withdraw
      const withdrawAmount = ethers.parseEther("50");
      const tx = await basket.connect(minter).withdraw(tokenId, withdrawAmount);

      expect(tx).to.emit(basket, "Withdrawn");

      // Check that ERC-20 was transferred back
      expect(await mockToken.balanceOf(basket.address)).to.equal(
        amount - withdrawAmount
      );
    });

    it("Should fail to withdraw from retired basket", async function () {
      const amount = ethers.parseEther("100");
      await mockToken.connect(user1).approve(basket.address, amount);

      // Deposit and mint
      await basket.connect(minter).depositAndMint(
        amount,
        "VCS",
        2020,
        "Africa",
        "ipfs://QmXxxx"
      );

      const tokenId = 1;

      // Mark as retired
      await basket.connect(minter).markRetired(tokenId, "Retired on-chain");

      // Try to withdraw
      await expect(
        basket.connect(minter).withdraw(tokenId, ethers.parseEther("50"))
      ).to.be.revertedWith("Cannot withdraw from retired basket");
    });
  });

  describe("Retirement", function () {
    it("Should mark basket as retired", async function () {
      const amount = ethers.parseEther("100");
      await mockToken.connect(user1).approve(basket.address, amount);

      // Deposit and mint
      await basket.connect(minter).depositAndMint(
        amount,
        "VCS",
        2020,
        "Africa",
        "ipfs://QmXxxx"
      );

      const tokenId = 1;

      // Mark as retired
      const tx = await basket.connect(minter).markRetired(
        tokenId,
        "Retired on-chain via Klima"
      );

      expect(tx).to.emit(basket, "BasketRetired");

      // Check metadata
      const metadata = await basket.getBasketMetadata(tokenId);
      expect(metadata.isRetired).to.be.true;
    });

    it("Should prevent transfer of retired baskets", async function () {
      const amount = ethers.parseEther("100");
      await mockToken.connect(user1).approve(basket.address, amount);

      // Deposit and mint
      await basket.connect(minter).depositAndMint(
        amount,
        "VCS",
        2020,
        "Africa",
        "ipfs://QmXxxx"
      );

      const tokenId = 1;

      // Mark as retired
      await basket.connect(minter).markRetired(tokenId, "Retired");

      // Try to transfer
      await expect(
        basket.safeTransferFrom(minter.address, user1.address, tokenId, ethers.parseEther("10"), "0x")
      ).to.be.revertedWith("Cannot transfer retired basket");
    });
  });

  describe("View Functions", function () {
    it("Should return correct metadata", async function () {
      const amount = ethers.parseEther("100");
      const creditClass = "VCS";
      const vintage = 2020;
      const region = "Africa";
      const metadataUri = "ipfs://QmXxxx";

      await mockToken.connect(user1).approve(basket.address, amount);

      await basket.connect(minter).depositAndMint(
        amount,
        creditClass,
        vintage,
        region,
        metadataUri
      );

      const metadata = await basket.getBasketMetadata(1);
      expect(metadata.creditClass).to.equal(creditClass);
      expect(metadata.vintage).to.equal(vintage);
      expect(metadata.region).to.equal(region);
      expect(metadata.metadataUri).to.equal(metadataUri);
    });

    it("Should return correct total supply per token", async function () {
      const amount = ethers.parseEther("100");
      await mockToken.connect(user1).approve(basket.address, amount);

      await basket.connect(minter).depositAndMint(
        amount,
        "VCS",
        2020,
        "Africa",
        "ipfs://QmXxxx"
      );

      expect(await basket.getTotalSupply(1)).to.equal(amount);
    });

    it("Should return correct URI", async function () {
      const amount = ethers.parseEther("100");
      const metadataUri = "ipfs://QmCustom123";

      await mockToken.connect(user1).approve(basket.address, amount);

      await basket.connect(minter).depositAndMint(
        amount,
        "VCS",
        2020,
        "Africa",
        metadataUri
      );

      expect(await basket.uri(1)).to.equal(metadataUri);
    });
  });

  describe("Access Control", function () {
    it("Should allow owner to set bridged token address", async function () {
      const newMockToken = await (await ethers.getContractFactory("ERC20Mock", owner)).deploy(
        "New Token",
        "NEW",
        ethers.parseEther("1000")
      );
      await newMockToken.waitForDeployment();

      await basket.setBridgedTokenAddress(await newMockToken.getAddress());
      expect(await basket.bridgedBasketToken()).to.equal(await newMockToken.getAddress());
    });

    it("Should fail if non-owner tries to set bridged token address", async function () {
      const newMockToken = await (await ethers.getContractFactory("ERC20Mock", owner)).deploy(
        "New Token",
        "NEW",
        ethers.parseEther("1000")
      );
      await newMockToken.waitForDeployment();

      await expect(
        basket.connect(user1).setBridgedTokenAddress(await newMockToken.getAddress())
      ).to.be.revertedWithCustomError(basket, "OwnableUnauthorizedAccount");
    });
  });
});
