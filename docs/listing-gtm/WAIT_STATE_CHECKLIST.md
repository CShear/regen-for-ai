# Wait State Checklist (Pre-PR)

Status: READY TO PAUSE FOR VALIDATION

## Completed Now
1. 3-page build is done:
   - `web/listing-landing.html`
   - `web/supporter-opt-in.html`
   - `web/proof-page.html`
2. Anyone-can-opt-in flow is implemented (holder/non-holder/hybrid).
3. Brand mode is implemented (`regen` and `bridge`).
4. Ops templates and scripts are in place.
5. PR draft and technical signoff packet are in place.
6. Release bundles are excluded from PR scope via `.gitignore`.

## Waiting On
1. One technical validator to run signoff packet.
2. Final live URLs (`LANDING_URL`, `PROOF_URL`, `RULES_URL`).

## Resume Triggers
Resume only when at least one of these is true:
1. Validator returns blocker findings.
2. Validator returns pass and asks for PR cut.
3. Live URLs arrive.

## Resume Commands
1. Apply URLs:
   `node docs/listing-gtm/scripts/apply-live-urls.mjs --landing <...> --proof <...> --rules <...>`
2. Strict check:
   `npm run gtm:preflight:strict`
3. Open PR using:
   `docs/listing-gtm/PR_DRAFT_COINSTORE_GTM.md`
