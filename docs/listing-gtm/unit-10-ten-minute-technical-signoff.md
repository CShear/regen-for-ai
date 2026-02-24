# Unit 10: Ten-Minute Technical Signoff

## Objective
Get one technical signer to approve coherence and operational readiness fast.

## Reference
Use:
`docs/listing-gtm/TECH_SIGNOFF_PACKET.md`

## Signoff Path (10 minutes)
1. Open all 3 pages and verify navigation.
2. Submit one holder profile on supporter page.
3. Submit one non-holder profile on supporter page.
4. Copy `#supporter-optin` block.
5. Submit one local proof on proof page.
6. Copy `#proof` block.
7. Confirm proof feed rows render.
8. Run:
   - `npm run gtm:preflight`
   - `node --check docs/listing-gtm/web/assets/regen-campaign.js`

## Approval Output
Record in one line:
`[UTC] [signer] [pass/fail] [blocking notes]`

## Owner Matrix
- DRI: TEMP_RELEASE_OWNER
- Approver: TEMP_RELEASE_OWNER
- Publisher: TEMP_RELEASE_OWNER
- Fallback Publisher: TEMP_RELEASE_OWNER
- Target Time (UTC): T0-10h

## Definition of Done
1. One named technical signer completes the path.
2. Pass/fail line recorded.
3. Any blockers converted to explicit tasks.
