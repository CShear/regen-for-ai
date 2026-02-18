# Build Phases & Roadmap

## Phase 1 — Proof-of-Concept MCP Server

**Goal**: A working MCP server that Claude Code / Cursor users can connect to browse credits, estimate their footprint, and retire credits via the existing Regen Marketplace.

**Duration**: 2–4 weeks
**Team**: 1 developer

### Deliverables

- [ ] MCP server with 5 tools (see README)
- [ ] Regen Ledger REST client (credit classes, projects, batches, sell orders)
- [ ] Regen Indexer GraphQL client (retirement certificates, aggregations)
- [ ] Footprint estimation heuristic (session duration + tool call count → CO2e estimate)
- [ ] Marketplace purchase link generator (pre-filled URL to registry.regen.network)
- [ ] OAuth/email authentication (user identity for retirement certificates)
- [ ] Documentation and installation guide
- [ ] Test with 10–20 internal users

### Key Decisions

- Footprint estimation is a heuristic, not precise metering. Label as "approximate."
- Purchase flow opens the existing Regen Marketplace in browser. We don't handle payments in Phase 1.
- Both carbon and biodiversity credits are surfaced.

---

## Phase 2 — Subscription Pool Service

**Goal**: Users subscribe for $1–5/month. A pool service aggregates funds and executes monthly batch credit retirements with fractional attribution per subscriber.

**Duration**: 4–8 weeks
**Team**: 1–2 developers
**Dependencies**: Phase 1 complete, Stripe account setup, legal review of subscription terms

### Deliverables

- [ ] Stripe subscription integration ($1 / $3 / $5 tiers)
- [ ] Pool accounting service (per-user contribution tracking)
- [ ] Monthly batch retirement execution
- [ ] Fractional attribution in retirement certificate metadata
- [ ] Protocol fee calculation and REGEN acquisition via DEX
- [ ] Certificate frontend (`regen.network/certificate/XYZ` or similar)
- [ ] User dashboard (subscription status, retirement history, impact stats)
- [ ] Test with 100–500 users from Regen + Claude communities

### Key Decisions

- Subscription framing: "Regenerative AI membership" (not "carbon offset subscription")
- Protocol fee: 8–12% of credit purchase value → REGEN buy-and-burn
- Batch retirement frequency: monthly (balances operational simplicity with user engagement)
- Credit selection: automated mix of carbon + biodiversity based on availability and price

---

## Phase 3 — CosmWasm Pool Contract

**Goal**: Replace the centralized pool service with an on-chain smart contract on Regen Ledger, enabling trustless aggregation, retirement, and REGEN burn.

**Duration**: 6–10 weeks
**Team**: 1 Cosmos/Rust developer + security auditor
**Dependencies**: Phase 2 operational, Regen Ledger v7.0 with CosmWasm live on mainnet

### Deliverables

- [ ] CosmWasm contract: pool deposit, batch retirement, fee routing
- [ ] REGEN burn mechanism integrated into contract execution
- [ ] Fractional beneficiary attribution in retirement metadata
- [ ] Migration path from Phase 2 centralized service
- [ ] Security audit by qualified Cosmos auditor
- [ ] Testnet deployment and validation
- [ ] Mainnet deployment via governance proposal

---

## Phase 4 — Scale Distribution

**Goal**: Grow from early adopter community to meaningful scale via enterprise API, platform partnerships, and credit supply development.

**Duration**: Ongoing
**Team**: 1 developer + 0.5 marketing/BD

### Workstreams

**Enterprise API**
- [ ] REST API for B2B customers (retire credits programmatically)
- [ ] ESG reporting integration (structured retirement data for compliance)
- [ ] Volume pricing and invoicing

**Platform Partnerships**
- [ ] Approach Anthropic with Phase 1–2 traction data
- [ ] Explore integration with Cursor, Windsurf, other AI dev tools
- [ ] "Regenerative AI" tier concept for AI platform checkout flows

**Credit Supply Development**
- [ ] Recruit credit issuers with high-frequency, small-denomination methodologies
- [ ] Priority: soil carbon, biochar, regenerative agriculture, mangrove, kelp
- [ ] Ensure continuous marketplace inventory ahead of demand growth

**Distribution Channels**
- [ ] MCP package for easy installation
- [ ] Browser extension (parallel channel to MCP)
- [ ] Web app for non-technical users

---

## Cost Estimates

| Phase | Duration | Cost Estimate |
|-------|----------|---------------|
| Phase 1: PoC MCP | 2–4 weeks | $8–15K |
| Phase 2: Subscription service | 4–8 weeks | $20–40K |
| Phase 3: Smart contract | 6–10 weeks | $30–60K |
| Phase 4: Distribution | Ongoing | $10K/month |
| **Total to production** | **~4–5 months** | **~$70–130K** |
