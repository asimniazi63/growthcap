import { describe, expect, it } from "vitest";
import { SEGMENT_IDS, SEGMENT_RULES } from "./definitions";
import { shopifySegmentCaveat, shopifySegmentQuery } from "./shopify-query";

const R = SEGMENT_RULES;

describe("shopifySegmentQuery", () => {
  it("gives one non-empty query for every segment, and no two alike", () => {
    const queries = SEGMENT_IDS.map(shopifySegmentQuery);
    expect(queries.every((q) => q.length > 0)).toBe(true);
    expect(new Set(queries).size).toBe(SEGMENT_IDS.length);
  });

  it("builds champions from the order count and recency in the rules", () => {
    expect(shopifySegmentQuery("champions")).toBe(`number_of_orders >= ${R.champions.minOrders} AND last_order_date >= -${R.champions.maxDaysSinceLast}d`);
  });

  it("builds at risk as a window of last-order dates, oldest bound first", () => {
    expect(shopifySegmentQuery("at_risk")).toBe(
      `number_of_orders >= ${R.atRisk.minOrders} AND last_order_date >= -${R.atRisk.maxDaysSinceLast}d AND last_order_date <= -${R.atRisk.minDaysSinceLast}d`,
    );
  });

  it("builds one and done as exactly one order, quiet for at least the rule's days", () => {
    expect(shopifySegmentQuery("one_and_done")).toBe(`number_of_orders = ${R.oneAndDone.orders} AND last_order_date <= -${R.oneAndDone.minDaysSinceLast}d`);
  });

  it("approximates due to reorder with a fixed window: the gap multiples applied to the champions window", () => {
    const from = Math.round(R.dueToReorder.minGapMultiple * R.champions.maxDaysSinceLast);
    const to = Math.round(R.dueToReorder.maxGapMultiple * R.champions.maxDaysSinceLast);
    expect(from).toBeLessThan(to);
    expect(shopifySegmentQuery("due_to_reorder")).toBe(`number_of_orders >= ${R.dueToReorder.minOrders} AND last_order_date >= -${to}d AND last_order_date <= -${from}d`);
  });

  it("uses only fields and operators from Shopify's segment language, in at most ten clauses", () => {
    for (const id of SEGMENT_IDS) {
      const q = shopifySegmentQuery(id);
      const clauses = q.split(" AND ");
      expect(clauses.length).toBeLessThanOrEqual(10);
      for (const c of clauses) expect(c, `${id}: ${c}`).toMatch(/^(number_of_orders (=|>=|<=|>|<) \d+|last_order_date (>=|<=|>|<) -\d+d)$/);
      expect(q).not.toMatch(/[;{}"'`\n]/); // nothing that could end a clause or a string early
    }
  });
});

describe("shopifySegmentCaveat", () => {
  it("explains the approximation for due to reorder with the same numbers as the query, and for no other segment", () => {
    const from = Math.round(R.dueToReorder.minGapMultiple * R.champions.maxDaysSinceLast);
    const to = Math.round(R.dueToReorder.maxGapMultiple * R.champions.maxDaysSinceLast);
    const text = shopifySegmentCaveat("due_to_reorder")!;
    expect(text).toContain(`${from} to ${to} days`);
    expect(text).toMatch(/own usual gap/);
    for (const id of SEGMENT_IDS.filter((s) => s !== "due_to_reorder")) expect(shopifySegmentCaveat(id)).toBeNull();
  });
});
