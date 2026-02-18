# Architecture

## System Overview

```
┌─────────────────────────────────────────────────────────────┐
│  AI Client (Claude Code / Cursor / MCP-compatible client)   │
│                                                             │
│  User invokes tools:                                        │
│  - "What's my session footprint?"                           │
│  - "Show me available credits"                              │
│  - "Retire credits for this session"                        │
└──────────────────────┬──────────────────────────────────────┘
                       │ MCP Protocol (stdio)
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  Regen Compute Credits MCP Server                           │
│                                                             │
│  Tools:                                                     │
│  ┌─────────────────────┐  ┌────────────────────────┐       │
│  │ estimate_session_    │  │ browse_available_      │       │
│  │ footprint            │  │ credits                │       │
│  └─────────────────────┘  └────────────────────────┘       │
│  ┌─────────────────────┐  ┌────────────────────────┐       │
│  │ get_retirement_     │  │ get_impact_summary     │       │
│  │ certificate          │  │                        │       │
│  └─────────────────────┘  └────────────────────────┘       │
│  ┌─────────────────────┐                                    │
│  │ retire_credits       │                                   │
│  └─────────────────────┘                                    │
│                                                             │
│  Services:                                                  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐    │
│  │ Ledger      │  │ Indexer     │  │ Footprint       │    │
│  │ Client      │  │ Client     │  │ Estimator       │    │
│  └──────┬──────┘  └──────┬──────┘  └─────────────────┘    │
└─────────┼────────────────┼──────────────────────────────────┘
          │                │
          ▼                ▼
┌──────────────┐  ┌─────────────────┐  ┌──────────────────┐
│ Regen Ledger │  │ Regen Indexer   │  │ Regen Marketplace│
│ REST API     │  │ GraphQL         │  │ (Web UI)         │
│              │  │                 │  │                  │
│ - Classes    │  │ - Retirement    │  │ - Credit card    │
│ - Projects   │  │   certificates  │  │   purchases      │
│ - Batches    │  │ - Aggregations  │  │ - Retirement     │
│ - Sell orders│  │ - User history  │  │   flow           │
└──────────────┘  └─────────────────┘  └──────────────────┘
```

## Data Flow

### Footprint Estimation

The MCP server estimates ecological footprint using heuristics — it cannot access Claude's internal compute metrics. The estimation model:

1. Track session duration (time since first tool call)
2. Count tool invocations as a proxy for compute intensity
3. Apply energy-per-query heuristics from published research (e.g., IEA data center projections)
4. Convert energy estimate to CO2e using grid average emission factors
5. Map CO2e to equivalent ecocredit retirement quantity

**Important**: This is always labeled as an *estimate*. We do not claim precision. The framing is "approximate footprint" to maintain credibility.

### Credit Browsing

Queries Regen Ledger REST API for:
- Active sell orders with pricing
- Credit class metadata (type, methodology, verification standard)
- Project details (location, jurisdiction, ecological outcomes)

Returns structured data for the AI client to present to the user.

### Credit Retirement

Phase 1: Generates a URL to the Regen Marketplace purchase page with pre-filled parameters (credit class, quantity, retire-on-purchase flag). User completes purchase via credit card in browser.

Phase 2+: Stripe subscription → pool service → batch retirement on-chain.

### Certificate Retrieval

Queries Regen Indexer GraphQL for retirement records:
- Beneficiary name and address
- Credits retired (quantity, class, batch)
- Project funded (name, location, methodology)
- On-chain transaction hash (immutable proof)

## Phase 2 Architecture (Subscription Pool)

```
┌────────────┐     ┌───────────────┐     ┌──────────────────┐
│ User pays  │────▶│ Stripe        │────▶│ Pool Service     │
│ $2/month   │     │ Subscription  │     │                  │
└────────────┘     └───────────────┘     │ - Track members  │
                                          │ - Aggregate funds│
                                          │ - Monthly batch  │
                                          │   purchase       │
                                          └────────┬─────────┘
                                                   │
                              ┌─────────────────────┼──────────────┐
                              ▼                     ▼              ▼
                   ┌──────────────┐    ┌───────────────┐  ┌──────────┐
                   │ Buy credits  │    │ Protocol fee  │  │ Generate │
                   │ on Regen     │    │ → Buy REGEN   │  │ certs    │
                   │ Marketplace  │    │ → Burn        │  │ per user │
                   │ (~88%)       │    │ (~10%)        │  │          │
                   └──────────────┘    └───────────────┘  └──────────┘
```

## Phase 3 Architecture (On-Chain Pool)

Replaces the centralized pool service with a CosmWasm smart contract on Regen Ledger v7.0+. The contract handles:
- Accepting USDC deposits
- Executing credit purchases from marketplace sell orders
- Retiring credits with fractional beneficiary attribution
- Routing protocol fee to REGEN burn address

This is a decentralization upgrade — same user experience, trustless execution.
