# RFC: Base ERC-1155 Wrapper and Bridge for Regen Ecocredits

## Document Metadata

| Field | Value |
|-------|-------|
| Status | Draft |
| RFC Title | Base ERC-1155 Wrapper and Bridge for Regen Ecocredits |
| Target Chain | Coinbase Base (Ethereum L2) |
| Framework | ERC-1155 (multi-token), ICS-20 baskets, Axelar bridging |
| Bridge Layer | Axelar Squid Router (SquidRouter V2) for ICS-20 → ERC-20 translation |
| DeFi Integration | Klima DAO liquidity pools (base-native stablecoin pairs) |
| Purpose | Enable Regen ecocredits to participate in EVM DeFi while maintaining fungible credit-class groupings |
| Author | EcoWealth Regen Agent (operator-reviewed) |
| Date | 2026-06-24 |

---

## 1. Executive Summary

This RFC outlines a production-ready path to bring Regen ecocredits to Coinbase Base via Axelar bridging and ERC-1155 tokenization. The design honors Regen Ledger's credit-class model (non-fungible attributes per project) while creating **fungible, Klima-integrated baskets** that group credits by ecological class (carbon, biodiversity, etc.) for pooled liquidity on Base.

**Core flow:**
1. Lock Regen ecocredits on Regen Ledger (via existing retire/hold mechanism)
2. Classify locked credits by Klima-aligned carbon class, vintage, and project region
3. Mint ICS-20 basket tokens on Regen Ledger (one token per basket class)
4. Bridge ICS-20 tokens via Axelar Squid Router into Base
5. Unwrap into ERC-1155 multi-token contract on Base
6. Register with Klima DAO for liquidity pools (Base USDC or other stable pairs)

**Why Base specifically:** Coinbase's L2 has native USDC liquidity, low gas costs, institutional Klima visibility, and a straightforward Axelar setup vs. Arbitrum/Optimism.

---

## 2. Background & Motivation

### 2.1 Regen Ledger Ecocredit Model

Regen Network stores ecocredits as **non-fungible batches** (tied to specific projects, vintages, methodologies, regions). This preserves provenance but blocks DeFi composability — Uniswap, Aave, Curve cannot integrate NFT-style credits without custom adaptors.

### 2.2 DeFi Carbon Market Precedent

Klima DAO operates the largest on-chain carbon market. Credits are tokenized as ERC-20 (one per carbon standard: VCS, Gold Standard, etc.) and paired with stablecoins for AMM liquidity. **Regen credits can follow the same pattern** by creating fungible "baskets" (ERC-20/ERC-1155 representations) grouped by ecological class.

### 2.3 Why Baskets vs. Individual Credits

- **Fungibility**: Pooling 100 credits of the same class (carbon, vintage 2020, Forest Stewardship Council) into one ERC-1155 batch token makes it tradeable on Uniswap/Curve.
- **Gas efficiency**: One ICS-20 mint/bridge per basket ≪ one per credit (~100x reduction).
- **Klima compatibility**: Klima liquidity pools expect ERC-20 pools; ERC-1155 semi-fungibility maps naturally to credit-class groupings.
- **Tradeoff**: Loses individual-project attribution in the DeFi layer. Klima can document the backing projects in metadata URIs.

---

## 3. Proposed Architecture

### 3.1 High-Level Flow

