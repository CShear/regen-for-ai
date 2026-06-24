// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/Pausable.sol";

/**
 * @title BaseRegenCreditBasket
 * @notice ERC-1155 multi-token wrapper for Regen ecocredit baskets on Coinbase Base.
 * @dev Each token ID represents one credit-class basket (e.g., VCS carbon vintage 2020 Africa).
 *      Baskets are backed 1:1 by bridged ICS-20 tokens from Regen Ledger via Axelar.
 *      Supports retirement marking (immutable) and metadata tracking.
 */
contract BaseRegenCreditBasket is ERC1155, Ownable, AccessControl, Pausable {
    // ============ Role Definitions ============
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant METADATA_UPDATER_ROLE = keccak256("METADATA_UPDATER_ROLE");

    // ============ State Variables ============

    /// @notice Axelar-wrapped ERC-20 token representing the bridged ICS-20 basket tokens
    IERC20 public bridgedBasketToken;

    /// @notice Mapping: basket_id (hash) → token ID for quick lookup
    mapping(bytes32 => uint256) public basketIdToTokenId;

    /// @notice Mapping: token ID → CreditBasketMetadata
    mapping(uint256 => CreditBasketMetadata) public basketMetadata;

    /// @notice Mapping: token ID → total supply (for tracking)
    mapping(uint256 => uint256) public totalSupplyPerToken;

    /// @notice Next token ID to assign
    uint256 private nextTokenId = 1;

    /// @notice Base URI for token metadata (can be overridden per token)
    string public baseURI = "ipfs://";

    // ============ Data Structures ============

    /**
     * @notice Metadata for a credit basket (ERC-1155 token ID)
     */
    struct CreditBasketMetadata {
        string creditClass;      // "VCS", "GoldStandard", "Biodiversity", etc.
        uint32 vintage;          // Year of credit issuance
        string region;           // Geographic origin (e.g., "Africa", "Americas")
        string metadataUri;      // Full URI to JSON metadata on IPFS or on-chain
        address minter;          // Address that created this basket
        uint256 createdAt;       // Block timestamp of creation
        bool isRetired;          // Once true, no transfers allowed (immutable)
        string retirementReason; // Reason for retirement, if isRetired == true
    }

    // ============ Events ============

    /**
     * @notice Emitted when a new basket is created and ERC-1155 tokens minted
     */
    event BasketMinted(
        uint256 indexed tokenId,
        bytes32 indexed basketId,
        string creditClass,
        uint32 vintage,
        string region,
        uint256 amount,
        string metadataUri,
        address indexed minter
    );

    /**
     * @notice Emitted when a basket is marked as retired
     */
    event BasketRetired(
        uint256 indexed tokenId,
        string reason,
        address indexed retiredBy,
        uint256 timestamp
    );

    /**
     * @notice Emitted when ERC-20 is deposited and ERC-1155 minted
     */
    event Deposited(
        address indexed depositor,
        uint256 indexed tokenId,
        uint256 amount
    );

    /**
     * @notice Emitted when ERC-1155 is burned and ERC-20 withdrawn
     */
    event Withdrawn(
        address indexed withdrawer,
        uint256 indexed tokenId,
        uint256 amount
    );

    // ============ Constructor ============

    /**
     * @param initialBridgedTokenAddress Address of the Axelar-wrapped ERC-20 token
     */
    constructor(address initialBridgedTokenAddress) ERC1155("ipfs://") {
        bridgedBasketToken = IERC20(initialBridgedTokenAddress);

        // Grant roles
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(MINTER_ROLE, msg.sender);
        _grantRole(PAUSER_ROLE, msg.sender);
        _grantRole(METADATA_UPDATER_ROLE, msg.sender);
    }

    // ============ Core Functions ============

    /**
     * @notice Deposit bridged ERC-20 tokens and mint ERC-1155 basket tokens.
     * @dev Caller must approve this contract to spend the ERC-20 amount.
     * @param amount Number of credits in this basket (must match ERC-20 allowance)
     * @param creditClass Credit standard (e.g., "VCS", "GoldStandard")
     * @param vintage Year of credit issuance
     * @param region Geographic origin
     * @param metadataUri Full URI to credit metadata (IPFS or Regen Ledger API)
     * @return tokenId The newly minted ERC-1155 token ID
     */
    function depositAndMint(
        uint256 amount,
        string calldata creditClass,
        uint32 vintage,
        string calldata region,
        string calldata metadataUri
    ) external onlyRole(MINTER_ROLE) returns (uint256 tokenId) {
        require(amount > 0, "Amount must be greater than 0");
        require(bytes(creditClass).length > 0, "Credit class cannot be empty");
        require(bytes(metadataUri).length > 0, "Metadata URI cannot be empty");

        // Transfer ERC-20 from caller to this contract
        require(
            bridgedBasketToken.transferFrom(msg.sender, address(this), amount),
            "ERC-20 transfer failed"
        );

        // Mint ERC-1155 tokens to the caller
        tokenId = nextTokenId++;
        _mint(msg.sender, tokenId, amount, "");

        // Store metadata
        basketMetadata[tokenId] = CreditBasketMetadata({
            creditClass: creditClass,
            vintage: vintage,
            region: region,
            metadataUri: metadataUri,
            minter: msg.sender,
            createdAt: block.timestamp,
            isRetired: false,
            retirementReason: ""
        });

        // Track total supply
        totalSupplyPerToken[tokenId] = amount;

        // Record basket ID (hash of class + vintage + region for deduplication)
        bytes32 basketId = keccak256(
            abi.encodePacked(creditClass, vintage, region)
        );
        // Only set if not already mapped (first basket of this type)
        if (basketIdToTokenId[basketId] == 0) {
            basketIdToTokenId[basketId] = tokenId;
        }

        emit BasketMinted(
            tokenId,
            basketId,
            creditClass,
            vintage,
            region,
            amount,
            metadataUri,
            msg.sender
        );
        emit Deposited(msg.sender, tokenId, amount);

        return tokenId;
    }

    /**
     * @notice Burn ERC-1155 tokens and withdraw backing ERC-20.
     * @dev Only callable if the basket is not retired.
     * @param tokenId ID of basket to withdraw from
     * @param amount Number of tokens to burn and withdraw
     */
    function withdraw(uint256 tokenId, uint256 amount) external {
        require(amount > 0, "Amount must be greater than 0");
        require(!basketMetadata[tokenId].isRetired, "Cannot withdraw from retired basket");

        // Burn ERC-1155 tokens from caller
        _burn(msg.sender, tokenId, amount);

        // Update supply tracking
        totalSupplyPerToken[tokenId] -= amount;

        // Transfer ERC-20 back to caller
        require(
            bridgedBasketToken.transfer(msg.sender, amount),
            "ERC-20 transfer failed"
        );

        emit Withdrawn(msg.sender, tokenId, amount);
    }

    /**
     * @notice Mark a basket as retired (immutable; no transfers allowed after this).
     * @dev Only callable by MINTER_ROLE (e.g., Treasury or Bridge Relay).
     * @param tokenId ID of basket to retire
     * @param reason Reason for retirement (stored on-chain for auditability)
     */
    function markRetired(
        uint256 tokenId,
        string calldata reason
    ) external onlyRole(MINTER_ROLE) {
        require(basketMetadata[tokenId].createdAt > 0, "Basket does not exist");
        require(!basketMetadata[tokenId].isRetired, "Basket already retired");

        basketMetadata[tokenId].isRetired = true;
        basketMetadata[tokenId].retirementReason = reason;

        emit BasketRetired(tokenId, reason, msg.sender, block.timestamp);
    }

    // ============ View Functions ============

    /**
     * @notice Retrieve full metadata for a basket
     */
    function getBasketMetadata(uint256 tokenId)
        external
        view
        returns (CreditBasketMetadata memory)
    {
        return basketMetadata[tokenId];
    }

    /**
     * @notice Check if a basket is retired
     */
    function isBasketRetired(uint256 tokenId) external view returns (bool) {
        return basketMetadata[tokenId].isRetired;
    }

    /**
     * @notice Get the total supply of a specific basket (ERC-1155 token ID)
     */
    function getTotalSupply(uint256 tokenId) external view returns (uint256) {
        return totalSupplyPerToken[tokenId];
    }

    /**
     * @notice Look up token ID by basket identifier (credit class + vintage + region)
     */
    function getTokenIdByBasketId(bytes32 basketId) external view returns (uint256) {
        return basketIdToTokenId[basketId];
    }

    /**
     * @notice ERC-1155 metadata URI override (per-token)
     */
    function uri(uint256 tokenId) public view override returns (string memory) {
        require(basketMetadata[tokenId].createdAt > 0, "Token does not exist");
        return basketMetadata[tokenId].metadataUri;
    }

    // ============ Access Control & Pausable ============

    /**
     * @notice Update the bridged ERC-20 token address (owner only)
     */
    function setBridgedTokenAddress(address newAddress)
        external
        onlyOwner
    {
        require(newAddress != address(0), "Invalid address");
        bridgedBasketToken = IERC20(newAddress);
    }

    /**
     * @notice Pause all transfers (emergency only)
     */
    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    /**
     * @notice Unpause transfers
     */
    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    // ============ Hooks (OpenZeppelin) ============

    /**
     * @notice Override _beforeTokenTransfer to enforce retirement locks and pause
     */
    function _beforeTokenTransfer(
        address operator,
        address from,
        address to,
        uint256[] memory ids,
        uint256[] memory amounts,
        bytes memory data
    ) internal override whenNotPaused {
        super._beforeTokenTransfer(operator, from, to, ids, amounts, data);

        // Enforce retirement lock: cannot transfer retired baskets
        for (uint256 i = 0; i < ids.length; i++) {
            require(
                !basketMetadata[ids[i]].isRetired,
                "Cannot transfer retired basket"
            );
        }
    }

    /**
     * @notice Required by AccessControl + ERC1155
     */
    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC1155, AccessControl)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
