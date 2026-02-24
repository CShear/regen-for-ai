# Validator Request Message (Send As-Is)

Need one technical validator for the Coinstore GTM stack.

Please run this 10-minute signoff:
1. Open:
   - `listing-landing.html`
   - `supporter-opt-in.html`
   - `proof-page.html`
2. Validate holder + non-holder opt-in flow.
3. Validate proof submission/copy flow.
4. Confirm brand switch works (`?brand=regen` and `?brand=bridge`).
5. Run:
   - `npm run gtm:preflight`
   - `node --check docs/listing-gtm/web/assets/regen-campaign.js`

Reference doc:
`docs/listing-gtm/TECH_SIGNOFF_PACKET.md`

Please return:
`[UTC] [name] [pass/fail] [blocking notes]`
