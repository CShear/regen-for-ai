# Unit 9: URL Hydration and Strict Preflight

## Objective
Replace placeholder URLs and verify launch artifacts are fully production-ready.

## Scope
1. Inject live URLs into templates.
2. Run strict preflight checks.
3. Produce pass/fail record.

## Required Inputs
1. `LANDING_URL`
2. `PROOF_URL`
3. `RULES_URL` (recommended: supporter opt-in page with `#campaign-rules`)

## Commands
```bash
node docs/listing-gtm/scripts/apply-live-urls.mjs --landing <LANDING_URL> --proof <PROOF_URL> --rules <RULES_URL>
npm run gtm:preflight:strict
```

## Verification
1. Check templates:
   - `templates/telegram-pinned-message.txt`
   - `templates/telegram-daily-update.md`
   - `templates/telegram-mod-quick-replies.md`
   - `templates/telegram-14-day-posting-pack.md`
2. Ensure no `{{LANDING_URL}}`, `{{PROOF_URL}}`, `{{RULES_URL}}` tokens remain.

## Owner Matrix
- DRI: TEMP_RELEASE_OWNER
- Approver: TEMP_RELEASE_OWNER
- Publisher: TEMP_RELEASE_OWNER
- Fallback Publisher: TEMP_RELEASE_OWNER
- Target Time (UTC): T0-12h

## Definition of Done
1. URL patch command completed successfully.
2. `gtm:preflight:strict` passes.
3. URL token audit confirms no unresolved placeholders.
