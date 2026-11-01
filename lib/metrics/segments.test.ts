import { describe, expect, it } from "vitest";
import { SEGMENT_IDS, SEGMENT_RULES, type SegmentCustomer } from "../segments/definitions";
import { addDays } from "./dates";
import { churnRiskOf, medianOf, rankScores, scoreCustomers, segmentOf, summarizeSegments, type CustomerFacts } from "./segments";

const ASOF = "2026-10-31";
const ago = (days: number) => addDays(ASOF, -days);
// Orders placed this many days before ASOF, in any order.
const facts = (customerId: string, daysAgo: number[], ltvCents = 10_000): CustomerFacts => ({ customerId, orderDates: daysAgo.map(ago), ltvCents });
const byId = (cs: SegmentCustomer[], id: string) => cs.find((c) => c.customerId === id)!;

describe("rankScores", () => {
  it("spreads distinct values evenly over 1 to 5, the highest value getting 5", () => {
    expect(rankScores([10, 20, 30, 40, 50])).toEqual([1, 2, 3, 4, 5]);
    expect(rankScores([50, 10, 40, 20, 30])).toEqual([5, 1, 4, 2, 3]);
    expect(rankScores([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).toEqual([1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
  });

  it("gives equal values the same score, from their shared average rank", () => {
    expect(rankScores([7, 7, 7, 7])).toEqual([3, 3, 3, 3]); // nobody stands out: the middle
    expect(rankScores([1, 1, 1, 1, 1, 1, 1, 1, 1, 9])).toEqual([3, 3, 3, 3, 3, 3, 3, 3, 3, 5]);
    // 1,1,2: the two 1s share rank 1.5 of 3 -> (1.5 - 0.5) / 3 = 0.33 -> score 2; the 2 is rank 3 -> 0.83 -> 5
    expect(rankScores([1, 1, 2])).toEqual([2, 2, 5]);
  });

  it("scores a single customer in the middle, and nobody as nothing", () => {
    expect(rankScores([42])).toEqual([3]);
    expect(rankScores([])).toEqual([]);
  });

  it("depends on the values, not the order they come in", () => {
    expect(rankScores([1, 1, 3, 5, 5, 9])).toEqual([1, 1, 3, 4, 4, 5]);
    expect(rankScores([5, 1, 5, 3, 1, 9])).toEqual([4, 1, 4, 3, 1, 5]);
  });
});

describe("medianOf", () => {
  it("takes the middle value, and the exact average of the middle two for an even count", () => {
    expect(medianOf([30])).toBe(30);
    expect(medianOf([10, 90, 30])).toBe(30);
    expect(medianOf([10, 30])).toBe(20);
    expect(medianOf([10, 31])).toBe(20.5);
    expect(medianOf([1, 2, 3, 100])).toBe(2.5);
  });

  it("has none for no values", () => {
    expect(medianOf([])).toBeNull();
  });
});

describe("churnRiskOf", () => {
  it("is 0 until the customer is overdue", () => {
    expect(churnRiskOf(0, 30)).toBe(0);
    expect(churnRiskOf(10, 30)).toBe(0);
    expect(churnRiskOf(30, 30)).toBe(0);
  });

  it("rises from 0 at their usual gap to 1 at three times it, and stays at 1", () => {
    expect(churnRiskOf(45, 30)).toBe(0.25);
    expect(churnRiskOf(60, 30)).toBe(0.5);
    expect(churnRiskOf(90, 30)).toBe(1);
    expect(churnRiskOf(400, 30)).toBe(1);
  });

  it("treats a gap of 0 days (two orders the same day) as 1 day", () => {
    expect(churnRiskOf(3, 0)).toBe(1);
    expect(churnRiskOf(1, 0)).toBe(0);
    expect(churnRiskOf(2, 0)).toBe(0.5);
  });

  it("rounds to three decimals", () => {
    expect(churnRiskOf(41, 30)).toBe(0.183); // (41/30 - 1) / 2 = 0.18333
  });
});

describe("segmentOf, the first rule that fits", () => {
  const seg = (orders: number, daysSinceLast: number, medianGapDays: number | null) => segmentOf({ orders, daysSinceLast, medianGapDays });

  it("champions: three or more orders, the latest within 90 days", () => {
    expect(seg(3, 90, 200)).toBe("champions");
    expect(seg(7, 0, 20)).toBe("champions");
    expect(seg(3, 91, 200)).toBe("at_risk"); // one day too long ago
    expect(seg(2, 10, 200)).not.toBe("champions"); // too few orders
  });

  it("at risk: two or more orders, none in the last 90 days, still within a year", () => {
    expect(seg(2, 91, 400)).toBe("at_risk");
    expect(seg(5, 365, 400)).toBe("at_risk");
    expect(seg(2, 366, 100)).toBe("active"); // gone for over a year: in none of the four
    expect(seg(2, 90, 400)).toBe("active");
  });

  it("due to reorder: two or more orders, the time since the last in 0.8 to 1.5 times their own median gap", () => {
    expect(seg(2, 24, 30)).toBe("due_to_reorder"); // exactly 0.8
    expect(seg(2, 45, 30)).toBe("due_to_reorder"); // exactly 1.5
    expect(seg(2, 23, 30)).toBe("active"); // not yet
    expect(seg(2, 46, 30)).toBe("active"); // well overdue, no longer "due"
  });

  it("one and done: a single order at least 60 days ago", () => {
    expect(seg(1, 60, null)).toBe("one_and_done");
    expect(seg(1, 400, null)).toBe("one_and_done");
    expect(seg(1, 59, null)).toBe("active");
  });

  it("a three-order customer inside 90 days is a champion even when they are also due to reorder", () => {
    expect(seg(3, 40, 40)).toBe("champions");
  });

  it("at risk comes before due to reorder when both fit", () => {
    expect(seg(2, 100, 100)).toBe("at_risk");
  });

  it("a gap of 0 days counts as 1 day, so a same-day pair is due only on the first day or so", () => {
    expect(seg(2, 1, 0)).toBe("due_to_reorder"); // 1 / max(1, 0) = 1
    expect(seg(2, 30, 0)).toBe("active");
  });

  it("reads its thresholds from SEGMENT_RULES", () => {
    expect(SEGMENT_RULES.champions.minOrders).toBeGreaterThanOrEqual(2);
    expect(seg(SEGMENT_RULES.champions.minOrders, SEGMENT_RULES.champions.maxDaysSinceLast, null)).toBe("champions");
  });
});

describe("scoreCustomers", () => {
  it("computes orders, dates, days since last, median gap and LTV for one customer", () => {
    const [c] = scoreCustomers([facts("CUST_a", [100, 70, 10], 30_000)], ASOF);
    expect(c).toMatchObject({ customerId: "CUST_a", orders: 3, firstOrderDate: ago(100), lastOrderDate: ago(10), daysSinceLast: 10, ltvCents: 30_000 });
    expect(c!.medianGapDays).toBe(45); // gaps of 30 and 60 days
  });

  it("has no median gap for one order, and orders the dates itself", () => {
    const cs = scoreCustomers([facts("CUST_one", [50]), facts("CUST_two", [10, 50])], ASOF);
    expect(byId(cs, "CUST_one").medianGapDays).toBeNull();
    expect(byId(cs, "CUST_two")).toMatchObject({ firstOrderDate: ago(50), lastOrderDate: ago(10), medianGapDays: 40 });
  });

  it("a one-customer tenant scores 3 on everything and is not a champion for being alone", () => {
    const [c, ...rest] = scoreCustomers([facts("CUST_solo", [10], 5_000)], ASOF);
    expect(rest).toEqual([]);
    expect(c).toMatchObject({ r: 3, f: 3, m: 3, segment: "active" });
    expect(c!.churnRisk).toBe(0); // 10 days of a 120-day fallback gap
  });

  it("all one-order customers with the same LTV get the same scores", () => {
    const cs = scoreCustomers([facts("CUST_a", [30]), facts("CUST_b", [30]), facts("CUST_c", [30]), facts("CUST_d", [30])], ASOF);
    for (const c of cs) expect(c).toMatchObject({ r: 3, f: 3, m: 3, churnRisk: 0, segment: "active" });
  });

  it("identical customers get identical scores whatever else is in the store", () => {
    const cs = scoreCustomers(
      [facts("CUST_a", [200, 100], 20_000), facts("CUST_b", [200, 100], 20_000), facts("CUST_c", [5], 1_000), facts("CUST_d", [300], 90_000), facts("CUST_e", [60, 30, 1], 50_000)],
      ASOF,
    );
    expect({ ...byId(cs, "CUST_a"), customerId: "" }).toEqual({ ...byId(cs, "CUST_b"), customerId: "" });
  });

  it("scores recency by fewer days since last = higher, frequency by more orders, money by more LTV", () => {
    const cs = scoreCustomers(
      [
        facts("CUST_1", [300], 1_000),
        facts("CUST_2", [200, 150], 2_000),
        facts("CUST_3", [120, 100, 90], 3_000),
        facts("CUST_4", [60, 50, 40, 30], 4_000),
        facts("CUST_5", [20, 15, 10, 5, 1], 5_000),
      ],
      ASOF,
    );
    expect(cs.map((c) => [c.customerId, c.r, c.f, c.m])).toEqual([
      ["CUST_5", 5, 5, 5],
      ["CUST_4", 4, 4, 4],
      ["CUST_3", 3, 3, 3],
      ["CUST_2", 2, 2, 2],
      ["CUST_1", 1, 1, 1],
    ]);
  });

  it("sorts by LTV, highest first, then by customer id", () => {
    const cs = scoreCustomers([facts("CUST_b", [10], 100), facts("CUST_c", [10], 900), facts("CUST_a", [10], 100)], ASOF);
    expect(cs.map((c) => c.customerId)).toEqual(["CUST_c", "CUST_a", "CUST_b"]);
  });

  it("a one-order customer's churn risk uses the store's typical gap (the median of everyone's median gaps)", () => {
    const cs = scoreCustomers(
      [
        facts("CUST_gap20", [100, 80], 1), // median gap 20
        facts("CUST_gap40", [200, 160], 1), // 40
        facts("CUST_gap60", [300, 240], 1), // 60 -> typical gap = 40
        facts("CUST_once", [60], 1), // 60 / 40 = 1.5 -> (1.5 - 1) / 2
        facts("CUST_late", [200], 1), // 200 / 40 = 5 -> 1
        facts("CUST_early", [20], 1), // 0
      ],
      ASOF,
    );
    expect(byId(cs, "CUST_once").churnRisk).toBe(0.25);
    expect(byId(cs, "CUST_late").churnRisk).toBe(1);
    expect(byId(cs, "CUST_early").churnRisk).toBe(0);
  });

  it("falls back to a typical gap of 120 days when nobody has ordered twice", () => {
    const cs = scoreCustomers([facts("CUST_a", [180]), facts("CUST_b", [120]), facts("CUST_c", [30])], ASOF);
    expect(byId(cs, "CUST_a").churnRisk).toBe(0.25); // 180 / 120 = 1.5
    expect(byId(cs, "CUST_b").churnRisk).toBe(0);
    expect(byId(cs, "CUST_c").churnRisk).toBe(0);
  });

  it("a repeat customer's churn risk uses their own gap", () => {
    const [c] = scoreCustomers([facts("CUST_a", [200, 170, 140, 110], 1)], ASOF); // gaps all 30, last 110 days ago
    expect(c).toMatchObject({ medianGapDays: 30, daysSinceLast: 110, churnRisk: 1 }); // 110 / 30 = 3.67 -> past three times
  });

  it("puts each customer in one segment by the rules, with the counts adding up", () => {
    const cs = scoreCustomers(
      [
        facts("CUST_champ", [200, 100, 30], 90_000), // 3 orders, last 30 days ago
        facts("CUST_risk", [300, 200, 120], 40_000), // 3 orders, last 120 days ago
        facts("CUST_due", [100, 70, 40], 40_000), // gap 30, last 40 days ago, so due too: but 3 orders inside 90 days is a champion first
        facts("CUST_due2", [100, 40], 40_000), // gap 60, last 40: ratio 0.67, not yet
        facts("CUST_due3", [100, 50], 40_000), // gap 50, last 50: ratio 1 -> due
        facts("CUST_done", [200], 4_000),
        facts("CUST_new", [20], 4_000),
        facts("CUST_gone", [420, 400], 4_000), // 2 orders, last 400 days ago
      ],
      ASOF,
    );
    const seg = Object.fromEntries(cs.map((c) => [c.customerId, c.segment]));
    expect(seg).toEqual({
      CUST_champ: "champions",
      CUST_risk: "at_risk",
      CUST_due: "champions",
      CUST_due2: "active",
      CUST_due3: "due_to_reorder",
      CUST_done: "one_and_done",
      CUST_new: "active",
      CUST_gone: "active",
    });
  });
});

describe("summarizeSegments", () => {
  const customers = scoreCustomers(
    [
      facts("CUST_champ", [200, 100, 30], 90_000),
      facts("CUST_champ2", [200, 100, 5], 110_000),
      facts("CUST_risk", [300, 120], 40_000),
      facts("CUST_done1", [200], 4_000),
      facts("CUST_done2", [100], 6_000),
      facts("CUST_new", [20], 5_000),
    ],
    ASOF,
  );

  it("has one row per segment, then active, in order, with zero rows kept", () => {
    const s = summarizeSegments(customers);
    expect(s.map((r) => r.segment)).toEqual([...SEGMENT_IDS, "active"]);
    const due = s.find((r) => r.segment === "due_to_reorder")!;
    expect(due).toMatchObject({ customers: 0, shareOfCustomers: 0, avgLtvCents: 0, totalLtvCents: 0, avgOrders: 0, avgDaysSinceLast: 0, avgChurnRisk: 0 });
  });

  it("counts, shares, totals and averages per segment", () => {
    const s = summarizeSegments(customers);
    const row = (id: string) => s.find((r) => r.segment === id)!;
    expect(row("champions")).toMatchObject({ customers: 2, totalLtvCents: 200_000, avgLtvCents: 100_000, avgOrders: 3, avgDaysSinceLast: 17.5 });
    expect(row("champions").shareOfCustomers).toBeCloseTo(2 / 6, 10);
    expect(row("one_and_done")).toMatchObject({ customers: 2, totalLtvCents: 10_000, avgLtvCents: 5_000, avgOrders: 1, avgDaysSinceLast: 150 });
    expect(row("at_risk")).toMatchObject({ customers: 1, totalLtvCents: 40_000, avgLtvCents: 40_000, avgOrders: 2 });
    expect(row("active")).toMatchObject({ customers: 1, totalLtvCents: 5_000 });
  });

  it("adds up: the customers and the LTV of the segments are the whole store's", () => {
    const s = summarizeSegments(customers);
    expect(s.reduce((n, r) => n + r.customers, 0)).toBe(customers.length);
    expect(s.reduce((n, r) => n + r.totalLtvCents, 0)).toBe(customers.reduce((n, c) => n + c.ltvCents, 0));
    expect(s.reduce((n, r) => n + r.shareOfCustomers, 0)).toBeCloseTo(1, 10);
  });

  it("averages the churn risk of the segment as a fraction", () => {
    const s = summarizeSegments(customers);
    const done = customers.filter((c) => c.segment === "one_and_done");
    const mean = done.reduce((n, c) => n + c.churnRisk, 0) / done.length;
    expect(s.find((r) => r.segment === "one_and_done")!.avgChurnRisk).toBeCloseTo(mean, 2);
  });

  it("an empty store gives five zero rows, not a divide by zero", () => {
    const s = summarizeSegments([]);
    expect(s).toHaveLength(5);
    for (const r of s) expect(r).toMatchObject({ customers: 0, shareOfCustomers: 0, avgLtvCents: 0, totalLtvCents: 0 });
  });
});
