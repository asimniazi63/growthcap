import { describe, expect, it } from "vitest";
import { SEGMENT_IDS, SEGMENTS, type SegmentCustomer } from "@/lib/segments/definitions";
import { askToCreateQuestion, askToCreateUrl, intensity, money, moneyWhole, parseSegment, rfmCounts, topCustomers, TOP_N } from "./format";

const customer = (over: Partial<SegmentCustomer> = {}): SegmentCustomer => ({
  customerId: "CUST_a",
  orders: 2,
  firstOrderDate: "2026-01-02",
  lastOrderDate: "2026-09-20",
  daysSinceLast: 30,
  ltvCents: 10_000,
  medianGapDays: 40,
  r: 3,
  f: 3,
  m: 3,
  churnRisk: 0.2,
  segment: "at_risk",
  ...over,
});

describe("parseSegment: the ?segment= choice", () => {
  it("takes a known segment id and falls back to the first segment for anything else", () => {
    expect(parseSegment("one_and_done")).toBe("one_and_done");
    expect(parseSegment(undefined)).toBe(SEGMENT_IDS[0]);
    expect(parseSegment("active")).toBe(SEGMENT_IDS[0]);
    expect(parseSegment("AT_RISK")).toBe(SEGMENT_IDS[0]);
    expect(parseSegment(["at_risk", "champions"])).toBe("at_risk");
    expect(parseSegment([])).toBe(SEGMENT_IDS[0]);
  });
});

describe("topCustomers", () => {
  it("lists one segment's customers by lifetime value, then id, and stops at the limit", () => {
    const all = [
      customer({ customerId: "CUST_c", ltvCents: 500 }),
      customer({ customerId: "CUST_b", ltvCents: 900 }),
      customer({ customerId: "CUST_a", ltvCents: 500 }),
      customer({ customerId: "CUST_x", ltvCents: 99_999, segment: "champions" }),
    ];
    expect(topCustomers(all, "at_risk").map((c) => c.customerId)).toEqual(["CUST_b", "CUST_a", "CUST_c"]);
    expect(topCustomers(all, "at_risk", 2).map((c) => c.customerId)).toEqual(["CUST_b", "CUST_a"]);
    expect(topCustomers(all, "one_and_done")).toEqual([]);
  });

  it("shows 15 by default", () => {
    const many = Array.from({ length: 40 }, (_, i) => customer({ customerId: `CUST_${String(i).padStart(2, "0")}`, ltvCents: i }));
    expect(TOP_N).toBe(15);
    expect(topCustomers(many, "at_risk")).toHaveLength(15);
    expect(topCustomers(many, "at_risk")[0]?.customerId).toBe("CUST_39");
  });
});

describe("rfmCounts: recency rows 5 to 1, frequency columns 1 to 5", () => {
  it("counts every customer once, the most recent row first", () => {
    const grid = rfmCounts([customer({ r: 5, f: 1 }), customer({ r: 5, f: 1 }), customer({ r: 1, f: 5 }), customer({ r: 3, f: 2 })]);
    expect(grid).toHaveLength(5);
    expect(grid.every((row) => row.length === 5)).toBe(true);
    expect(grid[0]?.[0]).toBe(2); // r 5, f 1
    expect(grid[4]?.[4]).toBe(1); // r 1, f 5
    expect(grid[2]?.[1]).toBe(1); // r 3, f 2
    expect(grid.flat().reduce((a, b) => a + b, 0)).toBe(4);
  });

  it("ignores a score outside 1 to 5 instead of counting it in the wrong cell", () => {
    const grid = rfmCounts([customer({ r: 0, f: 3 }), customer({ r: 3, f: 6 }), customer({ r: 2.5, f: 3 })]);
    expect(grid.flat().reduce((a, b) => a + b, 0)).toBe(0);
  });
});

describe("intensity: 0 for an empty cell, then 1 to 4 relative to the fullest cell", () => {
  it.each([
    [0, 100, 0],
    [1, 100, 1],
    [25, 100, 1],
    [26, 100, 2],
    [50, 100, 2],
    [75, 100, 3],
    [76, 100, 4],
    [100, 100, 4],
    [5, 0, 0], // no customers at all
  ])("count %d of max %d is level %d", (count, max, level) => {
    expect(intensity(count, max)).toBe(level);
  });
});

describe("the chat link", () => {
  it("asks the agent to create the segment in Shopify with the segment's title", () => {
    for (const s of SEGMENTS) {
      expect(askToCreateQuestion(s.id)).toBe(`Create the ${s.title} segment in Shopify`);
      expect(askToCreateUrl(s.id)).toBe(`/chat?q=${encodeURIComponent(`Create the ${s.title} segment in Shopify`)}`);
    }
  });
});

describe("moneyWhole: axis ticks", () => {
  it("prints whole currency units with separators, where money prints cents", () => {
    expect(moneyWhole(0, "USD")).toBe("$0");
    expect(moneyWhole(500_00, "USD")).toBe("$500");
    expect(moneyWhole(1_000_00, "USD")).toBe("$1,000");
    expect(money(1_000_00, "USD")).toBe("$1,000.00");
  });
});
