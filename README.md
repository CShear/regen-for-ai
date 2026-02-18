# Regen Compute Credits

**An MCP agent that funds verified ecological regeneration from AI compute usage via Regen Network.**

Every AI session consumes energy. Regen Compute Credits turns that consumption into a funding mechanism for verified ecological regeneration — retiring real ecocredits on-chain through Regen Network's marketplace, with immutable proof of impact.

## How It Works

```
AI Session (Claude, Cursor, etc.)
    │
    ▼
Regen Compute Credits MCP Server
    │
    ├── Estimates session ecological footprint (heuristic)
    ├── Browses available credits on Regen Marketplace
    ├── Links to credit card purchase & retirement
    └── Returns verifiable retirement certificate
            │
            ▼
      Regen Network Ledger
      (on-chain retirement + REGEN protocol fee burn)
```

Users connect this MCP server to their AI coding tool. Each session can surface an ecological footprint estimate and offer one-click credit retirement through Regen Marketplace's existing credit card flow. No crypto wallet required.

## Current Status

**Phase 1 — Proof of Concept** (in development)

See [Build Phases & Roadmap](docs/phases.md) for the full plan.

## Quick Start

### Prerequisites

- Node.js >= 20
- A Claude Code, Cursor, or other MCP-compatible client

### Install & Run

```bash
git clone https://github.com/regen-network/regen-compute-credits.git
cd regen-compute-credits
npm install
cp .env.example .env
npm run build
```

### Connect to Claude Code

```bash
claude mcp add regen-compute-credits -- node /path/to/regen-compute-credits/dist/index.js
```

Or add to your Claude Code MCP settings manually:

```json
{
  "mcpServers": {
    "regen-compute-credits": {
      "command": "node",
      "args": ["/path/to/regen-compute-credits/dist/index.js"]
    }
  }
}
```

## MCP Tools (Phase 1)

| Tool | Description |
|------|-------------|
| `estimate_session_footprint` | Estimates the ecological footprint of the current AI session based on duration and activity heuristics |
| `browse_available_credits` | Lists ecocredits available for purchase on Regen Marketplace (carbon, biodiversity, etc.) |
| `get_retirement_certificate` | Retrieves a verifiable retirement certificate by ID from Regen Ledger |
| `get_impact_summary` | Shows aggregate impact stats — total credits retired, projects funded, CO2e equivalent |
| `retire_credits` | Opens Regen Marketplace purchase flow for credit retirement via credit card |

## Architecture

See [Architecture](docs/architecture.md) for the full technical design.

**Key integration points:**
- **Regen Ledger** — on-chain credit classes, projects, batches, retirement records
- **Regen Indexer GraphQL** — retirement certificates, aggregate queries
- **Regen Marketplace (registry.regen.network)** — credit card purchase flow
- **MCP Protocol** — tool definitions served to Claude Code, Cursor, etc.

## Marketplace Context

Regen Network's marketplace currently has:
- ~2,000 carbon credits at ~$40/credit
- ~80,000 biodiversity credits at ~$26/credit
- Credit card purchasing is live (no crypto wallet needed)
- On-chain retirement with beneficiary metadata and verifiable certificates

## Background & Analysis

This project was born from an analysis of how AI compute's growing ecological footprint can be channeled into verified regeneration through Regen Network's existing infrastructure.

Read the full analysis: **[The Regen Agent: Ecological Accountability for AI Compute](docs/analysis.md)**

Key insight: instead of waiting for ecological credit markets to grow organically, AI compute users become the demand-side flywheel — outside capital flows into credit purchases, triggers retirements, and the protocol fee creates systematic REGEN buy pressure.

## Build Phases

| Phase | Description | Status |
|-------|-------------|--------|
| **Phase 1** | Proof-of-concept MCP server — footprint estimation, credit browsing, marketplace links, certificates | In Progress |
| **Phase 2** | Subscription pool service — Stripe, monthly batch retirements, fractional attribution | Planned |
| **Phase 3** | CosmWasm pool contract — on-chain aggregation, automated retirement, REGEN burn | Planned |
| **Phase 4** | Scale distribution — enterprise API, platform partnerships, credit supply development | Planned |

See [Build Phases & Roadmap](docs/phases.md) for details.

## Contributing

We welcome contributions! See [CONTRIBUTING.md](.github/CONTRIBUTING.md) for guidelines.

**Good first issues:**
- Improve footprint estimation heuristics
- Add more credit class metadata display
- Build certificate rendering component
- Write tests for MCP tool handlers

### Development

```bash
npm run dev       # Watch mode with hot reload
npm run typecheck # Type checking
npm run lint      # Linting
npm run build     # Production build
```

## License

Apache-2.0 — see [LICENSE](LICENSE).
