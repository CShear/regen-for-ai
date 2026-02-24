# Unit 12: Listing-Day Rehearsal

## Objective
Run a full dry run before launch to reduce operational surprises.

## Scope
1. Simulate supporter opt-in submission.
2. Simulate proof submission and verification.
3. Simulate community moderation + escalation.

## Required References
1. `templates/listing-day-ops-log.md`
2. `templates/telegram-mod-quick-replies.md`
3. `web/supporter-opt-in.html`
4. `web/proof-page.html`

## Rehearsal Script
1. Post one mock `#supporter-optin` block.
2. Post one mock `#proof` block.
3. Update proof feed with:
   ```bash
   node docs/listing-gtm/scripts/update-proof-feed.mjs --retirement-id WyDryRun001 --tx-hash DryRunTx001 --certificate-url https://regen.network/certificate/dry-run --credits 0.100000 --notes "Dry run"
   ```
4. Run one moderator response cycle from quick replies.
5. Log timestamps and outcomes in ops log template.

## Owner Matrix
- DRI: TEMP_RELEASE_OWNER
- Approver: TEMP_RELEASE_OWNER
- Publisher: TEMP_RELEASE_OWNER
- Fallback Publisher: TEMP_RELEASE_OWNER
- Target Time (UTC): T0-6h

## Definition of Done
1. Dry run executed end-to-end.
2. Ops log completed with notes.
3. Any failure points documented with owner and fix ETA.
