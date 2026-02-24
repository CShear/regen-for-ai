# Unit 7: KPI Dashboard Spec

## Objective
Measure whether listing attention converts into durable, proof-linked participation.

## KPI Categories
1. Holder growth
2. Holder retention
3. Participation actions
4. Proof outputs
5. Market quality

## Weekly Core KPIs
1. `new_holders_weekly`
2. `holder_retention_30d_pct`
3. `participants_with_verified_action`
4. `verification_actions_total`
5. `credits_retired_total`
6. `certificates_published_total`
7. `buy_sell_ratio`
8. `avg_spread_bps`
9. `top_of_book_depth_usd`

## KPI Definitions
1. `holder_retention_30d_pct` = holders from day N still holding on day N+30 / holders on day N * 100
2. `participants_with_verified_action` = distinct participants with at least one accepted proof artifact
3. `buy_sell_ratio` = buy volume / sell volume over same period
4. `avg_spread_bps` = average best ask-bid spread in basis points during tracking window

## Data Sources (fill now)
1. Exchange reporting source:
2. Market-maker reporting source:
3. On-chain/indexer source:
4. Internal campaign database/source:

## Cadence
1. Daily snapshot during first 14 days
2. Weekly rollup for leadership call
3. Monthly summary after listing cycle

## Thresholds (fill exact targets)
1. Green threshold:
2. Yellow threshold:
3. Red threshold:

## Owner Matrix (fill now)
- DRI: TEMP_RELEASE_OWNER
- Approver: TEMP_RELEASE_OWNER
- Publisher: TEMP_RELEASE_OWNER
- Fallback Publisher: TEMP_RELEASE_OWNER
- First Reporting Date (UTC): T0+24h

## Definition of Done
1. KPI sheet created with all required columns.
2. Data source owner assigned for each metric.
3. First baseline snapshot completed.
4. Weekly reporting rhythm active.

## File References
1. `templates/kpi-weekly.csv`
2. `templates/kpi-dashboard-metrics.json`
