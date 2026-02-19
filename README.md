# Regen Compute Credits

**An MCP server that funds verified ecological regeneration from AI compute usage via Regen Network.**

Every AI session consumes energy. Regen Compute Credits turns that consumption into a funding mechanism for verified ecological regeneration — retiring real ecocredits on-chain through Regen Network's marketplace, with immutable proof of impact.

## Quick Start

### Install via npx (recommended)

```bash
claude mcp add -s user regen-compute-credits -- npx regen-compute-credits
```

That's it. The server is now available in all your Claude Code sessions.

### Or add to MCP settings manually

Add to your Claude Code config (`~/.claude.json`):

```json
{
  "mcpServers": {
    "regen-compute-credits": {
      "type": "stdio",
      "command": "npx",
      "args": ["regen-compute-credits"]
    }
  }
}
```

## What It Does

```
AI Session (Claude Code, Cursor, etc.)
    │
    ▼
Regen Compute Credits MCP Server
    │
    ├── Estimates session ecological footprint
    ├── Browses available credits on Regen Marketplace
    ├── Links to credit card purchase & retirement
    └── Returns verifiable retirement certificate
            │
            ▼
      Regen Network Ledger
      (on-chain retirement + REGEN protocol fee burn)
```

## MCP Tools

### `estimate_session_footprint`

Estimates the ecological footprint of your AI session based on duration and activity heuristics.

**When it's used:** The user asks about the environmental cost of their AI usage, or wants to know how much energy their session consumed.

**Example output:**
```
## Estimated Session Ecological Footprint

| Metric | Value |
|--------|-------|
| Session duration | 30 minutes |
| Estimated queries | ~45 |
| Energy consumption | ~0.45 kWh |
| CO2 equivalent | ~0.18 kg |
| Equivalent carbon credits | ~0.00018 credits |
| Estimated retirement cost | ~$0.01 |
```

### `browse_available_credits`

Lists ecocredits available on Regen Marketplace with live sell order data, recent activity, and project details.

**When it's used:** The user wants to explore credit options, compare carbon vs. biodiversity credits, or see what's available before purchasing.

**Example output:**
```
## Available Ecocredits on Regen Network

Regen Marketplace currently offers credits across 13 credit classes.

### Marketplace Snapshot (Live)
| Credit Type | Available Credits | Sell Orders |
|-------------|-------------------|-------------|
| Carbon | 16 | 5 |

### Recent Marketplace Orders
| Project | Credits | Retired? |
|---------|---------|----------|
| USS01-002 | 50.0 | Yes |
| BT01-001 | 92.0 | Yes |

### Credit Classes
C01 — Carbon: 3 projects in CD-MN, KE, PE-MDD
C02 — Carbon: 12 projects in US-WA, US-OH, ...
BT01 — Biodiversity (Terrasos): 8 projects in CO
```

### `get_retirement_certificate`

Retrieves a verifiable retirement certificate from Regen Network by transaction hash or certificate ID.

**When it's used:** The user has retired credits and wants proof, or wants to verify someone else's retirement.

**Example output:**
```
## Retirement Certificate

| Field | Value |
|-------|-------|
| Credits Retired | 0.09 |
| Credit Batch | C03-006-20150101-20151231-001 |
| Beneficiary | regen1xfw890d6chkud69c... |
| Jurisdiction | US-OR |
| Reason | 0G Foundation |
| Block Height | 25639429 |
| Transaction Hash | 685830bd0e148b0d7c... |

On-chain verification: This retirement is permanently
recorded on Regen Ledger and cannot be altered or reversed.
```

### `get_impact_summary`

Shows aggregate ecological impact statistics from Regen Network — live on-chain data.

**When it's used:** The user asks about the overall scale of Regen Network, or wants context on the ecosystem.

**Example output:**
```
## Regen Network Ecological Impact

### On-Chain Statistics
| Metric | Value |
|--------|-------|
| Credit classes | 13 |
| Active projects | 58 |
| Jurisdictions | 32 countries/regions |
| Total retirements on-chain | 44,170 |
| Total marketplace orders | 347 |

### Credit Types Available
| Type | Description |
|------|-------------|
| Carbon (C) | Verified carbon removal and avoidance |
| Biodiversity (BT) | Terrasos voluntary biodiversity credits |
| Marine Biodiversity (MBS) | Marine ecosystem stewardship |
| Umbrella Species (USS) | Habitat conservation |
| Kilo-Sheep-Hour (KSH) | Grazing-based stewardship |
```

### `retire_credits`

Generates a link to retire ecocredits via credit card on Regen Marketplace. No crypto wallet needed.

**When it's used:** The user wants to take action and actually fund ecological regeneration.

## MCP Prompts

The server also provides prompt templates for common workflows:

| Prompt | Description |
|--------|-------------|
| `offset_my_session` | Estimate footprint + browse credits + get retirement link |
| `show_regen_impact` | Pull live network stats and summarize ecological impact |

## Key Concepts

- **Regenerative contribution, not carbon offset.** We fund verified ecological regeneration. We do not claim carbon neutrality.
- **On-chain and immutable.** Every retirement is recorded on Regen Ledger — verifiable, non-reversible.
- **No crypto wallet needed.** Purchase via credit card on Regen Marketplace.
- **Multiple credit types.** Carbon, biodiversity, marine, soil, and species stewardship credits.
- **All tools are read-only.** Safe to use at any time. No transactions are executed by this server.

## Data Sources

| Source | What it provides |
|--------|------------------|
| [Regen Ledger REST](https://lcd-regen.keplr.app) | Credit classes, projects, batches, sell orders |
| [Regen Indexer GraphQL](https://api.regen.network/indexer/v1/graphql) | Retirement certificates, marketplace orders, aggregate stats |
| [Regen Marketplace](https://registry.regen.network) | Credit card purchase flow, project pages |

## Development

```bash
git clone https://github.com/CShear/regen-compute-credits.git
cd regen-compute-credits
npm install
cp .env.example .env
npm run dev       # Watch mode with hot reload
npm run build     # Production build
npm run typecheck # Type checking
```

## Build Phases

| Phase | Description | Status |
|-------|-------------|--------|
| **Phase 1** | MCP server — footprint estimation, credit browsing, marketplace links, certificates | In Progress |
| **Phase 2** | Subscription pool — Stripe, monthly batch retirements, fractional attribution | Planned |
| **Phase 3** | CosmWasm pool contract — on-chain aggregation, automated retirement, REGEN burn | Planned |
| **Phase 4** | Scale — enterprise API, platform partnerships, credit supply development | Planned |

See [Build Phases & Roadmap](docs/phases.md) for details.

## Contributing

We welcome contributions! See [CONTRIBUTING.md](.github/CONTRIBUTING.md) for guidelines.

## License

Apache-2.0 — see [LICENSE](LICENSE).
