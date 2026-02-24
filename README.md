# Regen for AI

**Regenerative AI — fund verified ecological regeneration from your AI sessions via Regen Network.**

Every AI session consumes energy. Regen for AI turns that consumption into a funding mechanism for verified ecological regeneration — retiring real ecocredits on-chain through Regen Network's marketplace, with immutable proof of impact.

## Quick Start

### Install via npx (recommended)

```bash
claude mcp add -s user regen-for-ai -- npx regen-for-ai
```

That's it. The server is now available in all your Claude Code sessions.

### Or add to MCP settings manually

Add to your Claude Code config (`~/.claude.json`):

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

## What It Does

```
AI Session (Claude Code, Cursor, etc.)
    │
    ▼
Regen for AI MCP Server
    │
    ├── Estimates session ecological footprint
    ├── Browses available credits on Regen Marketplace
    ├── Retires credits directly on-chain (with wallet)
    │   OR links to credit card purchase (without wallet)
    │   OR bridges any token via ecoBridge (USDC, ETH, etc.)
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

### `list_subscription_tiers`

Lists recurring contribution tiers and configuration status for Stripe price mappings.

**When it's used:** The user wants to see available monthly plans (`$1/$3/$5`) before subscribing.

**Example output:**
```
## Subscription Tiers

| Tier | Name | Monthly Price | Description | Stripe Price Config |
|------|------|---------------|-------------|---------------------|
| starter | Starter | $1/month | Entry tier for monthly ecological contributions. | Configured |
| growth | Growth | $3/month | Balanced recurring contribution tier. | Configured |
| impact | Impact | $5/month | Highest monthly contribution tier. | Configured |
```

### `manage_subscription`

Creates, updates, checks, or cancels Stripe subscription state for a customer.

**Actions:** `subscribe`, `status`, `cancel`

**Parameters:**

| Parameter | Description |
|-----------|-------------|
| `action` | One of `subscribe`, `status`, `cancel`. Required. |
| `tier` | Plan ID for subscribe: `starter` ($1), `growth` ($3), `impact` ($5). |
| `email` | Customer email for lookup/creation. |
| `customer_id` | Existing Stripe customer ID (alternative to email). |
| `full_name` | Name to use when creating a Stripe customer. |
| `payment_method_id` | Stripe PaymentMethod to set as default when subscribing. |

### `sync_subscription_pool_contributions`

Fetches paid Stripe invoices for a customer and records them into pool accounting with duplicate protection by invoice ID (`stripe_invoice:<id>`).

**When it's used:** Subscription reconciliation and safe reruns of invoice ingestion without double-counting.

**Parameters:**

| Parameter | Description |
|-----------|-------------|
| `month` | Optional month filter in `YYYY-MM` format. |
| `email` | Stripe customer email (alternative to `customer_id`). |
| `customer_id` | Stripe customer ID (alternative to `email`). |
| `user_id` | Optional internal user ID override for attribution. |
| `limit` | Optional max invoices to fetch (`1-100`, default `100`). |

### `sync_all_subscription_pool_contributions`

Fetches paid Stripe invoices account-wide (across customers) and records them into pool accounting with duplicate protection by invoice ID (`stripe_invoice:<id>`).

**When it's used:** Monthly reconciliation across the full subscription base before running pooled batch retirement.

**Parameters:**

| Parameter | Description |
|-----------|-------------|
| `month` | Optional month filter in `YYYY-MM` format. |
| `limit` | Per-page Stripe invoice fetch size (`1-100`, default `100`). |
| `max_pages` | Max invoice pages to fetch (`1-50`, default `10`). |

### `record_pool_contribution`

Records a contribution event in the pool ledger for per-user accounting and monthly aggregation.

**When it's used:** Internal/admin workflows that ingest paid subscription events into the retirement pool ledger.

Supports optional `source_event_id` for idempotent writes when ingesting external payment events.

### `get_pool_accounting_summary`

Returns either:
- user-level contribution summary (lifetime + by-month totals), or
- month-level pool aggregate summary (total amount + contributors).

**When it's used:** Preparing monthly batch retirement inputs and reconciling contributor balances.

### `run_monthly_batch_retirement`

Executes the monthly pooled retirement batch from the contribution ledger.

Supports:
- `dry_run=true` planning (default, no on-chain transaction),
- real execution with `dry_run=false`,
- duplicate-run protection per month (override with `force=true`),
- automated carbon+biodiversity mix policy when `credit_type` is omitted,
- protocol fee allocation (configurable `8%-12%`, default `10%`) with gross/fee/net budget reporting,
- protocol fee REGEN acquisition adapter output (planned/executed/skipped),
- REGEN burn execution status (planned/executed/skipped/failed).

**When it's used:** Running the monthly pooled buy-and-retire process from aggregated subscription funds.

### `run_monthly_reconciliation`

Runs an operator workflow in one call:
1. Optional contribution sync from Stripe paid invoices, then
2. Monthly batch retirement planning/execution.

Supports all `run_monthly_batch_retirement` execution parameters plus sync controls:
- `sync_scope`: `none` | `customer` | `all_customers` (default),
- `email` / `customer_id` / `user_id` for customer-scoped sync,
- `invoice_limit` and `invoice_max_pages` for Stripe pagination control,
- `sync_timeout_ms` / `batch_timeout_ms` to bound sync and batch phase runtime,
- `preflight_only` (default `false`) to run sync + safety checks without executing the batch,
- `allow_partial_sync` (default `false`) to explicitly allow execution after truncated all-customer sync,
- `allow_execute_without_dry_run` (default `false`) to allow live execution without a latest prior dry-run for the same month/credit type.

All-customer sync output now reports whether Stripe pagination was truncated by the `invoice_max_pages` cap so operators can rerun with a higher limit when needed.
Live execution preflight also requires the latest record for that month/credit type to be a fresh `dry_run` (not older than the latest contribution), unless explicitly overridden.
Reconciliation runs are also single-flight per month/credit type; concurrent overlapping requests are rejected until the active run completes.
When a sync/batch timeout is hit, the run lock remains active until the timed-out phase fully settles, preventing overlapping retries from racing.
Single-flight locking is now file-backed (`REGEN_RECONCILIATION_LOCKS_DIR`) so overlap protection survives process restarts and works across multiple workers sharing the same filesystem.
If reconciliation run-history persistence fails, execution continues but returns explicit warnings in tool output.

**When it's used:** Monthly close/reconciliation where operators want deterministic “sync then run batch” execution with one tool invocation.

### `get_monthly_batch_execution_history`

Returns stored monthly batch execution history from the local execution ledger (`REGEN_BATCH_EXECUTIONS_PATH`) with optional filters:
- `month` (`YYYY-MM`)
- `status` (`success` | `failed` | `dry_run`)
- `credit_type` (`carbon` | `biodiversity`)
- `dry_run` (`true` / `false`)
- `limit` (`1-200`, default `50`)

**When it's used:** Operator auditing, post-run troubleshooting, and confirming prior dry-run/success/failure outcomes.

### `get_monthly_reconciliation_status`

Returns an operator readiness snapshot for a month by combining:
- pool contribution totals,
- protocol fee and net budget preview,
- latest batch execution state (`none`/`dry_run`/`success`/`failed`),
- latest successful execution lookup (not just latest attempt),
- actionable recommendation for the next step.

**Parameters:**
- `month` (`YYYY-MM`, required)
- `credit_type` (`carbon` | `biodiversity`, optional filter for latest execution lookup)

**When it's used:** Pre-flight check before monthly execution, and quick triage when deciding whether to sync, dry-run, execute, or avoid reruns.

### `get_monthly_reconciliation_run_history`

Returns persisted reconciliation orchestration history from the local run ledger (`REGEN_RECONCILIATION_RUNS_PATH`) with optional filters:
- `month` (`YYYY-MM`)
- `status` (`in_progress` | `completed` | `blocked` | `failed`)
- `credit_type` (`carbon` | `biodiversity`)
- `limit` (`1-200`, default `50`)

**When it's used:** Operator auditing/troubleshooting across end-to-end reconciliation attempts, including blocked preflight runs and timeout/error failures.

### `publish_subscriber_certificate_page`

Generates a user-facing HTML certificate page for a subscriber's monthly fractional attribution record and returns:
- a public URL (based on `REGEN_CERTIFICATE_BASE_URL`), and
- the local generated file path (under `REGEN_CERTIFICATE_OUTPUT_DIR`).

**When it's used:** Publishing shareable certificate pages for dashboards, receipts, and attribution history links.

### `publish_subscriber_dashboard_page`

Generates a user-facing HTML dashboard page for a subscriber and returns:
- a public URL (based on `REGEN_DASHBOARD_BASE_URL`), and
- the local generated file path (under `REGEN_DASHBOARD_OUTPUT_DIR`).

Dashboard page content includes:
- lifetime contribution and attributed impact totals,
- monthly contribution/attribution history,
- recent attribution executions with certificate links,
- subscription status snapshot when Stripe lookup is available.

**When it's used:** Publishing the user account impact dashboard page for web navigation or direct sharing.

### `start_identity_auth_session`

Starts a hardened identity verification session using either:
- `method=email` (issues a one-time verification code), or
- `method=oauth` (issues a signed OAuth state token).

### `verify_identity_auth_session`

Verifies a pending identity session:
- email sessions require `verification_code`,
- oauth sessions require `oauth_state_token`, `auth_provider`, and `auth_subject`.

Returns a verified `auth_session_id` that can be passed into `retire_credits`.

### `get_identity_auth_session`

Returns session status (`pending`, `verified`, `expired`, `locked`) and attribution metadata.

### `link_identity_session`

Links a verified auth session to an internal `user_id` for long-lived attribution continuity.

### `recover_identity_session`

Provides recovery flow for verified identities:
- `action=start` issues a recovery token for a verified email identity,
- `action=complete` consumes that token and mints a fresh verified auth session.

### `retire_credits`

Retires ecocredits on Regen Network. Operates in two modes:

- **With wallet configured** (`REGEN_WALLET_MNEMONIC` set): Executes a `MsgBuyDirect` on-chain, purchasing and retiring credits in a single transaction. Returns a retirement certificate.
- **Without wallet**: Returns a marketplace link for credit card purchase (no crypto wallet needed).

When `ECOBRIDGE_ENABLED=true`, the fallback message also suggests `retire_via_ecobridge` as a cross-chain payment alternative.

**Parameters:**

| Parameter | Description |
|-----------|-------------|
| `credit_class` | Credit class to retire (e.g., 'C01', 'BT01'). Optional. |
| `quantity` | Number of credits to retire. Optional (defaults to 1). |
| `beneficiary_name` | Name for the retirement certificate. Optional. |
| `beneficiary_email` | Email for retirement attribution metadata. Optional. |
| `auth_provider` | OAuth provider for identity attribution (e.g., `google`, `github`). Optional (requires `auth_subject`). |
| `auth_subject` | OAuth user subject/ID for attribution metadata. Optional (requires `auth_provider`). |
| `auth_session_id` | Verified identity auth session ID. When provided, verified session identity overrides direct auth/email fields. |
| `jurisdiction` | Retirement jurisdiction (ISO 3166-1, e.g., 'US', 'DE'). Optional. |
| `reason` | Reason for retiring credits (recorded on-chain). Optional. |

**When it's used:** The user wants to take action and actually fund ecological regeneration.

Identity attribution fields are embedded into retirement reason metadata so `get_retirement_certificate` can display user attribution details later.

### `browse_ecobridge_tokens`

Lists all tokens and chains supported by ecoBridge for cross-chain credit retirement payments.

**When it's used:** The user wants to pay for credit retirement using tokens from other chains (USDC on Ethereum, ETH on Arbitrum, etc.) rather than native REGEN tokens.

**Parameters:**

| Parameter | Description |
|-----------|-------------|
| `chain` | Filter by chain name (e.g., 'ethereum', 'polygon'). Optional. |

**Example output:**
```
## ecoBridge Supported Tokens