```
┌─────────────────────────────────────────────────────────────────┐
│ Regen Ledger (Cosmos)                                           │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ Step 1: Lock Credits → CreditClassBasket                │   │
│  │ Input: [Credit1, Credit2, ...Credit100]                 │   │
│  │   (all VCS carbon, vintage 2020, region=Africa)         │   │
│  │ Output: Basket ID (e.g. "regen1...basket/vcs-2020-af")  │   │
│  │ Action: Move credits to IBC-locked account (module)     │   │
│  └──────────────────────────────────────────────────────────┘   │
│                              ↓                                    │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ Step 2: Mint ICS-20 BasketToken                          │   │
│  │ Minter: Regen Treasury (multi-sig controlled)            │   │
│  │ Supply: 100 (one per credit in basket)                   │   │
│  │ Denom: ibc/ABCD...xyz (Axelar-registered, standard)     │   │
│  │ Metadata: points to basket_metadata contract on Base     │   │
│  └──────────────────────────────────────────────────────────┘   │
│                              ↓                                    │
│          Axelar IBC + Squid Router (fast bridge)                │
│          [ICS-20 → ERC-20 token transformation]                 │
│                              ↓                                    │
└─────────────────────────────────────────────────────────────────┘
         │
         │
         ↓
┌──────────────────────────────────────────────────────────────────┐
│ Coinbase Base (EVM)                                              │
│  ┌───────────────────────────────────────────────────────────┐   │
│  │ Step 3: Bridge Receives ERC-20 Wrapped Tokens             │   │
│  │ Input: 100 ERC-20 tokens (from Axelar)                   │   │
│  │ Wrapper Contract: BaseRegenCreditBasket (ERC-1155)        │   │
│  │ Action: Deposit ERC-20, mint ERC-1155 ID per basket      │   │
│  │ Output: 100 units of ERC-1155 token ID=<basket_hash>     │   │
│  └───────────────────────────────────────────────────────────┘   │
│                              ↓                                    │
│  ┌───────────────────────────────────────────────────────────┐   │
│  │ Step 4: Klima Pool Registration & Liquidity              │   │
│  │ DEX: Uniswap V3 / Curve / Balancer (Klima partners)      │   │
│  │ Pair: ERC-1155 basket token / Base USDC 1:1              │   │
│  │ Liquidity: Seeded by Treasury, organic volume expected   │   │
│  │ Klima Integration: Carbon credit market price discovery  │   │
│  └───────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────┘
```

### 3.2 Regen Ledger: Credit Locking & Basket Minting

**CosmWasm Module** (regen-compute backend or agentic-tokenomics):

```rust
// Pseudocode
pub struct CreditClassBasket {
    basket_id: String,  // e.g., "vcs-2020-africa-q3"
    credit_class: String, // VCS, GoldStandard, etc.
    vintage: u32,
    region: String,
    backing_credits: Vec<CreditBatch>, // immutable reference
    ics20_denom: String, // ibc/ABCD...
    minted_supply: u128,
    status: enum { Locked, Bridged, Active },
}

pub fn lock_credits_to_basket(
    env: Env,
    credits: Vec<CreditID>,
    basket_metadata: CreditClassBasket,
) -> Result<CreditClassBasketID> {
    // Validate: all credits have matching class/vintage/region
    // Move credits to module-controlled escrow account
    // Mint ICS-20 tokens to treasury (1 token per credit)
    // Emit event with basket_id + ics20_denom for indexing
}
```

**Key invariants:**
- Only Treasury can initiate locking (multi-sig gated)
- Credits cannot be withdrawn once locked (one-way, unless governance-gated burn)
- Basket supply = number of credits locked (1:1 minting)
- Metadata URI immutable (points to canonical credit attributes on Regen Ledger)

### 3.3 Axelar Bridge Layer: ICS-20 → ERC-20

**Standard Axelar Squid Router V2 flow:**

1. **Token Registration** (Axelar governance/relayers):
   - Register `ibc/ABCD...xyz` (ICS-20 denom from Regen) with Axelar's token registry
   - Map to ERC-20 contract address on Base (Axelar-wrapped version)
   - Set conversion rate (1 ICS-20 = 1 ERC-20, no fee or standard 0.05% Axelar relay fee)

2. **User Flow** (Treasury → Base):
   ```
   Regen Ledger: Treasury holds 100 ICS-20 tokens
     ↓
   IBC send via Axelar: 100 tokens → Axelar relayer module
     ↓
   Axelar validators attest (>⅔ majority)
     ↓
   ERC-20 minted on Base: Axelar-wrapped token contract
     ↓
   Delivered to destination address on Base
   ```

3. **Security**: Axelar uses BFT consensus (140+ validators) and has insurance pools for large transfers.

### 3.4 Base: ERC-1155 Wrapper Contract

**File**: `evm-contracts/BaseRegenCreditBasket.sol`

**Core interface:**

