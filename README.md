# Regen for AI

**Add Regenerative AI to your Claude Code in 30 seconds.**

[![npm version](https://img.shields.io/npm/v/regen-for-ai)](https://www.npmjs.com/package/regen-for-ai)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-green)](LICENSE)
[![MCP](https://img.shields.io/badge/MCP-compatible-blue)](https://modelcontextprotocol.io)

Every AI session consumes energy. This MCP server lets your AI assistant estimate that footprint and retire verified ecocredits on [Regen Network](https://regen.network) — with immutable on-chain proof.

This is **regenerative contribution**, not carbon offsetting. No neutrality claims. Just verified funding of ecological regeneration.

## Install

```bash
claude mcp add -s user regen-for-ai -- npx regen-for-ai
```

That's it. Works immediately — no API keys, no wallet, no configuration needed for read-only tools.

### Other MCP clients (Cursor, Windsurf, etc.)

Add to your MCP config:

```json
{
  "mcpServers": {
    "regen-for-ai": {
      "type": "stdio",
      "command": "npx",
      "args": ["regen-for-ai"]
    }
  }
}
```

## What You Get

| Tool | What it does |
|------|-------------|
| `estimate_session_footprint` | Estimate energy, CO2, and retirement cost for your AI session |
| `browse_available_credits` | Browse live sell orders on Regen Marketplace (carbon, biodiversity, marine, species) |
| `retire_credits` | Retire credits on-chain (with wallet) or get a credit card purchase link (without) |
| `get_retirement_certificate` | Verify any retirement with on-chain proof |
| `get_impact_summary` | Regen Network aggregate stats — projects, retirements, jurisdictions |
| `browse_ecobridge_tokens` | List 50+ tokens across 10+ chains for cross-chain payment |
| `retire_via_ecobridge` | Pay with USDC/ETH/etc. on Ethereum, Base, Polygon, Arbitrum, and more |

### Three payment modes — pick what works for you

1. **Credit card** (default, no setup) — get a Regen Marketplace link
2. **Direct on-chain** — set `REGEN_WALLET_MNEMONIC`, retire in a single tx
3. **Any token, any chain** — USDC on Base, ETH on Arbitrum, etc. via [ecoBridge](https://bridge.eco)

## How It Works

```
Your AI Assistant (Claude Code / Cursor / etc.)
    │
    │ MCP Protocol (stdio)
    ▼
Regen for AI MCP Server
    │
    ├─ Footprint estimation (heuristic, clearly labeled as approximate)
    ├─ Credit browsing (live sell order data from Regen Ledger)
    ├─ Retirement execution (MsgBuyDirect with auto-retire)
    └─ Certificate retrieval (on-chain verification)
    │
    ▼
Regen Network Ledger (immutable, verifiable, non-reversible)
```

If anything fails during on-chain retirement, it falls back to a marketplace link. Users are never stuck.

## Configuration

Works with zero config. Set environment variables for advanced features:

```bash
cp .env.example .env
```

| Variable | Required | What it enables |
|----------|----------|----------------|
| *(none)* | — | Footprint estimation, credit browsing, impact stats, marketplace links |
| `REGEN_WALLET_MNEMONIC` | Optional | Direct on-chain retirement (MsgBuyDirect) |
| `ECOBRIDGE_EVM_MNEMONIC` | Optional | Cross-chain payment via ecoBridge (send USDC, ETH, etc.) |
| `ECOBRIDGE_ENABLED=false` | Optional | Disable ecoBridge tools |

See [`.env.example`](.env.example) for all options with inline documentation.

## MCP Prompts

Pre-built workflows you can invoke:

| Prompt | Workflow |
|--------|----------|
| `offset_my_session` | Estimate footprint → browse credits → retire |
| `show_regen_impact` | Pull live network stats and summarize |
| `retire_with_any_token` | Browse ecoBridge tokens → pick chain/token → retire |

## Credit Types

| Type | Description |
|------|-------------|
| Carbon (C) | Verified carbon removal and avoidance |
| Biodiversity (BT) | Terrasos voluntary biodiversity credits |
| Marine Biodiversity (MBS) | Marine ecosystem stewardship |
| Umbrella Species (USS) | Habitat conservation via umbrella species |
| Kilo-Sheep-Hour (KSH) | Grazing-based land stewardship |

## Data Sources

| Source | What it provides |
|--------|------------------|
| [Regen Ledger REST](https://lcd-regen.keplr.app) | Credit classes, projects, batches, sell orders |
| [Regen Indexer GraphQL](https://api.regen.network/indexer/v1/graphql) | Retirement certificates, marketplace orders, stats |
| [Regen Marketplace](https://app.regen.network) | Credit card purchase flow |
| [ecoBridge API](https://api.bridge.eco) | Cross-chain tokens, prices, widget links |

## Development

```bash
git clone https://github.com/CShear/regen-for-ai.git
cd regen-for-ai
npm install
cp .env.example .env
npm run dev       # Watch mode with hot reload
npm run lint      # ESLint checks
npm test          # Vitest unit tests
npm run build     # Production build
npm run typecheck # Type checking
npm run verify    # Typecheck + lint + test + build
regen-for-ai --help  # CLI usage
```

## Release

`v0.3.0` publish flow is automated by GitHub Actions:

1. Ensure `main` is green (`ci.yml` passes typecheck/lint/test/build).
2. Confirm `package.json` version is the target release version.
3. Push a tag matching package version, e.g. `v0.3.0`.
4. `publish-npm.yml` verifies the build and publishes to npm with provenance.

Manual fallback is available via `workflow_dispatch` for recoverable release retries.

## Roadmap

| Phase | Status |
|-------|--------|
| **1.0** Read-only MCP — footprint, browsing, marketplace links, certificates | Complete |
| **1.5** On-chain retirement — wallet signing, order routing, ecoBridge cross-chain | Complete |
| **2.0** Subscription pool — Stripe, monthly batch retirements, fractional attribution | [In progress](ROADMAP.md) |
| **3.0** Smart contract — CosmWasm pool, automated retirement, REGEN burn | Planned |
| **4.0** Scale — enterprise API, platform partnerships, credit supply development | Planned |

See [ROADMAP.md](ROADMAP.md) for the full 3-track rollout plan, dependency graph, and business context.

## Contributing

We welcome contributions! See [CONTRIBUTING.md](.github/CONTRIBUTING.md) for the issue workflow, label guide, and branch conventions.

Good first issues: [`gh issue list --label "good first issue"`](https://github.com/CShear/regen-for-ai/labels/good%20first%20issue)

## License

Apache-2.0 — see [LICENSE](LICENSE).
