# We Built the First Verified Ecological Accountability Tool for AI

Every AI session consumes energy. Data centers are projected to consume over 1,000 TWh annually by 2026 — roughly the electricity demand of Japan. If you use Claude Code, Cursor, or any AI coding assistant daily, your work has an ecological footprint. Most developers know this. Almost none can do anything about it from inside their workflow.

The "green AI" solutions that exist today fall into two categories: corporate marketing claims with no verifiable proof, and traditional Renewable Energy Certificate (REC) markets that operate in private databases where retirement claims are impossible to independently audit. There is no tool that lives inside your AI assistant, connects to a verifiable on-chain registry, and lets you fund real ecological regeneration with proof you can share.

We built one.

## Introducing Regen for AI

[Regen for AI](https://github.com/CShear/regen-for-ai) is an MCP (Model Context Protocol) server that connects your AI coding assistant to verified ecological credit retirement on [Regen Network](https://regen.network). Install it with one command:

```bash
claude mcp add -s user regen-for-ai -- npx regen-for-ai
```

That's it. No API keys. No wallet. No configuration. It works immediately.

Once connected, your AI assistant gains the ability to estimate session footprint, browse live ecological credit inventory, retire credits on-chain, and retrieve verifiable retirement certificates. Every retirement is recorded on the Regen Ledger — an immutable public blockchain. Not a private database. Not a marketing dashboard. A public, auditable, permanent record.

One important distinction: this is **regenerative contribution**, not carbon offsetting. We do not claim your AI session becomes "carbon neutral." We do not pretend to know the exact kilowatt-hours your session consumed. What we do is fund verified ecological regeneration and give you on-chain proof that you did it. The framing matters — "your AI session funded the retirement of 0.03 verified ecological credits on Regen Network" is factual, verifiable, and immune to greenwashing criticism.

## How It Works

The workflow has four steps. Here is what each one does inside your AI assistant:

**Step 1 — Estimate your footprint.** Call `estimate_session_footprint` with your session duration. The tool returns an energy estimate (kWh), CO2 equivalent (kg), and a suggested credit retirement quantity. This is explicitly labeled as a heuristic — we are honest about the uncertainty because that honesty is what separates this from greenwashing.

**Step 2 — Browse available credits.** Call `browse_available_credits` to see what is currently for sale on Regen Marketplace. This pulls live sell order data from the Regen Ledger — not cached data, not a static list. You see real inventory with real prices from real projects.

**Step 3 — Retire credits.** Call `retire_credits`. If you have no wallet configured, you get a direct marketplace link to purchase via credit card. If you have a Regen wallet configured, it executes the retirement on-chain in a single transaction. If the on-chain path fails for any reason, it falls back to a marketplace link. You are never stuck.

**Step 4 — Get your certificate.** Call `get_retirement_certificate` with your transaction hash. You get back the project funded, credits retired, beneficiary name, jurisdiction, and an on-chain transaction proof. This is your shareable, permanent, auditable artifact.

<!-- TODO: Add screenshot/GIF of the full workflow running in Claude Code -->

## What Makes This Different

**On-chain verification.** Retirements happen on the Regen Ledger, a public blockchain purpose-built for ecological credits. Every retirement is independently verifiable by anyone. This is fundamentally different from traditional offset registries where retirement claims live in private databases.

**Beyond carbon.** Regen Network hosts five types of ecological credits:

| Type | What It Funds |
|------|---------------|
| Carbon (C) | Verified carbon removal and avoidance |
| Biodiversity (BT) | Voluntary biodiversity conservation (Terrasos, Colombia) |
| Marine Biodiversity (MBS) | Marine ecosystem stewardship |
| Umbrella Species (USS) | Habitat conservation via umbrella species protection |
| Kilo-Sheep-Hour (KSH) | Grazing-based land stewardship |

This is ecological regeneration, not just carbon accounting.

**MCP-native.** The tool lives inside your AI assistant. You do not visit a separate website, switch contexts, or leave your workflow. Your AI knows when to suggest it and how to use it.

**Three payment modes.** Pick what works for you:
1. **Credit card** (default, no setup) — get a Regen Marketplace purchase link
2. **Direct on-chain** — set `REGEN_WALLET_MNEMONIC` and retire in a single transaction
3. **Any token, any chain** — send USDC on Base, ETH on Arbitrum, or 50+ other tokens across 10+ blockchains via [ecoBridge](https://bridge.eco)

**Graceful degradation.** No wallet? Marketplace links. Wallet configured? On-chain retirement. Error in the on-chain path? Fallback to links. Every failure mode has a recovery path.

## The Numbers

The Regen Marketplace currently has live inventory:

- **318** carbon credits available across multiple vintages and project types
- **7,397** biodiversity credits from Terrasos projects in Colombia
- **73,830** umbrella species stewardship credits
- **13** credit classes spanning **5** credit types
- Projects in **9+ countries**: US, Kenya, Peru, Indonesia, Congo, Cambodia, UK, Australia, Colombia

That is roughly **$2M+** in purchasable ecological credits on a public, verifiable marketplace — enough inventory to serve tens of thousands of users.

## Why "Regenerative Contribution" and Not "Carbon Offset"

Carbon offset claims are legally fraught and scientifically imprecise. The relationship between AI energy consumption and ecological damage is not 1:1. Different models, different data centers, different energy mixes — the variables make precise accounting impossible at the individual session level.

We chose a different path. Our footprint estimation is clearly labeled as a heuristic approximation. We never claim your session is "carbon neutral." Instead, we make a positive, factual claim: *your AI session funded the retirement of X verified ecological credits on Regen Network.* This claim is:

- **Factual** — the retirement happened, on-chain, with a transaction hash
- **Verifiable** — anyone can look it up on the Regen Ledger
- **Permanent** — retirements are non-reversible
- **Auditable** — the certificate page shows the project, the credits, and the proof

This is not about guilt. It is about building accountability into the tools we already use.

## Technical Architecture

For developers who want to understand what is under the hood:

```
Your AI Assistant (Claude Code / Cursor / etc.)
    |
    | MCP Protocol (stdio)
    v
Regen for AI MCP Server (TypeScript, Node.js 20+)
    |
    |-- Footprint estimation (heuristic, labeled as approximate)
    |-- Credit browsing (live sell order data from Regen Ledger REST)
    |-- Retirement execution (MsgBuyDirect with auto-retire via @cosmjs)
    |-- Certificate retrieval (Regen Indexer GraphQL)
    |-- Cross-chain payment (ecoBridge API + ethers v6)
    |
    v
Regen Network Ledger (immutable, verifiable, non-reversible)
```

The server is built with TypeScript on the `@modelcontextprotocol/sdk`. On-chain signing uses `@cosmjs/proto-signing` and `@cosmjs/stargate` with the `@regen-network/api` proto registry. Cross-chain payments go through the [ecoBridge API](https://bridge.eco) with `ethers` v6 for EVM transaction signing.

All marketplace data is live — credit browsing queries the Regen Ledger REST API for current sell orders, and certificate retrieval queries the Regen Indexer GraphQL endpoint. Nothing is hardcoded.

The project is open source under the Apache-2.0 license.

## Getting Started

### Claude Code (one command)

```bash
claude mcp add -s user regen-for-ai -- npx regen-for-ai
```

### Cursor, Windsurf, or any MCP client

Add to your MCP configuration:

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

Then try asking your AI assistant:

> "What's the ecological footprint of this session?"

Or:

> "Show me what ecological credits are available on Regen Network."

Three levels of engagement:
1. **Just browse** — install and explore credits and impact stats (zero config)
2. **Retire via credit card** — use the marketplace link to purchase and retire
3. **Go on-chain** — configure a wallet for direct retirement, or use ecoBridge to pay with any token

## What's Next

Regen for AI v0.3.0 is live on [npm](https://www.npmjs.com/package/regen-for-ai) today. Here is what is coming:

- **Subscription pool** — $2-$10/month tiers with automated monthly batch retirements and per-subscriber attribution
- **Smart contract** — CosmWasm on-chain pool aggregation on Regen Ledger, replacing the centralized batch service
- **Platform partnerships** — native "Regenerative AI" integration in AI assistants
- **Credit supply expansion** — onboarding new project developers for soil carbon, biochar, mangrove, and kelp credits

Want to contribute? The project is open source: [github.com/CShear/regen-for-ai](https://github.com/CShear/regen-for-ai). Check the [issues](https://github.com/CShear/regen-for-ai/issues) for open tasks, or read the [ROADMAP.md](https://github.com/CShear/regen-for-ai/blob/main/ROADMAP.md) for the full strategic context.

## The Vision

AI, which is powered by burning energy, can provide the economic engine to fund ecological regeneration. Not through guilt. Not through marketing. Through verified, on-chain, permanent proof of contribution to real projects in real places — forests in Kenya, biodiversity reserves in Colombia, marine ecosystems in Indonesia, grazing lands in the UK.

One command to install. On-chain proof of every retirement. Real regeneration funded by real contributions.

That is what Regenerative AI looks like.

---

*Regen for AI is published on [npm](https://www.npmjs.com/package/regen-for-ai) as v0.3.0. Source code: [github.com/CShear/regen-for-ai](https://github.com/CShear/regen-for-ai). Licensed Apache-2.0.*
