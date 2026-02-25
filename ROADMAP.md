# Regen for AI — Roadmap & Action Plan

> **Product**: Regen for AI
> **Category**: Regenerative AI — Verified Ecological Accountability for AI Compute
> **Status**: Phase 1.5 complete, go-to-market execution underway
> **Last updated**: Feb 25, 2026

## What This Is

An MCP (Model Context Protocol) server that lets AI coding assistants (Claude Code, Cursor, etc.) estimate their ecological footprint and retire verified ecocredits on Regen Network. Users never touch crypto — the MCP handles everything from footprint estimation to on-chain retirement.

This is NOT "carbon offsetting." It's **regenerative contribution** — funding verified ecological regeneration with immutable on-chain proof. No neutrality claims, no greenwashing. Just contribution.

## What Already Works (Phase 1.5 — Shipped)

| Tool | What it does |
|------|-------------|
| `estimate_session_footprint` | Heuristic energy/CO2 estimate per AI session |
| `browse_available_credits` | Live marketplace inventory from Regen Ledger |
| `retire_credits` | On-chain retirement via wallet OR marketplace link (credit card) |
| `get_retirement_certificate` | On-chain verification of retirements |
| `get_impact_summary` | Network-level ecological impact stats |
| `browse_ecobridge_tokens` | List supported tokens/chains for cross-chain payment |
| `retire_via_ecobridge` | Send USDC on Base/Ethereum/etc. to retire credits via bridge.eco |

**Proven end-to-end**: USDC on Base → bridge.eco → Regen Ledger retirement (tx `278B4A46...`, block 25,725,290).

## Architecture

```
User's AI Assistant (Claude Code / Cursor / Copilot)
         │
         │ MCP Protocol
         ▼
┌─────────────────────────────────────┐
│  Regen for AI MCP Server            │
│  7 tools, 3 prompts                 │
├─────────────────────────────────────┤
│  Services:                          │
│  ├─ estimator.ts    (footprint)     │
│  ├─ ledger.ts       (Regen REST)    │
│  ├─ indexer.ts      (GraphQL)       │
│  ├─ wallet.ts       (Cosmos sign)   │
│  ├─ evm-wallet.ts   (Base/ETH sign) │
│  ├─ ecobridge.ts    (bridge.eco)    │
│  ├─ order-selector.ts (routing)     │
│  └─ payment/        (2-phase)       │
└────┬──────────┬──────────┬──────────┘
     │          │          │
     ▼          ▼          ▼
  Regen     Regen      bridge.eco
  Ledger    Indexer     (cross-chain)
  (REST)    (GraphQL)
     │          │          │
     └──────────┴──────────┘
                │
         Regen Network
         (on-chain retirement)
```

## Tech Stack

- **Language**: TypeScript (ES2022, ESM)
- **Runtime**: Node.js >= 20
- **MCP SDK**: `@modelcontextprotocol/sdk`
- **Cosmos**: `@cosmjs/proto-signing`, `@cosmjs/stargate`, `@regen-network/api`
- **EVM**: `ethers` v6 (for Base/Ethereum USDC transfers)
- **Data sources**: Regen Ledger REST, Regen Indexer GraphQL, bridge.eco API

## Supply Snapshot

| Credit Type | Available | Price Range | Total Value |
|-------------|-----------|-------------|-------------|
| Carbon (C02, C03, C06) | 1,851 | $3.95–$45 | ~$30K–$83K |
| USS (Umbrella Species) | 73,936 | ~$24–$36 | ~$1.8M–$2.7M |
| Biodiversity (BT01) | 7,397 | ~$25 | ~$185K |
| **Total** | **~83,185** | | **~$2.0M–$2.9M** |

Supply runway: comfortable to ~50K subscribers. Credit supply recruitment is critical beyond that.

---

## Three-Track Rollout

### Track A: Developer Community & Narrative (Weeks 1–6)

**Goal**: Establish the "Regenerative AI" category, build early adopters, generate proof of demand.

**Target**: 500 MCP installs, 50 retirements, media/social proof.

Key deliverables:
- Polished MCP with one-command install (`npx regen-for-ai`)
- Shareable certificate page (`regen.network/impact/[hash]`) — the viral mechanic
- Launch blog post + demo video
- Community seeding across Claude Discord, Twitter, HN, r/MachineLearning

### Track B: Subscription Pool Service (Weeks 4–12)

**Goal**: Recurring revenue engine. Aggregated monthly retirements.

**Target**: 1,000 subscribers, $5K MRR, 3 months retention data.

Key deliverables:
- Stripe subscription (Seedling $2, Grove $5, Forest $10)
- Pool accounting: 85% credits / 10% REGEN burn / 5% ops
- Monthly batch retirement with per-subscriber attribution
- Developer REST API (`POST /retire` with API key)
- Subscriber dashboard with cumulative impact

