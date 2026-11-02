// Shared contract for the seed generator, truth, loader and fixtures (T1).
// Conventions:
//  - Money is an integer number of cents everywhere in the dataset and in truth.json.
//    Only the loader converts to Shopify decimal strings ("28.00").
//  - Rates are fractions (0.18 means 18%). Counts are integers.
//  - `processedAt` is ISO 8601 with the store's UTC offset on that date, e.g. 2026-03-08T14:05:00-04:00.
//  - Ids are stable generator ids: P_001 (product), V_001 (variant), COL_01 (collection), LOC_01 (location),
//    CUST_8f3a19c2 (customer: "CUST_" + 8 hex), O_00001 (order), R_00001 (refund).

import type { CostCategory } from "../../lib/ebitda/types";

export type StoreKey = "solenne" | "tidepool";

export type Persona = "loyalist" | "regular" | "one_and_done" | "deal_seeker" | "gifter" | "wholesale";

export interface Product {
  genId: string;
  title: string;
  description: string;
  collectionGenIds: string[];
}

export interface Variant {
  genId: string;
  productGenId: string;
  sku: string;
  title: string; // e.g. "Fig" or "30 ml"; "Default Title" when a product has one variant
  price: number; // cents, the price today (S1's old price lives only on old order lines)
  unitCost: number; // cents
}

export interface Customer {
  genId: string;
  persona: Persona;
}

export interface OrderLine {
  variantGenId: string;
  qty: number;
  unitPrice: number; // cents, the price actually charged on this order
}

export interface Order {
  genId: string;
  processedAt: string;
  customerGenId: string;
  lines: OrderLine[];
  shipping: number; // cents, 0 above the free-shipping threshold
  discountCode?: string;
  // Total discount in cents, allocated across lines pro rata to line subtotal
  // (rounded half up per line, the remainder on the line with the largest subtotal).
  discountCents: number;
  channel: string; // the value after "channel:" in `tags`
  tags: string[]; // includes `channel:<channel>`, and `wholesale` for wholesale orders
  note?: string;
}

export interface Refund {
  genId: string;
  orderGenId: string;
  processedAt: string; // the refund's own date, never earlier than its order
  lines: { variantGenId: string; qty: number }[];
  reason: string;
}

export interface Collection {
  genId: string;
  title: string;
}

export interface Discount {
  code: string;
  kind: "percent" | "fixed";
  value: number; // percent: 25 means 25%; fixed: cents
}

export interface Location {
  genId: string;
  name: string;
}

export interface InventoryLevel {
  variantGenId: string;
  locationGenId: string;
  available: number; // the current level to set, after all seeded history
}

export interface Dataset {
  store: StoreKey;
  asOf: string; // YYYY-MM-DD
  seed: number;
  collections: Collection[];
  products: Product[];
  variants: Variant[];
  customers: Customer[];
  orders: Order[]; // sorted by processedAt, then genId
  refunds: Refund[]; // sorted by processedAt, then genId
  discounts: Discount[];
  locations: Location[];
  inventory: InventoryLevel[];
}

// Core metrics (build plan: 11 metrics). `repeat_rate` and `zero_sales_days` appear only in storyline checks.
export type CoreMetricId =
  | "gross_sales"
  | "discounts"
  | "refunds"
  | "net_sales"
  | "orders"
  | "aov"
  | "units"
  | "new_customer_orders"
  | "returning_customer_rate"
  | "refund_rate"
  | "discounted_order_share";

export type MetricId = CoreMetricId | "repeat_rate" | "zero_sales_days" | "gross_margin";

export interface StorylineCheck {
  metric: MetricId;
  // Which slice of the data the check is about, e.g. { product: "P_007" } or { discount_code: "VIPGLOW25" }.
  // An empty object means the whole store.
  filter: Record<string, string>;
  period: { from: string; to: string }; // inclusive, store-local dates
  expected: number;
  tolerance: number; // absolute, in the metric's unit
}

export interface Storyline {
  id: string; // "S3", "TP1", ...
  from: string;
  to: string;
  entities: string[]; // generator ids the story is about
  finding: string; // the expected finding, in words
  checks: StorylineCheck[];
}

export interface Truth {
  store: StoreKey;
  seed: number;
  asOf: string;
  window: { from: string; to: string };
  monthly: Record<string, Record<CoreMetricId, number>>; // key "YYYY-MM"
  storylines: Storyline[];
}

// fixtures/<store>/plan.csv: one row per month, columns named by metric ID.
export interface PlanRow {
  month: string; // "YYYY-MM"
  net_sales: number; // cents
  orders: number;
  new_customer_orders: number;
  aov: number; // cents
  returning_customer_rate: number; // fraction
}

// fixtures/<store>/ad-spend.csv: one row per day and channel.
export interface AdSpendRow {
  date: string;
  channel: "meta" | "google" | "tiktok";
  spend: number; // cents
}

// fixtures/<store>/costs.csv: one row per month and cost category. The file's column is `amount`, in whole cents.
export interface CostRow {
  month: string; // "YYYY-MM"
  category: CostCategory;
  amountCents: number;
}

// fixtures/<store>/cost-assumptions.csv: one row per rate behind the card-fee and fulfilment lines.
export interface CostAssumptionRow {
  key: string; // card_fee_bps, card_fee_fixed_cents or fulfilment_cents_per_order
  value: number; // a whole number: basis points or cents
}
