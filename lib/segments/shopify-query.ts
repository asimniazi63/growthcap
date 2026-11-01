import { SEGMENT_RULES, type SegmentId } from "./definitions";

// Our four segments written in Shopify's customer segment query language (segmentCreate(name, query), checked against the
// 2026-10 docs): number_of_orders is an integer, last_order_date takes a relative offset such as -90d, comparisons are
// = != > >= < <=, clauses join with AND, and a query may hold at most ten clauses. Every number comes from SEGMENT_RULES,
// so the page, the maths and the Shopify filter cannot drift apart. The query is built here and nowhere else: it is never
// taken from the model or from a stored payload.
//
// Plain comparisons are used for date windows rather than BETWEEN: BETWEEN is supported, but two comparisons mean the same
// thing without depending on how Shopify reads a mixed pair of relative dates.
//
// "Within N days" reads last_order_date >= -Nd (the day N days ago or later); "at least N days ago" reads last_order_date <= -Nd.
const R = SEGMENT_RULES;

const ordersAtLeast = (n: number) => `number_of_orders >= ${n}`;
const ordersExactly = (n: number) => `number_of_orders = ${n}`;
const lastWithin = (days: number) => `last_order_date >= -${days}d`;
const lastAtLeast = (days: number) => `last_order_date <= -${days}d`;
const all = (...clauses: string[]) => clauses.join(" AND ");

// Shopify cannot compare a customer's days since last order with that customer's own usual gap, which is how "due to reorder"
// is defined here. The nearest filter it can express is a fixed window: the gap multiples applied to one reference gap for the
// whole store. The reference is the champions window, the only rule that says how often a loyal customer buys.
const REFERENCE_GAP_DAYS = R.champions.maxDaysSinceLast;
const dueWindow = () => ({
  from: Math.round(R.dueToReorder.minGapMultiple * REFERENCE_GAP_DAYS),
  to: Math.round(R.dueToReorder.maxGapMultiple * REFERENCE_GAP_DAYS),
});

export function shopifySegmentQuery(segment: SegmentId): string {
  switch (segment) {
    case "champions":
      return all(ordersAtLeast(R.champions.minOrders), lastWithin(R.champions.maxDaysSinceLast));
    case "at_risk":
      return all(ordersAtLeast(R.atRisk.minOrders), lastWithin(R.atRisk.maxDaysSinceLast), lastAtLeast(R.atRisk.minDaysSinceLast));
    case "due_to_reorder": {
      const { from, to } = dueWindow();
      return all(ordersAtLeast(R.dueToReorder.minOrders), lastWithin(to), lastAtLeast(from));
    }
    case "one_and_done":
      return all(ordersExactly(R.oneAndDone.orders), lastAtLeast(R.oneAndDone.minDaysSinceLast));
  }
}

// Where the Shopify filter is only an approximation of our rule, one plain sentence saying how; otherwise null.
export function shopifySegmentCaveat(segment: SegmentId): string | null {
  if (segment !== "due_to_reorder") return null;
  const { from, to } = dueWindow();
  return `Shopify cannot compare a customer's time since their last order with their own usual gap between orders, so this filter is an approximation: ${R.dueToReorder.minOrders} or more orders and the last one ${from} to ${to} days ago (${R.dueToReorder.minGapMultiple} to ${R.dueToReorder.maxGapMultiple} times a ${REFERENCE_GAP_DAYS}-day reference gap). Its members will not match ours exactly.`;
}
