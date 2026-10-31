// The metrics a plan can set a target for, and how each is held against its monthly target.
export const PLAN_METRICS = ["net_sales", "orders", "new_customer_orders", "aov", "returning_customer_rate"] as const;
export type PlanMetric = (typeof PLAN_METRICS)[number];

// Counts and totals build up over the month, so the target is spread over its days. The rest (an average, a rate) are the
// same size all month, so the month's target is the target for any part of it.
export const PACED_METRICS = ["net_sales", "orders", "new_customer_orders"] as const;
export type PacedMetric = (typeof PACED_METRICS)[number];
export const isPaced = (m: PlanMetric): m is PacedMetric => (PACED_METRICS as readonly string[]).includes(m);
