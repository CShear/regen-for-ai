# CLAUDE.md — Regen Compute Credits

This file provides context to Claude Code when working on this project.

## Project Overview

Regen Compute Credits is an MCP (Model Context Protocol) server that connects AI compute usage to verified ecological credit retirement on Regen Network. Users connect it to Claude Code or Cursor, and it provides tools to estimate their AI session's ecological footprint, browse available credits, and retire them via Regen Marketplace's existing credit card flow.

## Strategic Context

Read `docs/analysis.md` for the full business analysis. Key points:

- **Problem**: Regen Network's REGEN token burn mechanics depend on ecocredit retirement volume, which is currently low. The demand-side flywheel is missing.
- **Solution**: AI compute users become the demand engine. Subscriptions → credit purchases → retirements → REGEN burns. Outside capital enters the system.
- **Framing**: This is "regenerative contribution," NOT "carbon offset." We fund verified ecological regeneration. We do not claim carbon neutrality. This distinction is strategic and legal.
- **Marketplace state**: Live sell order data served dynamically. Credit card purchases live, retirement certificates exist on-chain.

## Tech Stack

- **Language**: TypeScript (ES2022, ESM modules)
- **Runtime**: Node.js >= 20
- **MCP SDK**: `@modelcontextprotocol/sdk`
- **Data sources**:
  - Regen Ledger REST API (credit classes, projects, batches, sell orders)
  - Regen Indexer GraphQL (`api.regen.network/indexer/v1/graphql`) — retirement certificates, aggregations
  - Regen Marketplace (`app.regen.network`) — purchase flow links
  - ecoBridge API (`api.bridge.eco`) — cross-chain token support, real-time prices, widget deep links

## Project Structure

```
src/
├── index.ts              # MCP server entry point, tool/prompt registration, server instructions
├── config.ts             # Centralized env config, isWalletConfigured() gate
├── tools/
│   ├── footprint.ts      # estimate_session_footprint tool
│   ├── credits.ts        # browse_available_credits tool (live sell order aggregation)
│   ├── certificates.ts   # get_retirement_certificate tool (nodeId + txHash lookup)
│   ├── impact.ts         # get_impact_summary tool
│   └── retire.ts         # retire_credits tool (on-chain execution OR marketplace link)
├── services/
│   ├── ledger.ts         # Regen Ledger REST client (lcd-regen.keplr.app)
│   ├── indexer.ts        # Regen Indexer GraphQL client (api.regen.network)
│   ├── estimator.ts      # Footprint estimation heuristics
│   ├── wallet.ts         # Cosmos wallet init, sign+broadcast (singleton)
│   ├── order-selector.ts # Best-price sell order routing (cheapest-first greedy fill)
│   ├── ecobridge.ts      # ecoBridge API client (registry, tokens, chains, widget URLs)
│   └── payment/
│       ├── types.ts      # PaymentProvider interface (authorize → capture two-phase)
│       ├── crypto.ts     # CryptoPaymentProvider (balance check, no-op capture)
│       └── stripe-stub.ts # Placeholder for Regen team Stripe integration
```

## MCP Features

- **Server instructions**: Detailed guidance for when/why to use this server, injected into model system prompt. Adapts based on wallet configuration and ecoBridge enabled state.
- **Tool annotations**: Read-only tools stay `readOnlyHint: true`. `retire_credits` becomes `destructiveHint: true` when wallet is configured (executes real transactions).
- **Prompt templates**: `offset_my_session` (footprint → browse → retire workflow), `show_regen_impact` (network stats), `retire_with_any_token` (ecoBridge cross-chain workflow)
- **Live data**: Marketplace snapshot computed from real sell orders, not hardcoded
- **Two-mode retirement**: `retire_credits` executes on-chain when `REGEN_WALLET_MNEMONIC` is set, otherwise returns marketplace link (fully backward compatible)
- **ecoBridge integration**: `browse_ecobridge_tokens` and `retire_via_ecobridge` tools enable payment with 50+ tokens across 10+ blockchains; conditionally registered based on `ECOBRIDGE_ENABLED`

## Build Phases

- **Phase 1** (complete): Read-only MCP server. Footprint estimation, credit browsing, certificate retrieval, marketplace purchase links.
- **Phase 1.5** (current): Direct on-chain retirement. Wallet signing, best-price order routing, `MsgBuyDirect` with auto-retire, `PaymentProvider` interface for Stripe. ecoBridge integration for cross-chain payment (USDC, ETH, etc. on Ethereum, Polygon, Arbitrum, Base, Celo, Optimism, Solana, and more).
- **Phase 2**: Stripe subscription pool. Monthly batch retirements with fractional attribution.
- **Phase 3**: CosmWasm smart contract for on-chain pool aggregation and REGEN burn.
- **Phase 4**: Enterprise API, platform partnerships, credit supply development.

