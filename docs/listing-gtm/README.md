# Listing GTM Units

This folder tracks execution units for imminent exchange listing GTM.

## Unit Docs
1. `unit-2-listing-landing-page.md`
2. `unit-3-proof-page.md`
3. `unit-4-campaign-buy-participate-proof.md`
4. `unit-5-telegram-ops-kit.md`
5. `unit-6-exchange-mm-runbook.md`
6. `unit-7-kpi-dashboard-spec.md`
7. `fastlane-single-owner.md`
8. `PR_DRAFT_COINSTORE_GTM.md`
9. `TECH_SIGNOFF_PACKET.md`
10. `VALIDATOR_REQUEST_MESSAGE.md`
11. `WAIT_STATE_CHECKLIST.md`
12. `unit-8-staging-publish.md`
13. `unit-9-url-hydration-and-strict-preflight.md`
14. `unit-10-ten-minute-technical-signoff.md`
15. `unit-11-pr-cut-and-review-routing.md`
16. `unit-12-listing-day-rehearsal.md`
17. `unit-13-day-0-content-queue.md`

## Web Build (3 Pages)
1. `web/listing-landing.html`
2. `web/supporter-opt-in.html`
3. `web/proof-page.html`
4. `web/proof-feed.json` (proof board data source)
5. `web/assets/regen-campaign.css`
6. `web/assets/regen-campaign.js`

Brand mode:
1. Default `regen`
2. Alternate `bridge`/`bridge.eco` via query param `?brand=bridge`

## Templates
1. `templates/telegram-pinned-message.txt`
2. `templates/telegram-daily-update.md`
3. `templates/telegram-mod-quick-replies.md`
4. `templates/telegram-link-values.md`
5. `templates/telegram-14-day-posting-pack.md`
6. `templates/listing-day-ops-log.md`
7. `templates/kpi-weekly.csv`
8. `templates/kpi-dashboard-metrics.json`

## Scripts
1. `scripts/apply-live-urls.mjs`
2. `scripts/preflight-check.mjs`
3. `scripts/create-release-bundle.mjs`
4. `scripts/update-proof-feed.mjs`

## Immediate Use
1. Assign DRI/Approver/Publisher in each unit doc.
2. Replace placeholder links and owner fields.
3. Publish 3-page stack in this order: `listing-landing.html` -> `supporter-opt-in.html` -> `proof-page.html`.
4. Activate Telegram ops cadence and listing-day ops log.
5. Start KPI baseline capture on day 0.
6. Use `PR_DRAFT_COINSTORE_GTM.md` for the Coinstore GTM PR title/body.
7. Use `TECH_SIGNOFF_PACKET.md` for fast technical signoff.
8. Send `VALIDATOR_REQUEST_MESSAGE.md` to technical validator.
9. Pause using `WAIT_STATE_CHECKLIST.md` until validator/URL trigger.

## Commands
1. Preflight (allows unresolved URL placeholders):
   `npm run gtm:preflight`
2. Preflight strict (fails if URL placeholders are still unresolved):
   `npm run gtm:preflight:strict`
3. Apply live URLs:
   `node docs/listing-gtm/scripts/apply-live-urls.mjs --landing <...> --proof <...> --rules <...>`
4. Update proof feed after each verified event:
   `node docs/listing-gtm/scripts/update-proof-feed.mjs --retirement-id <...> --tx-hash <...> --certificate-url <...> --credits <...> --notes "<...>"`
5. Create release bundle for publisher handoff:
   `npm run gtm:bundle`
