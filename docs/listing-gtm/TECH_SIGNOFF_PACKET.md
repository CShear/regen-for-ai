# Coinstore GTM Technical Signoff Packet (10-Minute Review)

## Goal
Enable one technical owner to approve and ship with minimal back-and-forth.

## What Is Included
1. 3-page static launch flow:
   - `web/listing-landing.html`
   - `web/supporter-opt-in.html`
   - `web/proof-page.html`
2. Shared assets:
   - `web/assets/regen-campaign.css`
   - `web/assets/regen-campaign.js`
3. Proof data source:
   - `web/proof-feed.json`
4. Ops templates and scripts for URL patching, proof updates, and preflight checks.

## Key Product Guarantee
Anyone can opt in to align AI prompting with regeneration:
1. Holder mode
2. Non-holder supporter mode
3. Hybrid mode

## 10-Minute Reviewer Path
1. Open all 3 pages and confirm nav works between them.
2. Confirm brand mode toggles:
   - append `?brand=regen`
   - append `?brand=bridge`
3. On supporter page:
   - submit one holder profile
   - submit one non-holder profile
   - verify `#supporter-optin` copy block
4. On proof page:
   - submit a local proof entry
   - verify `#proof` copy block
   - confirm `proof-feed.json` entries render
5. Run checks:
   - `npm run gtm:preflight`
   - `node --check docs/listing-gtm/web/assets/regen-campaign.js`

## Launch-Time Commands
1. Apply live URLs:
   `node docs/listing-gtm/scripts/apply-live-urls.mjs --landing <...> --proof <...> --rules <...>`
2. Strict preflight:
   `npm run gtm:preflight:strict`
3. Create handoff bundle:
   `npm run gtm:bundle`

## PR Metadata
Use:
- `PR_DRAFT_COINSTORE_GTM.md` for title/body.
- Title:
  `feat(listing-gtm): Coinstore listing GTM launch stack (landing, supporter opt-in, proof board)`

## Known Limits
1. Static front-end only; no backend persistence.
2. Local storage is browser-local for quick ops.
3. Live URLs still required for final template token replacement.
