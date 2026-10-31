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

**No differences.** Every value matches `truth.json` and the dataset.
<!-- /reconcile:tidepool -->
