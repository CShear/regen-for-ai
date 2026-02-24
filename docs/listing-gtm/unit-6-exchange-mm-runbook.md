# Unit 6: Exchange and Market-Making Runbook

## Objective
Protect market quality and response speed during listing launch and the first 14 days.

## Scope
1. Exchange listing coordination
2. Market-making guardrails
3. Incident response and escalation

## Pre-Listing Checklist
1. Confirm final listing timestamp and timezone.
2. Confirm spot pair symbol and decimals.
3. Confirm deposit/withdrawal status windows.
4. Confirm market-maker contact channels and backup contacts.
5. Confirm spread/depth guardrails in writing.
6. Confirm internal incident owner and 24h reachability.

## Market Quality Guardrails (fill exact numbers)
1. Target spread:
2. Minimum top-of-book depth:
3. Max tolerated slippage at standard clip:
4. Requote interval:
5. Circuit-breaker condition:

## Listing-Day Timeline
1. T-120 min: final systems check, confirm contacts online.
2. T-60 min: freeze non-critical changes, open ops log.
3. T-15 min: verify exchange status page and internal channels.
4. T0: listing open, publish official links in Telegram.
5. T+15 min: first market quality check.
6. T+60 min: first public proof/status post.
7. T+4h: publish summary and next checkpoint.
8. T+24h: day-one report.

## Incident Severity
1. Sev 1: trading unavailable, wrong market config, or security event.
2. Sev 2: sustained spread/depth outside guardrails.
3. Sev 3: isolated user complaints or temporary latency.

## Incident Response
1. Log timestamp, symptom, and impact.
2. Assign incident lead.
3. Notify exchange and market-maker within 5 minutes for Sev 1/2.
4. Publish community update when user impact exists.
5. Close with root cause and mitigation action.

## Owner Matrix (fill now)
- DRI: TEMP_RELEASE_OWNER
- Approver: TEMP_RELEASE_OWNER
- Publisher: TEMP_RELEASE_OWNER
- Fallback Publisher: TEMP_RELEASE_OWNER
- Launch Date (UTC): T0

## Definition of Done
1. Guardrails documented and signed off.
2. Contacts and escalation tree tested.
3. Listing-day timeline assigned by owner.
4. Incident template ready.

## File Reference
1. `templates/listing-day-ops-log.md`
