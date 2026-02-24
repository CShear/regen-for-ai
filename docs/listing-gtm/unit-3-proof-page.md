# Unit 3: Proof Page

## Objective
Make trust visible. Show that participation results in verifiable regeneration activity.

## Page Goal (v1)
Single public page with:
1. Live or daily-updated impact totals.
2. Recent certificates and transaction references.
3. A clear verification path.

## Required Sections
1. Impact Counter
- Total credits retired
- Total retirements
- Latest update timestamp

2. Recent Proof Feed
- Last 10 retirement entries with:
  - Date
  - Credit/project reference
  - Retirement/certificate ID
  - Transaction hash or link

3. Verification Guide
- `How to verify a retirement in under 60 seconds`
- Links to explorer/indexer/certificate pages

4. Method Note
- Clarify this is regenerative contribution tracking.
- Avoid "carbon neutral" claims unless legally reviewed.

## Data Contract (v1, manual-safe)
Use this structure for updates:

```json
{
  "updated_at": "2026-02-24T00:00:00Z",
  "totals": {
    "retirements": 0,
    "credits_retired": "0.000000"
  },
  "recent": [
    {
      "date": "2026-02-24",
      "retirement_id": "Wy...",
      "tx_hash": "ABC...",
      "certificate_url": "https://regen.network/certificate/...",
      "notes": "Monthly pooled retirement"
    }
  ]
}
```

## Owner Matrix (fill now)
- DRI: TEMP_RELEASE_OWNER
- Approver: TEMP_RELEASE_OWNER
- Publisher: TEMP_RELEASE_OWNER
- Fallback Publisher: TEMP_RELEASE_OWNER
- Publish Deadline (UTC): T0-24h

## Definition of Done
1. Public proof URL is live.
2. At least 3 real proof entries displayed (or marked pending if pre-listing).
3. Verification instructions are visible and tested.
4. Timestamp reflects current update.

## Operating Cadence
1. Update proof feed daily during listing week.
2. Pin latest proof link in Telegram.
3. Include proof snapshot in weekly call notes.
