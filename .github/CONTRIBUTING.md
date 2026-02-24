# Contributing to Regen for AI

Thank you for your interest in contributing! This project connects AI compute usage to verified ecological regeneration through Regen Network.

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/YOUR_USERNAME/regen-for-ai.git`
3. Install dependencies: `npm install`
4. Copy environment config: `cp .env.example .env`
5. Start development: `npm run dev`

## Development Workflow

```bash
npm run dev       # Watch mode — auto-restarts on file changes
npm run typecheck # Check types without emitting
npm run lint      # Run linter
npm run build     # Production build to dist/
```

## Project Structure

```
src/
├── index.ts              # MCP server entry point, tool registration
├── tools/                # MCP tool handlers (one file per tool)
│   ├── footprint.ts      # estimate_session_footprint
│   ├── credits.ts        # browse_available_credits
│   ├── certificates.ts   # get_retirement_certificate
│   ├── impact.ts         # get_impact_summary
│   └── retire.ts         # retire_credits
├── services/             # Data access layer
│   ├── ledger.ts         # Regen Ledger REST API client
│   ├── indexer.ts        # Regen Indexer GraphQL client
│   └── estimator.ts      # Footprint estimation heuristics
```

## Using Claude Code

This project includes a `CLAUDE.md` file that gives Claude Code full context about the project. If you use Claude Code for development, it will automatically pick up the project context, architecture, and conventions.

## Pull Request Guidelines

- Keep PRs focused — one feature or fix per PR
- Include a clear description of what changed and why
- Update relevant documentation if behavior changes
- Add tests for new functionality (when test infrastructure is set up)
- Use the repo PR template (`.github/pull_request_template.md`) and complete the `pr_context` block for fast human/agent handoff
- Assign explicit `owner`, `approver`, and `publisher` in the PR body before requesting final review

## Key Design Principles

1. **Estimates, not claims.** Footprint numbers are heuristics. Always label them as approximate.
2. **Regenerative contribution, not offset.** We fund ecological regeneration. We do not claim carbon neutrality.
3. **Leverage existing infrastructure.** Regen Marketplace handles payments. We link to it, not rebuild it.
4. **Both carbon and biodiversity.** The narrative is ecological regeneration, not just carbon.
5. **Certificates are the artifact.** The shareable certificate is the most important user-facing output.

## Areas Where Help Is Needed

- **Footprint estimation research** — Better heuristics for AI energy consumption, data center PUE, regional grid mixes
- **Indexer GraphQL schema** — Refining queries against the actual Regen Indexer schema
- **Certificate rendering** — A beautiful, shareable retirement certificate page
- **Testing** — Unit tests for tools and services
- **Documentation** — Usage guides, examples, FAQ

## Questions?

Open an issue or reach out on the Regen Network forum: https://forum.regen.network
