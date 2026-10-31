// The one place a metric is defined. The query engine, describeMetrics and docs/metrics.md all read from here,
// and scripts/seed/truth.ts computes the same definitions independently from the dataset to check them.

export const CORE_METRIC_IDS = [
  "gross_sales",
  "discounts",
  "refunds",
  "net_sales",
  "orders",
  "aov",
  "units",
  "new_customer_orders",
  "returning_customer_rate",
  "refund_rate",
  "discounted_order_share",
] as const;

// Ad metrics need the brand's ad spend (T6), which comes from a file, not from Shopify. They are not part of the 11 that
// are checked against the order data alone.
export const AD_METRIC_IDS = ["mer", "new_customer_cac"] as const;
export const METRIC_IDS = [...CORE_METRIC_IDS, ...AD_METRIC_IDS] as const;

export type CoreMetricId = (typeof CORE_METRIC_IDS)[number];
export type MetricId = (typeof METRIC_IDS)[number];
export type MetricUnit = "money" | "count" | "rate" | "ratio";

export interface MetricDef {
  id: MetricId;
  label: string;
  unit: MetricUnit; // money is in cents, a rate is a fraction (0.18 means 18%), a ratio is a plain multiple (2.5 means 2.5 times)
  additive: boolean; // groups add up to the whole, so a share is meaningful
  definition: string;
}

const defs: MetricDef[] = [
  {
    id: "gross_sales",
    label: "Gross sales",
    unit: "money",
    additive: true,
    definition: "Quantity times list price on every order line, before discounts, for orders placed in the period. Cancelled orders are left out. An order counts on its store-local date.",
  },
  { id: "discounts", label: "Discounts", unit: "money", additive: true, definition: "Discounts applied to the order lines, for orders placed in the period." },
  {
    id: "refunds",
    label: "Refunds",
    unit: "money",
    additive: true,
    definition: "The value of refunded items (after the order's discount), counted on the day the refund was made, whenever the order was placed. Shipping is not refunded here.",
  },
  { id: "net_sales", label: "Net sales", unit: "money", additive: true, definition: "Gross sales minus discounts minus refunds, all counted in the same period." },
  { id: "orders", label: "Orders", unit: "count", additive: true, definition: "Number of orders placed in the period (cancelled orders left out)." },
  { id: "aov", label: "Average order value", unit: "money", additive: false, definition: "Gross sales minus discounts, divided by the number of orders. Refunds are not taken off. 0 when there are no orders." },
  { id: "units", label: "Units sold", unit: "count", additive: true, definition: "Total quantity on the order lines of orders placed in the period." },
  {
    id: "new_customer_orders",
    label: "New-customer orders",
    unit: "count",
    additive: true,
    definition: "Orders that are the customer's first order ever in this store. Guest orders with no customer record are not counted as new.",
  },
  {
    id: "returning_customer_rate",
    label: "Returning-customer rate",
    unit: "rate",
    additive: false,
    definition: "Of the customers who ordered in the period, the share with at least one order that was not their first ever order in this store. 0 when nobody ordered.",
  },
  {
    id: "refund_rate",
    label: "Refund rate",
    unit: "rate",
    additive: false,
    definition: "Units refunded, ever, from orders placed in the period, divided by units sold in the period. A later refund counts in the order's month.",
  },
  {
    id: "discounted_order_share",
    label: "Discounted-order share",
    unit: "rate",
    additive: false,
    definition: "The share of orders in the period that used a discount code.",
  },
  {
    id: "mer",
    label: "MER (marketing efficiency ratio)",
    unit: "ratio",
    additive: false,
    definition: "Net sales divided by ad spend on all channels, both for the period, so 2.5 means $2.50 of net sales for each $1 of ads. Ad spend is never narrowed by an order filter. 0 when there was no ad spend in the period or no ad spend has been loaded.",
  },
  {
    id: "new_customer_cac",
    label: "New-customer CAC",
    unit: "money",
    additive: false,
    definition: "Ad spend on all channels divided by the number of new-customer orders in the period: what each first order cost in ads. 0 when there were no new-customer orders or no ad spend.",
  },
];

export const METRICS = Object.fromEntries(defs.map((d) => [d.id, d])) as Record<MetricId, MetricDef>;
