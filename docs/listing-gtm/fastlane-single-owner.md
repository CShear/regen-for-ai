# Fast Lane: Single-Owner Mode

## Purpose
Unblock execution when one person temporarily acts as:
1. DRI
2. Approver
3. Publisher

## Rule
Use one temporary role:

`TEMP_RELEASE_OWNER = <name>`

This person can approve and publish all listing GTM artifacts until a broader owner group is assigned.

## Guardrails
1. Log every publish decision in writing.
2. No financial promises in public copy.
3. No production publish without one final checklist pass.

## Work We Can Do Now (No URL Blockers)
1. Finalize all owner matrices with `TEMP_RELEASE_OWNER`.
2. Fill MM/runbook guardrails in `unit-6-exchange-mm-runbook.md`.
3. Fill KPI thresholds and data sources in `unit-7-kpi-dashboard-spec.md`.
4. Pre-draft Days 1-14 Telegram posts from `templates/telegram-14-day-posting-pack.md`.
5. Dry run one proof submission and mod handling.

## Work That Starts Immediately After URLs Arrive
1. Set `LANDING_URL`, `PROOF_URL`, `RULES_URL` in `templates/telegram-link-values.md`.
2. Replace all template tokens across Telegram files.
3. Publish pinned message and Day 1 post.
4. Publish landing and proof pages.

## Release Decision Log
Use this format for each ship action:

`[UTC timestamp] [asset] [approved by TEMP_RELEASE_OWNER] [published by TEMP_RELEASE_OWNER] [notes]`