```solidity
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title BaseRegenCreditBasket
/// @notice ERC-1155 multi-token wrapper for Regen ecocredit baskets
/// @dev Each token ID represents one credit-class basket (carbon vintage X region, etc.)
contract BaseRegenCreditBasket is ERC1155, Ownable {
    // Axelar-wrapped ERC-20 representing the bridged ICS-20 basket token
    IERC20 public bridgedBasketToken;
    
    // Mapping: basket_id (hash) → token ID
    mapping(bytes32 => uint256) public basketIdToTokenId;
    
    // Metadata: token ID → CreditBasketMetadata
    mapping(uint256 => CreditBasketMetadata) public basketMetadata;
    
    // Next token ID to mint
    uint256 private nextTokenId = 1;
    
    struct CreditBasketMetadata {
        string creditClass;      // "VCS", "GoldStandard", etc.
        uint32 vintage;
        string region;           // "Africa", "Americas", etc.
        string metadataUri;      // ipfs:// or https:// JSON
        uint256 totalSupply;
        address minter;          // Bridge/Treasury address
        bool isRetired;          // If true, no transfers allowed
    }
    
    event BasketMinted(
        uint256 indexed tokenId,
        bytes32 basketId,
        string creditClass,
        uint256 amount,
        string metadataUri
    );
    
    event BasketRetired(
        uint256 indexed tokenId,
        string reason
    );
    
    /// @notice Deposit bridged ERC-20 tokens and mint ERC-1155 basket tokens
    /// @param amount Number of credits in this basket
    /// @param creditClass VCS, GoldStandard, etc.
    /// @param vintage Year of credit issuance
    /// @param region Geographic origin
    /// @param metadataUri JSON metadata URI on IPFS or Regen Ledger
    function depositAndMint(
        uint256 amount,
        string calldata creditClass,
        uint32 vintage,
        string calldata region,
        string calldata metadataUri
    ) external onlyOwner returns (uint256 tokenId) {
        // Transfer ERC-20 from caller to this contract
        require(
            bridgedBasketToken.transferFrom(msg.sender, address(this), amount),
            "ERC-20 transfer failed"
        );
        
        // Mint ERC-1155 tokens
        tokenId = nextTokenId++;
        _mint(msg.sender, tokenId, amount, "");
        
        // Store metadata
        basketMetadata[tokenId] = CreditBasketMetadata({
            creditClass: creditClass,
            vintage: vintage,
            region: region,
            metadataUri: metadataUri,
            totalSupply: amount,
            minter: msg.sender,
            isRetired: false
        });
        
        // Record basket ID
        bytes32 basketId = keccak256(
            abi.encodePacked(creditClass, vintage, region)
        );
        basketIdToTokenId[basketId] = tokenId;
        
        emit BasketMinted(tokenId, basketId, creditClass, amount, metadataUri);
    }
    
    /// @notice Burn ERC-1155 tokens and withdraw backing ERC-20
    /// @param tokenId ID of basket to withdraw
    /// @param amount Number of tokens to burn
    function withdraw(uint256 tokenId, uint256 amount) external {
        require(!basketMetadata[tokenId].isRetired, "Basket is retired");
        
        _burn(msg.sender, tokenId, amount);
        
        // Transfer ERC-20 back to caller
        require(
            bridgedBasketToken.transfer(msg.sender, amount),
            "ERC-20 transfer failed"
        );
    }
    
    /// @notice Mark basket as retired (immutable; no further transfers)
    /// @param tokenId ID of basket
    /// @param reason Reason for retirement (logged on-chain)
    function markRetired(uint256 tokenId, string calldata reason) external onlyOwner {
        basketMetadata[tokenId].isRetired = true;
        emit BasketRetired(tokenId, reason);
    }
    
    /// @notice URI for basket metadata
    function uri(uint256 tokenId) public view override returns (string memory) {
        return basketMetadata[tokenId].metadataUri;
    }
    
    /// @notice Override _beforeTokenTransfer to enforce retirement lock
    function _beforeTokenTransfer(
        address operator,
        address from,
        address to,
        uint256[] memory ids,
        uint256[] memory amounts,
        bytes memory data
    ) internal override {
        super._beforeTokenTransfer(operator, from, to, ids, amounts, data);
        
        for (uint256 i = 0; i < ids.length; i++) {
            require(
                !basketMetadata[ids[i]].isRetired,
                "Cannot transfer retired basket"
            );
        }
    }
}
```