### Ethereum
| Token | Symbol | Price (USD) |
|-------|--------|------------|
| USD Coin | USDC | $1.00 |
| Tether | USDT | $1.00 |
| Ether | ETH | $3,200.00 |

### Polygon
| Token | Symbol | Price (USD) |
|-------|--------|------------|
| USD Coin | USDC | $1.00 |
| MATIC | MATIC | $0.75 |
```

### `retire_via_ecobridge`

Generates an ecoBridge payment link to retire ecocredits using any supported token on any supported chain.

**When it's used:** The user wants to pay with tokens like USDC, USDT, ETH on Ethereum, Polygon, Arbitrum, Base, or other chains instead of native REGEN tokens.

**Parameters:**

| Parameter | Description |
|-----------|-------------|
| `chain` | The blockchain to pay from (e.g., 'ethereum', 'polygon', 'arbitrum', 'base'). Required. |
| `token` | The token to pay with (e.g., 'USDC', 'USDT', 'ETH'). Required. |
| `credit_class` | Credit class to retire (e.g., 'C01', 'BT01'). Optional. |
| `quantity` | Number of credits to retire. Optional (defaults to 1). |
| `beneficiary_name` | Name for the retirement certificate. Optional. |
| `jurisdiction` | Retirement jurisdiction (ISO 3166-1). Optional. |
| `reason` | Reason for retiring credits. Optional. |

**Example output:**
```
## Retire Ecocredits via ecoBridge

