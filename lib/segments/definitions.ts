// The four retention segments (T17, feature 35). The ids, titles and thresholds live here once: the segment maths
// (lib/metrics/segments.ts), the CSV export, the page and the Shopify segment action all read them, so none of them can drift.
// Customers are pseudonymous ids only (CUST_ + hash); nothing here holds a name, email, phone or address.

export const SEGMENT_IDS = ["champions", "at_risk", "due_to_reorder", "one_and_done"] as const;
export type SegmentId = (typeof SEGMENT_IDS)[number];
// A customer who is in none of the four is "active" (bought recently, but not a champion and not due to reorder). It is never offered as an action.
export type SegmentOrActive = SegmentId | "active";

export interface SegmentInfo {
  id: SegmentId;
  title: string;
  description: string; // one plain sentence for the page and the tool
}

export const SEGMENTS: SegmentInfo[] = [
  { id: "champions", title: "Champions", description: "Three or more orders, the latest within the last 90 days." },
  { id: "at_risk", title: "At risk", description: "Two or more orders, but nothing in the last 90 days (and still within a year)." },
  { id: "due_to_reorder", title: "Due to reorder", description: "Two or more orders, and the time since the last one is close to their own usual gap between orders." },
  { id: "one_and_done", title: "One and done", description: "One order only, placed at least 60 days ago." },
];

// Days are counted from a customer's last order to `asOf`, the last day of synced orders. A customer takes the FIRST segment they
// qualify for, in the order of SEGMENT_IDS. The tuning notes belong in the tests and the README, not in these numbers' names.
export const SEGMENT_RULES = {
  champions: { minOrders: 3, maxDaysSinceLast: 90 },
  atRisk: { minOrders: 2, minDaysSinceLast: 91, maxDaysSinceLast: 365 },
  // days since the last order, as a multiple of the customer's own median gap between consecutive orders
  dueToReorder: { minOrders: 2, minGapMultiple: 0.8, maxGapMultiple: 1.5 },
  oneAndDone: { orders: 1, minDaysSinceLast: 60 },
} as const;

// One customer, scored. Built by lib/metrics/segments.ts from the synced orders.
export interface SegmentCustomer {
  customerId: string; // pseudonym
  orders: number; // non-cancelled orders, ever
  firstOrderDate: string; // store-local YYYY-MM-DD
  lastOrderDate: string;
  daysSinceLast: number; // from lastOrderDate to asOf
  ltvCents: number; // net of discounts and refunds, everything the customer has bought so far
  medianGapDays: number | null; // median days between consecutive orders; null with fewer than 2 orders
  r: number; // recency score, 1 (longest ago) to 5 (most recent)
  f: number; // frequency score, 1 to 5
  m: number; // monetary score, 1 to 5
  churnRisk: number; // 0 to 1, a fraction: an explainable heuristic, not a model (see lib/metrics/segments.ts)
  segment: SegmentOrActive;
}

// The columns of the Klaviyo CSV (lib/segments/csv.ts). ltv is in dollars with two decimals; everything else is as in SegmentCustomer.
export const CSV_COLUMNS = ["customer_id", "segment", "orders", "ltv", "days_since_last_order", "r", "f", "m"] as const;
