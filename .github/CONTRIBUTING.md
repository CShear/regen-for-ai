# Contributing to Regen for AI

Thank you for your interest in contributing! This project connects AI compute usage to verified ecological regeneration through Regen Network.

## Quick Orientation

| File | Purpose |
|------|---------|
| `CLAUDE.md` | Technical context — architecture, APIs, conventions |
| `ROADMAP.md` | Strategic context — 3-track rollout, dependencies, business model |
| `.env.example` | All configuration options with inline docs |
| This file | How to contribute |

**If you're an AI assistant**: Read `CLAUDE.md` first, then `ROADMAP.md`, then check `gh issue list --label "priority:critical"` for what's most urgent.

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/YOUR_USERNAME/regen-for-ai.git`
3. Install dependencies: `npm install`
4. Copy environment config: `cp .env.example .env`
5. Build: `npm run build`
6. Start: `npm start` (runs MCP server on stdio)

## Development Workflow

```bash
npm run dev       # Watch mode — auto-restarts on file changes
npm run typecheck # Check types without emitting
npm run lint      # Run linter
npm run build     # Production build to dist/
```

## Issue Workflow

All tasks live in [GitHub Issues](https://github.com/CShear/regen-for-ai/issues). Here's how they're organized:

### Labels

| Label | Meaning |
|-------|---------|
| `track-a` | Developer community & narrative |
| `track-b` | Subscription pool service |
| `track-c` | Enterprise & platform partnerships |
| `sprint:weeks-1-2` | Foundation sprint (do first) |
| `sprint:weeks-3-4` | Launch sprint |
| `sprint:weeks-5-8` | Subscription MVP sprint |
| `sprint:weeks-9-12` | Scale prep sprint |
| `priority:critical` | Must do now — blocks other work |
| `priority:high` | Important, do soon |
| `priority:medium` | Important but can wait |
| `good first issue` | Approachable entry points for new contributors |
| `infra` | Infrastructure, tooling, CI/CD |
| `design` | UI/UX, visual design, branding |
| `question` | Needs discussion or decision |

### Finding work

```bash
# Critical path items
gh issue list --label "priority:critical"

# Good first issues
gh issue list --label "good first issue"

# By track
gh issue list --label "track-a"
gh issue list --label "track-b"
gh issue list --label "track-c"

# By sprint
gh issue list --label "sprint:weeks-1-2"

# Infrastructure
gh issue list --label "infra"
```

### Milestones

| Milestone | Sprint | Focus |
|-----------|--------|-------|
| Foundation (Weeks 1-2) | `sprint:weeks-1-2` | Polish MCP, certificate page, npm publish, CI/CD, tests |
| Launch (Weeks 3-4) | `sprint:weeks-3-4` | Blog, demo video, community seeding, landing page |
| Subscription MVP (Weeks 5-8) | `sprint:weeks-5-8` | Stripe, pool accounting, email flow, conferences |
| Scale Prep (Weeks 9-12) | `sprint:weeks-9-12` | Dev API, dashboard, REGEN burn, enterprise sales |

### Critical path (dependency order)

```
#5 Polish MCP ──┐
#8 Certificate ─┤──→ #12 Blog + #15 Demo ──→ #18 Community seeding
#21 Publish npm ┘
                     #6 Stripe ──→ #9 Pool accounting ──→ #11 Email flow
                                                       ──→ #17 Dashboard
                                                       ──→ #20 REGEN burn
                                                       ──→ #14 Dev API
#4 Anthropic pitch (parallel, starts Week 1)
#13 Credit supply (parallel, starts Week 1)
```

## Branch Conventions

- Feature branches: `feature/<issue-number>-short-description`
- Bug fixes: `fix/<issue-number>-short-description`
- Reference the issue number in commit messages and PR descriptions

## Project Structure

```
src/
├── index.ts              # MCP server entry point, tool registration
├── config.ts             # Centralized env config
├── tools/                # MCP tool handlers (one file per tool)
│   ├── footprint.ts      # estimate_session_footprint
│   ├── credits.ts        # browse_available_credits
│   ├── certificates.ts   # get_retirement_certificate
│   ├── impact.ts         # get_impact_summary
│   └── retire.ts         # retire_credits + retire_via_ecobridge
├── services/             # Data access layer
│   ├── ledger.ts         # Regen Ledger REST API client
│   ├── indexer.ts        # Regen Indexer GraphQL client
│   ├── estimator.ts      # Footprint estimation heuristics
│   ├── wallet.ts         # Cosmos wallet (Regen Ledger signing)
│   ├── evm-wallet.ts     # EVM wallet (Base/ETH USDC transfers)
│   ├── ecobridge.ts      # bridge.eco API client (cross-chain)
│   ├── order-selector.ts # Best-price sell order routing
│   └── payment/          # Two-phase payment interface
│       ├── types.ts      # PaymentProvider interface
│       ├── crypto.ts     # Crypto payment (balance check)
│       └── stripe-stub.ts # Placeholder for Stripe
```

## Key Design Principles

1. **Estimates, not claims.** Footprint numbers are heuristics. Always label as approximate.
2. **Regenerative contribution, not offset.** We fund ecological regeneration. We do not claim carbon neutrality.
3. **Graceful degradation.** No wallet? Marketplace links. Wallet? On-chain retirement. Error? Fallback to links.
4. **Both carbon and biodiversity.** Ecological regeneration > carbon offset.
5. **Certificates are the viral artifact.** Everything funnels to the shareable proof page.

## Pull Request Guidelines

- Keep PRs focused — one feature or fix per PR
- Include a clear description of what changed and why
- Reference the issue number (e.g., "Closes #5")
- Update `CLAUDE.md` if you change architecture or add new services
- Add tests for new functionality

## Questions?

Open an issue or reach out on the Regen Network forum: https://forum.regen.network
