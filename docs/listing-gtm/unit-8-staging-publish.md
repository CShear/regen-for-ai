# Unit 8: Staging Publish

## Objective
Publish the 3-page stack to staging so technical lead can validate a real URL flow.

## Scope
1. Upload web bundle preserving relative paths.
2. Verify navigation and assets load.
3. Confirm proof feed read path works.

## Required Inputs
1. Staging host or static bucket access.
2. Publisher credentials.
3. Bundle path:
   `/Users/EcoWealth/dev/regenerative-compute/docs/listing-gtm/release/coinstore-gtm-2026-02-24T21-05-48-243Z/web`

## Execution Steps
1. Upload entire `web/` folder contents as one deployment.
2. Open:
   - `listing-landing.html`
   - `supporter-opt-in.html`
   - `proof-page.html`
3. Validate:
   - top nav links
   - styles and scripts
   - proof feed table rendering
4. Capture one screenshot per page for signoff record.

## Owner Matrix
- DRI: TEMP_RELEASE_OWNER
- Approver: TEMP_RELEASE_OWNER
- Publisher: TEMP_RELEASE_OWNER
- Fallback Publisher: TEMP_RELEASE_OWNER
- Target Time (UTC): T0-24h

## Definition of Done
1. Staging URL live.
2. All three pages accessible from top nav.
3. No broken asset paths.
4. Screenshots posted to internal ops thread.
