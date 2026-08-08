# Regen Credit Basket EVM Contracts

## Overview

This directory contains Solidity smart contracts for bringing Regen ecocredits to EVM chains (starting with Coinbase Base) via Axelar bridging.

### BaseRegenCreditBasket (ERC-1155)

An ERC-1155 multi-token contract that wraps Axelar-bridged ICS-20 tokens into fungible credit-class baskets.

**Key features:**
- Deposit bridged ERC-20 tokens, receive ERC-1155 basket tokens
- Per-basket metadata tracking (credit class, vintage, region, IPFS URI)
- Retirement marking (immutable; prevents transfers after retirement)
- Access control (MINTER_ROLE, PAUSER_ROLE, METADATA_UPDATER_ROLE)
- Pausable emergency mechanism

## Building & Testing

### Prerequisites

```bash
npm install
# Installs hardhat, @openzeppelin/contracts, chai, ethers, etc.
```

### Compile

```bash
npm run compile:evm
```

### Test

```bash
npm run test:evm
```

### Deploy (Testnet Example)

```bash
# Set environment variables
export PRIVATE_KEY=0x... # Your deployer private key
export BASE_SEPOLIA_RPC_URL=https://sepolia.base.org

# Deploy to Base Sepolia
npx hardhat run evm-contracts/scripts/deploy.cjs --network base-sepolia
```

The script deploys a mock bridged ERC-20 automatically if `BRIDGED_TOKEN_ADDRESS` is unset (testnet convenience) — pass a real Axelar-bridged token address once one exists on that network.

## Contract Addresses

| Chain | Contract | Address |
|-------|----------|---------|
| Base Sepolia (testnet) | BaseRegenCreditBasket | TBD |
| Base (mainnet) | BaseRegenCreditBasket | TBD |

## Architecture

See `/docs/specs/RFC-BASE-ERC-WRAPPER-BRIDGE.md` for the complete design, including:

- Regen Ledger credit locking and ICS-20 basket minting
- Axelar bridging mechanics
- Klima DAO pool integration
- Risk analysis and mitigation strategies

## Integration with Regen Compute

These contracts are part of the larger Regen Compute cross-chain retirement flow. When a user retires credits via the Regen Compute MCP server:

1. Credits are locked on Regen Ledger
2. ICS-20 basket tokens are minted
3. Axelar bridges tokens to Base (and other EVM chains)
4. ERC-1155 tokens are minted for DeFi composability
5. Klima DAO pools provide liquidity and price discovery

## Testing Strategy

All contracts include comprehensive unit tests covering:

- Deposit/mint workflows
- Withdrawal and burning
- Retirement marking and locking
- Access control enforcement
- View functions and metadata
- Emergency pause/unpause

Run tests with: `npm run test:evm`

## Future Work

- [ ] Axelar relay receiver contract for automated bridging
- [ ] Multi-chain deployment (Arbitrum, Optimism, Celo)
- [ ] Integration with Klima Verifier (carbon registry)
- [ ] Governance-based parameter updates