## Key Design Decisions

1. **Heuristic footprint, not precise metering** — MCP servers cannot see Claude's internal compute. We estimate based on session duration and tool call count. Label clearly as an estimate.
2. **Graceful degradation** — When no wallet is configured, retire_credits returns marketplace links (Phase 1 behavior). When wallet is configured, it executes on-chain. Every error in the on-chain path falls back to a marketplace link — users are never stuck.
3. **Both carbon AND biodiversity credits** — Biodiversity is the deeper inventory pool. Mix both for narrative strength ("ecological regeneration" > "carbon offset").
4. **Certificates are the shareable artifact** — The `regen.network/certificate/XYZ` page is the most viral, defensible piece. Prioritize making it beautiful and linkable.
5. **Two-phase payment** — `PaymentProvider` uses authorize → capture pattern. For crypto: authorize = balance check, capture = no-op. For Stripe (future): authorize = hold card, capture = charge after on-chain success. This prevents charging users for failed transactions.
6. **Cheapest-first order routing** — `order-selector.ts` sorts eligible sell orders by `ask_amount` ascending and fills greedily across multiple orders if needed.

## Regen Ledger API Notes

- REST endpoint: see `.env.example` for URLs
- Credit classes: `GET /regen/ecocredit/v1/classes`
- Projects: `GET /regen/ecocredit/v1/projects`
- Batches: `GET /regen/ecocredit/v1/batches`
- Sell orders: `GET /regen/ecocredit/marketplace/v1/sell-orders`
- Credit types on-chain: C (carbon), BT (biodiversity - Terrasos), KSH (Kilo-Sheep-Hour), MBS (Marine Biodiversity Stewardship), USS (Umbrella Species Stewardship)
- Default LCD endpoint: `lcd-regen.keplr.app` (stavr.tech was unreliable)
- Indexer GraphQL supports `condition` arg (not `filter`) for field-level queries
- `txByHash` returns null — use `allRetirements(condition: { txHash: ... })` instead

## ecoBridge API Notes

- Base URL: `https://api.bridge.eco` (configurable via `ECOBRIDGE_API_URL`)
- Docs: https://docs.bridge.eco/docs/guides/integration/
- Registry: `GET /registry` — all active projects, supported tokens with USD prices, chain/token details
- Version: `GET /registry/version` — lightweight poll; returns `{ version, lastUpdated }` for cache invalidation
- OpenAPI spec: `GET /openapi.json`
- Widget deep-linking: https://docs.bridge.eco/docs/guides/deep-linking/ — query params: `chain`, `token`, `project`, `amount`, `beneficiary`, `reason`, `jurisdiction`
- Prices updated ~every 60 seconds via CoinGecko Pro; registry is cached with `ECOBRIDGE_CACHE_TTL_MS` (default 60000ms)
- Integration enabled/disabled via `ECOBRIDGE_ENABLED` env var; tools are conditionally registered when enabled
- Supported chains include: Ethereum, Polygon, Arbitrum, Base, Optimism, Celo, Solana, World Chain, Unichain, Ink, Sonic, 0G, and more

## Tech Stack (Phase 1.5 additions)

- **@cosmjs/proto-signing** + **@cosmjs/stargate**: Cosmos SDK wallet and transaction signing
- **@regen-network/api**: Pre-built proto registry for all Regen message types (MsgBuyDirect, MsgRetire, etc.)
- **Wallet**: `DirectSecp256k1HdWallet.fromMnemonic()` with `regen` address prefix
- **Signing client**: `SigningStargateClient` with Regen proto registry, auto gas estimation
- **RPC**: Configurable via `REGEN_RPC_URL` (default: `mainnet.regen.network:26657`)

## Conventions

- Use ESM imports (`import`, not `require`)
- Prefer `fetch` (native in Node 20) over axios/node-fetch
- Error handling: throw typed errors, let MCP SDK handle serialization
- Tool descriptions should include trigger language ("Use this when...") — Claude reads them as context
- Config via environment variables (dotenv in dev, system env in production)
- `isWalletConfigured()` from `config.ts` is the single gate for all conditional behavior
