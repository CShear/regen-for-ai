# Listing Web Stack

Three-page launch flow:

1. `listing-landing.html`
2. `supporter-opt-in.html`
3. `proof-page.html`

Supporting assets:

1. `assets/regen-campaign.css`
2. `assets/regen-campaign.js`
3. `proof-feed.json`

## Publish Order
1. Publish all files in this folder with relative paths intact.
2. Set final public URLs in `../templates/telegram-link-values.md`.
3. Use `supporter-opt-in.html#campaign-rules` as `RULES_URL`.
4. Optional fast patch command when URLs are ready:
   `node ../scripts/apply-live-urls.mjs --landing <...> --proof <...> --rules <...>`
5. Run preflight:
   `npm run gtm:preflight`
6. For launch-time strict check (all URLs must be live):
   `npm run gtm:preflight:strict`

## Brand Mode
Default brand: `regen`

Switch to Bridge.eco mode by adding query param:
- `listing-landing.html?brand=bridge`
- `supporter-opt-in.html?brand=bridge`
- `proof-page.html?brand=bridge`

Notes:
1. Nav links preserve `brand` query once selected.
2. Brand mode is remembered in browser local storage.
3. Supported values: `regen`, `bridge`, `bridge.eco`.

## Live Data Update
Update `proof-feed.json` during listing week. `proof-page.html` loads this file directly and falls back to sample data only if fetch fails.

Update command:
`node ../scripts/update-proof-feed.mjs --retirement-id <...> --tx-hash <...> --certificate-url <...> --credits <...>`