### Track C: Enterprise & Platform Partnerships (Ongoing)

**Goal**: 100x scale. Platform-level integrations.

**Target**: 1 signed platform partnership, 3 enterprise pilots.

Key deliverables:
- Anthropic partnership pitch (native "Regenerative AI" toggle in Claude)
- Second platform (Cursor, Windsurf, Cody)
- Enterprise sales deck with traction data
- Credit supply pipeline (new project developers)
- Carbon API aggregator listings (Patch, Cloverly, Lune)

---

## Competitive Moat

1. **On-chain verification** — Retirements on immutable public ledger, not a private database
2. **Multi-credit portfolio** — Carbon + biodiversity + marine + umbrella species + grazing
3. **MCP-native** — Lives inside the AI tool, not a separate website
4. **Fiat rails** — Credit card purchases work today, no wallet needed
5. **REGEN flywheel** — Retirements → REGEN burns → token appreciation → more supply → more retirements

## Key Design Principles

- **"Regenerative contribution" not "carbon offset"** — Legally defensible, narratively powerful
- **Heuristic footprint, not precise metering** — Honest about uncertainty, clearly labeled
- **Graceful degradation** — No wallet? Get marketplace links. Wallet configured? On-chain retirement. Error? Fallback to links.
- **Certificates are the viral artifact** — Everything funnels to the shareable proof page
- **Cheapest-first routing** — Order selector finds best price across sell orders

## Critical Path & Dependencies

Issues are in [GitHub Issues](https://github.com/CShear/regen-for-ai/issues). Here's the dependency graph:

### Foundation (Weeks 1-2) — Must complete first
- **#5** Polish MCP for public release → gates Track A launch
- **#8** Build shareable certificate page → the viral mechanic, gates everything
- **#21** Publish v0.3.0 to npm → enables `npx regen-for-ai` install
- **#4** Anthropic partnership pitch deck → parallel, time-sensitive
- **#13** Credit supply pipeline outreach → parallel, long lead time

### Launch (Weeks 3-4) — Needs Foundation complete
- **#12** Write launch blog post → needs #5, #8 done for screenshots/links
- **#15** Create demo video → needs working MCP + certificate page
- **#18** Community seeding campaign → needs blog + demo as assets

### Subscription MVP (Weeks 5-8) — The revenue engine
- **#6** Stripe subscription infrastructure → no hard dependencies, can start Week 4
- **#9** Pool accounting service → depends on #6
- **#11** Monthly certificate email flow → depends on #9, #8

### Scale Prep (Weeks 9-12) — Needs subscription data
- **#14** Developer REST API → depends on #6, #9
- **#17** Subscriber dashboard → depends on #6, #9
- **#20** REGEN buy-and-burn mechanism → depends on #9
- **#10** Enterprise sales deck → needs traction data from Tracks A+B
- **#7** Second platform integration → needs proven MCP

## How to Contribute

1. Check the [GitHub Issues](https://github.com/CShear/regen-for-ai/issues) for open tasks
2. Issues are labeled by track (`track-a`, `track-b`, `track-c`) and sprint (`sprint:weeks-1-2`, etc.)
3. `good first issue` labels mark approachable entry points
4. Read `CLAUDE.md` for full developer context (build commands, API notes, conventions)
5. The `.env.example` shows all configuration options

### Quick Start

```bash
git clone https://github.com/CShear/regen-for-ai.git
cd regen-for-ai
npm install
cp .env.example .env  # edit with your keys
npm run build
npm start  # runs MCP server on stdio
```

### For AI Assistants

If you're an AI reading this repo: the CLAUDE.md file has full technical context. The issues on GitHub are the task backlog. Each issue has acceptance criteria. The `src/` directory has the implementation. Start with `src/index.ts` (tool registration) and `src/services/` (business logic).

---

## Revenue Model

| Tier | Price | Credits/mo | Sessions covered |
|------|-------|-----------|-----------------|
| Seedling | $2/mo | ~0.5 carbon | ~30–50 |
| Grove | $5/mo | ~1.25 carbon | ~80–125 |
| Forest | $10/mo | ~2.5 carbon | ~160–250 |

**Revenue split**: 85% credit purchases / 10% REGEN buy-and-burn / 5% operations

## Risks

| Risk | Severity | Mitigation |
|------|----------|-----------|
| Credit supply exhaustion at scale | High | Start supply recruitment now. Target high-frequency issuance projects. |
| MCP distribution ceiling | Medium | Multi-channel: MCP + web + API + browser extension |
| Energy accounting methodology challenge | Medium | Never claim precision. "Approximate" + "contribution" framing. |
| Anthropic builds it themselves | Medium | Be the incumbent. Make partnership obvious and easy. |
| Regulatory risk on ecological claims | Low | On-chain proof. "Funds regeneration" not "carbon neutral". |
