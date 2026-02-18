# CLAUDE.md — Regen Compute Credits

This file provides context to Claude Code when working on this project.

## Project Overview

Regen Compute Credits is an MCP (Model Context Protocol) server that connects AI compute usage to verified ecological credit retirement on Regen Network. Users connect it to Claude Code or Cursor, and it provides tools to estimate their AI session's ecological footprint, browse available credits, and retire them via Regen Marketplace's existing credit card flow.

## Strategic Context

Read `docs/analysis.md` for the full business analysis. Key points:

- **Problem**: Regen Network's REGEN token burn mechanics depend on ecocredit retirement volume, which is currently low. The demand-side flywheel is missing.
- **Solution**: AI compute users become the demand engine. Subscriptions → credit purchases → retirements → REGEN burns. Outside capital enters the system.
- **Framing**: This is "regenerative contribution," NOT "carbon offset." We fund verified ecological regeneration. We do not claim carbon neutrality. This distinction is strategic and legal.
- **Marketplace state**: ~2,000 carbon credits @ ~$40, ~80,000 biodiversity credits @ ~$26, credit card purchases live, retirement certificates exist on-chain.

## Tech Stack

- **Language**: TypeScript (ES2022, ESM modules)
- **Runtime**: Node.js >= 20
- **MCP SDK**: `@modelcontextprotocol/sdk`
- **Data sources**:
  - Regen Ledger REST API (credit classes, projects, batches, sell orders)
  - Regen Indexer GraphQL (`api.regen.network/indexer/v1/graphql`) — retirement certificates, aggregations
  - Regen Marketplace (`registry.regen.network`) — purchase flow links

## Project Structure

```
src/
├── index.ts              # MCP server entry point, tool registration
├── tools/
│   ├── footprint.ts      # estimate_session_footprint tool
│   ├── credits.ts        # browse_available_credits tool
│   ├── certificates.ts   # get_retirement_certificate tool
│   ├── impact.ts         # get_impact_summary tool
│   └── retire.ts         # retire_credits tool (marketplace link)
├── services/
│   ├── ledger.ts         # Regen Ledger REST client
│   ├── indexer.ts        # Regen Indexer GraphQL client
│   └── estimator.ts      # Footprint estimation heuristics
```

## Build Phases

- **Phase 1 (current)**: Read-only MCP server. Footprint estimation, credit browsing, certificate retrieval, marketplace purchase links.
- **Phase 2**: Stripe subscription pool. Monthly batch retirements with fractional attribution.
- **Phase 3**: CosmWasm smart contract for on-chain pool aggregation and REGEN burn.
- **Phase 4**: Enterprise API, platform partnerships, credit supply development.

## Key Design Decisions

1. **Heuristic footprint, not precise metering** — MCP servers cannot see Claude's internal compute. We estimate based on session duration and tool call count. Label clearly as an estimate.
2. **Link to existing marketplace, don't rebuild payment** — Phase 1 opens the Regen Marketplace credit card flow. We don't handle money until Phase 2.
3. **Both carbon AND biodiversity credits** — Biodiversity is the deeper inventory pool. Mix both for narrative strength ("ecological regeneration" > "carbon offset").
4. **Certificates are the shareable artifact** — The `regen.network/certificate/XYZ` page is the most viral, defensible piece. Prioritize making it beautiful and linkable.

## Regen Ledger API Notes

- REST endpoint: see `.env.example` for URLs
- Credit classes: `GET /regen/ecocredit/v1/classes`
- Projects: `GET /regen/ecocredit/v1/projects`
- Batches: `GET /regen/ecocredit/v1/batches`
- Sell orders: `GET /regen/ecocredit/marketplace/v1/sell-orders`
- Credit types on-chain: C (carbon), BT (biodiversity - Terrasos), KSH, MBS, USS

## Conventions

- Use ESM imports (`import`, not `require`)
- Prefer `fetch` (native in Node 20) over axios/node-fetch
- Error handling: throw typed errors, let MCP SDK handle serialization
- Keep tool descriptions concise — Claude reads them as context
- Config via environment variables (dotenv in dev, system env in production)