Pay with **USDC** on **Ethereum** to retire ecocredits on Regen Network.

| Field | Value |
|-------|-------|
| Chain | Ethereum |
| Token | USDC |
| Quantity | 1 credit |
| Token Price | $1.00 USD |

### Payment Link

**[Open ecoBridge Widget](https://app.bridge.eco?chain=ethereum&token=USDC&amount=1)**

**How it works:**
1. Click the link above to open the ecoBridge payment widget
2. Connect your wallet on Ethereum
3. The widget will pre-select USDC and the credit retirement details
4. Confirm the transaction — ecoBridge bridges your tokens and retires credits on Regen Network
5. You'll receive a verifiable on-chain retirement certificate
```

## Direct On-Chain Retirement

To enable direct retirement (no marketplace visit needed), set `REGEN_WALLET_MNEMONIC` in your environment. The MCP server will:

1. Find the cheapest matching sell orders on-chain
2. Check your wallet balance can cover the cost
3. Sign and broadcast a `MsgBuyDirect` with auto-retire enabled
4. Poll the indexer for the retirement certificate
5. Return a full retirement certificate with on-chain proof

If anything fails, it falls back to a marketplace link — users are never stuck.

```bash
# Enable direct retirement
export REGEN_WALLET_MNEMONIC="your 24 word mnemonic here"
export REGEN_RPC_URL=https://mainnet.regen.network:26657
export REGEN_CHAIN_ID=regen-1
```
Stripe-backed authorization/capture is also supported:

```bash
export REGEN_PAYMENT_PROVIDER=stripe
export STRIPE_SECRET_KEY=sk_live_...
export STRIPE_PAYMENT_METHOD_ID=pm_...
# optional if your payment method is attached to a customer
export STRIPE_CUSTOMER_ID=cus_...
export STRIPE_PRICE_ID_STARTER=price_...
export STRIPE_PRICE_ID_GROWTH=price_...
export STRIPE_PRICE_ID_IMPACT=price_...
# optional custom ledger path for pool accounting service
export REGEN_POOL_ACCOUNTING_PATH=./data/pool-accounting-ledger.json
# optional pool accounting store lock tuning
export REGEN_POOL_ACCOUNTING_LOCK_WAIT_MS=10000
export REGEN_POOL_ACCOUNTING_LOCK_RETRY_MS=25
export REGEN_POOL_ACCOUNTING_LOCK_STALE_MS=60000
# optional custom history path for monthly batch executions
export REGEN_BATCH_EXECUTIONS_PATH=./data/monthly-batch-executions.json
# optional batch execution store lock tuning
export REGEN_BATCH_EXECUTIONS_LOCK_WAIT_MS=10000
export REGEN_BATCH_EXECUTIONS_LOCK_RETRY_MS=25
export REGEN_BATCH_EXECUTIONS_LOCK_STALE_MS=60000
# optional custom history path for monthly reconciliation orchestration runs
export REGEN_RECONCILIATION_RUNS_PATH=./data/monthly-reconciliation-runs.json
# optional lock directory for reconciliation single-flight protection
export REGEN_RECONCILIATION_LOCKS_DIR=./data/monthly-reconciliation-locks
# optional stale-lock TTL in milliseconds (default 1800000)
export REGEN_RECONCILIATION_LOCK_TTL_MS=1800000
# optional reconciliation run-history write-lock tuning
export REGEN_RECONCILIATION_RUNS_LOCK_WAIT_MS=10000
export REGEN_RECONCILIATION_RUNS_LOCK_RETRY_MS=25
export REGEN_RECONCILIATION_RUNS_LOCK_STALE_MS=60000
# optional subscriber certificate frontend settings
export REGEN_CERTIFICATE_BASE_URL=https://regen.network/certificate
export REGEN_CERTIFICATE_OUTPUT_DIR=./data/certificates
# optional subscriber dashboard frontend settings
export REGEN_DASHBOARD_BASE_URL=https://regen.network/dashboard
export REGEN_DASHBOARD_OUTPUT_DIR=./data/dashboards
# optional identity auth store path
export REGEN_AUTH_STORE_PATH=./data/auth-state.json
# strongly recommended shared secret for auth code/state/recovery signing
export REGEN_AUTH_SECRET=replace-with-long-random-secret
# optional auth session TTL in seconds (default 900)
export REGEN_AUTH_SESSION_TTL_SECONDS=900
# optional max verification attempts before lock (default 5)
export REGEN_AUTH_MAX_ATTEMPTS=5
# optional recovery token TTL in seconds (default 86400)
export REGEN_AUTH_RECOVERY_TTL_SECONDS=86400
# optional allowed OAuth providers CSV (default google,github)
export REGEN_AUTH_ALLOWED_OAUTH_PROVIDERS=google,github
# optional protocol fee basis points for monthly pool budgets (800-1200, default 1000)
export REGEN_PROTOCOL_FEE_BPS=1000
# optional batch credit mix policy when credit_type is omitted: balanced | off
export REGEN_BATCH_CREDIT_MIX_POLICY=balanced
# optional protocol fee REGEN acquisition provider: disabled | simulated
export REGEN_ACQUISITION_PROVIDER=disabled
# optional simulated acquisition rate (micro-REGEN per 1 USDC, default 2000000)
export REGEN_ACQUISITION_RATE_UREGEN_PER_USDC=2000000
# optional REGEN burn provider: disabled | simulated | onchain
export REGEN_BURN_PROVIDER=disabled
# required when REGEN_BURN_PROVIDER=onchain
export REGEN_BURN_ADDRESS=regen1...
```

Note: Stripe mode currently requires USDC-denominated sell orders (`uusdc`) so fiat charges map cleanly to on-chain pricing.

## Cross-Chain Payment via ecoBridge

To pay for credit retirements using USDC, ETH, or other tokens on Ethereum, Polygon, Arbitrum, Base, Celo, Optimism, Solana, and more, use the ecoBridge tools:

```bash
# ecoBridge is enabled by default. To disable:
export ECOBRIDGE_ENABLED=false

# Optional: custom API URL or cache TTL
export ECOBRIDGE_API_URL=https://api.bridge.eco
export ECOBRIDGE_CACHE_TTL_MS=60000
```

Use `browse_ecobridge_tokens` to see all available tokens and chains, then `retire_via_ecobridge` to generate a payment link.

See `.env.example` for all configuration options.

## MCP Prompts

The server also provides prompt templates for common workflows:

| Prompt | Description |
|--------|-------------|
| `offset_my_session` | Estimate footprint + browse credits + get retirement link |
| `show_regen_impact` | Pull live network stats and summarize ecological impact |
| `retire_with_any_token` | Browse ecoBridge tokens + select chain/token + generate payment link |

## Key Concepts

- **Regenerative contribution, not carbon offset.** We fund verified ecological regeneration. We do not claim carbon neutrality.
- **On-chain and immutable.** Every retirement is recorded on Regen Ledger — verifiable, non-reversible.
- **Three payment modes:** (1) Direct on-chain with a REGEN wallet, (2) credit card via Regen Marketplace, or (3) any token on any chain via ecoBridge (USDC, ETH, etc. on Ethereum, Polygon, Arbitrum, Base, and more).
- **Multiple credit types.** Carbon, biodiversity, marine, soil, and species stewardship credits.
- **Graceful fallback.** If direct retirement fails for any reason, a marketplace link is returned instead.

## Data Sources

| Source | What it provides |
|--------|------------------|
| [Regen Ledger REST](https://lcd-regen.keplr.app) | Credit classes, projects, batches, sell orders |
| [Regen Indexer GraphQL](https://api.regen.network/indexer/v1/graphql) | Retirement certificates, marketplace orders, aggregate stats |
| [Regen Marketplace](https://app.regen.network) | Credit card purchase flow, project pages |
| [ecoBridge API](https://api.bridge.eco) | Cross-chain token support, real-time USD prices, widget deep links |

## Development

```bash
git clone https://github.com/CShear/regen-for-ai.git
cd regen-for-ai
npm install
cp .env.example .env
npm run dev       # Watch mode with hot reload
npm run build     # Production build
npm run typecheck # Type checking
```

## Build Phases

| Phase | Description | Status |
|-------|-------------|--------|
| **Phase 1** | MCP server — footprint estimation, credit browsing, marketplace links, certificates | Complete |
| **Phase 1.5** | Direct on-chain retirement — wallet signing, best-price order routing, payment provider interface; ecoBridge cross-chain payment integration | Complete |
| **Phase 2** | Subscription pool — Stripe, monthly batch retirements, fractional attribution | Planned |
| **Phase 3** | CosmWasm pool contract — on-chain aggregation, automated retirement, REGEN burn | Planned |
| **Phase 4** | Scale — enterprise API, platform partnerships, credit supply development | Planned |

See [Build Phases & Roadmap](docs/phases.md) for details.

## Contributing

We welcome contributions! See [CONTRIBUTING.md](.github/CONTRIBUTING.md) for guidelines.

## License

Apache-2.0 — see [LICENSE](LICENSE).