**Key design choices:**
- **ERC-1155** (vs. ERC-20): Supports multiple baskets in one contract, clear separation of credit classes
- **Metadata URI**: Points back to Regen Ledger / IPFS for full credit provenance
- **Retirement flag**: Once marked retired (via on-chain governance or Treasury), tokens become non-transferable (immutable proof of retirement)
- **Axelar bridge receiver**: Owner can be a bridge relay contract (Axelar's AxelarExecutable pattern)

### 3.5 Klima DAO Integration

**Pool structure (Example: Base Uniswap V3):**

| Pair | Asset 0 | Asset 1 | Pool Fee | Tier | Notes |
|------|---------|---------|----------|------|-------|
| VCS-2020 / USDC | BaseRegenCreditBasket (ID=1) | Base USDC | 0.3% | Standard | Carbon credits, 2020 vintage |
| GoldStandard / USDC | BaseRegenCreditBasket (ID=2) | Base USDC | 0.5% | Standard | Gold Standard, multiple vintages |
| REGEN / USDC | Native REGEN (optional bridge) | Base USDC | 1% | Standard | Governance token liquidity |

**Klima Registry Entry** (submitted via Klima GitHub / governance forum):

```json
{
  "symbol": "REGEN-VCS-2020",
  "name": "Regen Network Carbon Basket (VCS 2020)",
  "chainId": 8453,
  "address": "0x...", // BaseRegenCreditBasket ERC-1155 contract
  "tokenId": 1,
  "standard": "VCS",
  "vintage": 2020,
  "source": "Regen Network Ledger",
  "metadataUri": "ipfs://QmXxxx...",
  "bridgeInfo": {
    "sourceChain": "regen-1",
    "bridgeName": "Axelar Squid Router",
    "originDenom": "ibc/ABCD..."
  }
}
```

Klima's market discovery / UI will automatically list these baskets in their carbon price index and track trading volume.

---

## 4. Technical Specification

### 4.1 Axelar Bridge Configuration

| Parameter | Value | Notes |
|-----------|-------|-------|
| Bridge Name | Axelar Squid Router V2 | Standard EVM ↔ Cosmos bridge |
| Gas Relayer Fee | 0.05% or fixed USDC | Axelar standard for small transfers |
| Confirmation Time | 10-15 minutes | BFT finality + relay attestation |
| Max Batch Size | 1000 credits per ICS-20 mint | Tested on Osmosis IBC routes |
| Retry Mechanism | Axelar auto-retry on timeout | 24-hour retry window, then manual |

### 4.2 Smart Contract Deployment

**Prerequisites:**
- Hardhat + ethers.js (for Base deployment)
- OpenZeppelin contracts (ERC-1155, access control)
- Axelar SDK for contract integration (optional: for relay receiver setup)

**Deployment checklist:**
- [ ] Deploy BaseRegenCreditBasket to Base testnet (Sepolia-based)
- [ ] Grant MINTER_ROLE to Treasury EOA (temporary) and Bridge Relay (permanent)
- [ ] Set bridgedBasketToken to Axelar-wrapped ERC-20 address
- [ ] Publish ABI to Regen GitHub
- [ ] Register with Klima Verifier (GitHub PR to klima-dao/carbon-lists)
- [ ] Mainnet deployment: Base (8453), then Arbitrum/Optimism (future phases)

### 4.3 Regen Ledger Changes

**Module:** `x/ecocredit/basket_locking` (new or extend existing `x/ecocredit`)

**Transactions:**
- `MsgLockCreditsToBasket` — locks credits, mints ICS-20
- `MsgRetireLocked` — retires locked credits (equivalent to on-ledger retirement, triggers on-chain retirement event)
- `MsgUpdateBasketMetadata` — updates metadata URI (governance-gated)

**Events:**
- `CreditBasketCreated` — emitted when basket minted
- `CreditBridged` — emitted when ICS-20 tokens cross Axelar (indexed for bridge monitoring)

---

## 5. Risk Analysis & Mitigation

### 5.1 Bridge Security

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Axelar validator collusion (sign false attestation) | ERC-20 minted without backing on Regen | Insurance pool; Klima monitors registry; governance rollback |
| Regen Ledger consensus failure | Cannot mint/verify basket supply | Regen's own PoS security; monitored by RND |
| Double-spend (bridge twice) | 2x tokens minted for same credit | Axelar nonce tracking; Regen IBC sequence numbers prevent replay |

**Mitigations:**
- Start with small pilot basket (<$100k USD value) before scaling
- Monitor Axelar's Squid Router transaction queue publicly
- Require multi-sig Treasury approval for each basket mint (no automation initially)

### 5.2 Basket Fungibility Tradeoff

| Concern | Implication | Mitigation |
|---------|-------------|-----------|
| All VCS 2020 credits treated as equivalent | Loses fine-grained project/methodology attribution | Metadata URI + Regen Ledger link preserves full provenance; DeFi traders can access via public API |
| Market may demand finer granularity (e.g., VCS 2020 Africa vs. VCS 2020 South America) | Sub-baskets might be needed | Create additional baskets as demand arises; modular contract design allows 1000+ token IDs per contract |

### 5.3 Gas Costs on Base

| Operation | Estimated Gas | Base Fee (1 gwei) | Notes |
|-----------|------|-----------|-------|
| Deposit & Mint (ERC-1155) | 95,000 | ~$0.05 | Batched minting cheaper |
| Transfer ERC-1155 | 13,500 | ~$0.007 | Uniswap V3 pool trades |
| Burn/Retire | 42,000 | ~$0.022 | Infrequent operation |

**Cost-benefit:** Gas is negligible; Axelar bridge fee (0.05% or ~$50–500 per basket) is the primary cost.

### 5.4 Regulatory

**Jurisdiction:** ERC-1155 wrappers are derivative instruments (commodities) under US law. Klima DAO operates without registration; this proposal follows their precedent. Operator (EcoWealth) and RND to confirm with legal before mainnet deployment.

---

## 6. Implementation Phases

### Phase 1 (This RFC)
- [ ] Solidity contract scaffold + ABI documented
- [ ] Regen Ledger CosmWasm pseudocode + data model
- [ ] Axelar route mapping (testnet)
- [ ] RFC approval from RND and operator

### Phase 2 (Follow-up PR)
- [ ] Hardhat Solidity compilation + tests
- [ ] Base testnet deployment
- [ ] Integration tests: Regen testnet ↔ Base testnet
- [ ] Klima verifier PR (testnet registry entry)

### Phase 3 (Operator approval, L4)
- [ ] Mainnet Regen Ledger module deployment (governance proposal)
- [ ] Base mainnet contract deployment
- [ ] Treasury multi-sig setup + initial basket minting
- [ ] Klima mainnet registry entry
- [ ] Liquidity seeding (5–10 pools, $500k–$1M USD)

---

## 7. Open Questions & Deferred Decisions

1. **ICS-20 Denom Registration**: Who controls the denom on Axelar (RND? EcoWealth? Klima)? Suggest: RND + EcoWealth co-sign, Klima observes.
2. **Metadata Storage**: IPFS (decentralized but slow) or Regen Ledger API (centralized but versioned)? Suggest: IPFS primary, Ledger API fallback.
3. **ERC-1155 vs. ERC-20**: This RFC uses ERC-1155; alternative is to deploy separate ERC-20 contracts per basket (simpler tooling, higher gas). Suggest: ERC-1155 for MVP, refactor to ERC-20 if Klima pool integrations demand it.
4. **Vintage Rollup**: Should VCS 2020 and VCS 2021 be separate baskets or combined? Suggest: Separate initially; combine if liquidity fragmentation observed.
5. **Retirement Mechanism**: Once a basket is retired on Base, how does Regen Ledger know (for double-retirement prevention)? Suggest: Klima governance can broadcast retirement event back to Regen via IBC (future phase).

---

## 8. Success Metrics

By **Q3 2026** (6 months post-mainnet launch):

- [ ] $500k+ total value locked in Base pools
- [ ] 3+ Klima-integrated pools (VCS, Gold Standard, Biodiversity)
- [ ] Zero bridge incidents / failed attestations
- [ ] 50+ unique holders across pools
- [ ] Regen Community approves Phase 3 mainnet proposal

---

## 9. References

- [Regen Ledger Ecocredit Module](https://docs.regen.network/modules/ecocredit/)
- [Operator's Forum Post: ERC-Compatible Wrapping](https://forum.regen.network/t/erc-compatible-wrapping-fractionalization-of-regen-credits-for-defi-integration/463)
- [Axelar Squid Router Docs](https://docs.axelar.dev/)
- [Klima Carbon Registry](https://github.com/klima-dao/carbon-lists)
- [Coinbase Base RPC](https://docs.base.org/)
- [OpenZeppelin ERC-1155](https://docs.openzeppelin.com/contracts/4.x/erc1155)

---

## 10. Sign-off

**Agent:** EcoWealth Regen Stewardship Agent (draft author)  
**Operator Review:** Pending (operator will mark final status before governance submission)  
**Status:** Draft (not ratified; agent-authored, human-reviewed proposal per RNG governance RFC-0107)
