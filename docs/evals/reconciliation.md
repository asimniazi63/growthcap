# Reconciliation against truth.json

Written by `npm run reconcile:truth -- --store <store>`. Each run replaces its own store's section.

<!-- reconcile:solenne -->
## Solenne

Checked on 2026-10-31: 14 months x 11 metrics (154 values), 21 storyline checks, 5 row counts.

**No differences.** Every value matches `truth.json` and the dataset.

Not checked (6):

- S5 zero_sales_days {"variant":"V_029"} 2026-07-19..2026-08-04: repeat_rate and zero_sales_days are built in T12
- S6 repeat_rate {"window_days":"30","first_order_code":"VIPGLOW25"} 2026-08-04..2026-08-31: repeat_rate and zero_sales_days are built in T12
- S6 repeat_rate {"window_days":"30","exclude_first_order_code":"VIPGLOW25","exclude_tag":"wholesale"} 2026-08-04..2026-08-31: repeat_rate and zero_sales_days are built in T12
- S7 zero_sales_days {"variant":"V_001"} 2026-09-03..2026-09-13: repeat_rate and zero_sales_days are built in T12
- S8 repeat_rate {"window_days":"180","first_order_code":"BFCM25"} 2025-11-28..2025-12-01: repeat_rate and zero_sales_days are built in T12
- S8 repeat_rate {"window_days":"180","first_order_code":"WELCOME10"} 2025-09-01..2026-04-30: repeat_rate and zero_sales_days are built in T12
<!-- /reconcile:solenne -->

<!-- reconcile:tidepool -->
## Tidepool Baby

Checked on 2026-10-31: 12 months x 11 metrics (132 values), 3 storyline checks, 5 row counts.

**9 differences, 0 unexplained.**

| Where | Metric | truth.json | Synced | Explanation |
|---|---|---|---|---|
| 2026-10 | gross_sales | 103000 | 104600 | Live check of the orders/create webhook, 2026-10-31: order #1103 (tag webhook-test, one unit, $16.00) was created in the Tidepool admin after the seed and reached Postgres through the webhook in about 3 seconds. It is not in truth.json. |
| 2026-10 | net_sales | 101860 | 103460 | Live check of the orders/create webhook, 2026-10-31: order #1103 (tag webhook-test, one unit, $16.00) was created in the Tidepool admin after the seed and reached Postgres through the webhook in about 3 seconds. It is not in truth.json. |
| 2026-10 | orders | 13 | 14 | Live check of the orders/create webhook, 2026-10-31: order #1103 (tag webhook-test, one unit, $16.00) was created in the Tidepool admin after the seed and reached Postgres through the webhook in about 3 seconds. It is not in truth.json. |
| 2026-10 | aov | 7835.384615 | 7390 | Live check of the orders/create webhook, 2026-10-31: order #1103 (tag webhook-test, one unit, $16.00) was created in the Tidepool admin after the seed and reached Postgres through the webhook in about 3 seconds. It is not in truth.json. |
| 2026-10 | units | 27 | 28 | Live check of the orders/create webhook, 2026-10-31: order #1103 (tag webhook-test, one unit, $16.00) was created in the Tidepool admin after the seed and reached Postgres through the webhook in about 3 seconds. It is not in truth.json. |
| 2026-10 | discounted_order_share | 0.153846 | 0.142857 | Live check of the orders/create webhook, 2026-10-31: order #1103 (tag webhook-test, one unit, $16.00) was created in the Tidepool admin after the seed and reached Postgres through the webhook in about 3 seconds. It is not in truth.json. |
| TP1 net_sales {"exclude_tag":"wholesale"} 2026-10-01..2026-10-31 | net_sales | 101860 | 103460 | Live check of the orders/create webhook, 2026-10-31: order #1103 (tag webhook-test, one unit, $16.00) was created in the Tidepool admin after the seed and reached Postgres through the webhook in about 3 seconds. It is not in truth.json. |
| TP1 orders {"exclude_tag":"wholesale"} 2026-10-01..2026-10-31 | orders | 13 | 14 | Live check of the orders/create webhook, 2026-10-31: order #1103 (tag webhook-test, one unit, $16.00) was created in the Tidepool admin after the seed and reached Postgres through the webhook in about 3 seconds. It is not in truth.json. |
| synced rows | orders | 102 | 103 | Live check of the orders/create webhook, 2026-10-31: order #1103 (tag webhook-test, one unit, $16.00) was created in the Tidepool admin after the seed and reached Postgres through the webhook in about 3 seconds. It is not in truth.json. |
<!-- /reconcile:tidepool -->
