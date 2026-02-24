# Proposed PR Title

`feat(listing-gtm): Coinstore listing GTM launch stack (landing, supporter opt-in, proof board)`

# PR Body Draft

## PR Context (for humans + agents)

```yaml
pr_context:
  version: 1
  change_type: feat
  scope: listing-gtm/coinstore-launch
  linked_issue: ""
  release_blocking: true
  risk_level: medium
  breaking_change: false
  db_migration: false
  requires_follow_up: true
  owner: TEMP_RELEASE_OWNER
  approver: TEMP_RELEASE_OWNER
  publisher: TEMP_RELEASE_OWNER
```

## Summary
- Adds a 3-page launch web stack for Coinstore listing GTM.
- Introduces supporter opt-in flow that links token and non-token participation to AI prompt cadence and local ecosystem stewardship context.
- Adds proof board flow for retirement/certificate evidence and local proof ops handling.

## Change Set
- Main files/areas touched:
  - `docs/listing-gtm/web/listing-landing.html`
  - `docs/listing-gtm/web/supporter-opt-in.html`
  - `docs/listing-gtm/web/proof-page.html`
  - `docs/listing-gtm/web/proof-feed.json`
  - `docs/listing-gtm/web/assets/regen-campaign.css`
  - `docs/listing-gtm/web/assets/regen-campaign.js`
  - `docs/listing-gtm/templates/*` (Telegram + ops templates)
  - `docs/listing-gtm/scripts/apply-live-urls.mjs`
- User-visible behavior changes:
  - Supporter opt-in profile now supports holder, non-holder, and hybrid modes.
  - Opt-in profile captures long-term commitment and stewardship context.
  - Proof board now supports feed-based metrics and local proof submission cache.
  - Telegram templates now align to `buy -> opt in -> prove`.
- Non-goals:
  - No backend API integration yet.
  - No exchange automation integration in this PR.

## Test Plan
- Commands run:
  - `node --check docs/listing-gtm/web/assets/regen-campaign.js`
- Results:
  - JS syntax check passes.
- Manual checks:
  - [ ] Open each page and validate navigation flow.
  - [ ] Submit supporter profile and confirm local snapshot.
  - [ ] Submit local proof and copy `#proof` block.
  - [ ] Verify proof board reads `proof-feed.json`.

## Risk and Rollback
- Main risks:
  - Static pages can drift from live campaign rules if not updated.
  - Local storage cache is browser-local and not shared.
- Rollback or mitigation:
  - Revert to previous static prototype pages.
  - Keep proof feed updates disciplined via ops log.

## Handoff Notes
- Open follow-ups:
  - Replace placeholder URLs once publishing endpoints are confirmed.
  - Assign permanent owner/approver/publisher after fastlane period.
- Decisions needed:
  - Final hosting destination for web pages.
  - Final rules URL (currently `supporter-opt-in.html#campaign-rules`).
- Deployment/publish steps:
  1. Publish `/docs/listing-gtm/web` directory preserving relative paths.
  2. Run URL replacement script:
     `node docs/listing-gtm/scripts/apply-live-urls.mjs --landing <...> --proof <...> --rules <...>`
  3. Post pinned message + Day 1 Telegram update.

## Checklist
- [ ] Scope is focused and reviewable.
- [ ] Docs updated (if behavior changed).
- [ ] Tests added/updated where appropriate.
- [ ] No secrets or sensitive data included.
- [ ] Owner/Approver/Publisher set in `pr_context`.
