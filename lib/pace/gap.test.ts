import { describe, expect, it } from "vitest";
import { planGap, type PlanTargets } from "./gap";
import { MIN_DAYS_FOR_ESTIMATE } from "./shape";

const plan: PlanTargets = new Map([
  ["2026-11", { net_sales: 1_000_000, orders: 100, new_customer_orders: 60, aov: 10_000, returning_customer_rate: 0.4 }],
  ["2026-10", { net_sales: 650_688, orders: 92, new_customer_orders: 44 }],
]);

// 30 days: ten a day to day 27, then a burst on 28 to 30 (as in a Black Friday month).
const burst = [...Array(27).fill(10), 100, 100, 50];
const lastYear = async () => burst;
const noPattern = async () => null;

describe("planGap: a whole month", () => {
  it("compares the month with its target, and says nothing about where it will land", async () => {
    const g = await planGap({ plan, range: { from: "2026-10-01", to: "2026-10-31" }, metrics: ["net_sales", "new_customer_orders"], values: { net_sales: 590_200, new_customer_orders: 34 }, lastYearDaily: noPattern });
    expect(g!.net_sales).toMatchObject({ month: "2026-10", target: 650_688, planned: 650_688, actual: 590_200, gap: -60_488, throughDate: "2026-10-31" });
    expect(g!.net_sales!.pctGap).toBeCloseTo(-0.0930, 4);
    expect(g!.net_sales!.projected).toBeUndefined();
    expect(g!.new_customer_orders).toMatchObject({ target: 44, planned: 44, actual: 34, gap: -10 });
    expect(g!.new_customer_orders!.pctGap).toBeCloseTo(-0.2273, 4);
  });
});

describe("planGap: month to date", () => {
  const input = { plan, range: { from: "2026-11-01", to: "2026-11-20" }, metrics: ["orders" as const], values: { orders: 30 } };

  it("spreads the target by last year's pattern, so a burst at the end of the month isn't owed in the first three weeks", async () => {
    const g = await planGap({ ...input, lastYearDaily: lastYear });
    // days 1-20 are 200 of 520 of last year's month
    expect(g!.orders!.planned).toBeCloseTo(100 * (200 / 520), 1);
    expect(g!.orders!.spread).toBe("last_year");
    expect(g!.orders!.planned).toBeLessThan(100 * (20 / 30)); // a straight line would say 66.7
  });

  it("spreads evenly, and says so, when last year's month isn't in the data", async () => {
    const g = await planGap({ ...input, lastYearDaily: noPattern });
    expect(g!.orders).toMatchObject({ planned: 66.7, spread: "even" });
  });

  it("estimates the month's landing as actual so far plus the rest of the plan scaled by actual over plan so far", async () => {
    const g = await planGap({ ...input, lastYearDaily: noPattern });
    // planned so far 66.7, rest 33.3 (to one decimal each); actual 30
    expect(g!.orders!.projected).toBeCloseTo(30 + (100 - 100 * (20 / 30)) * (30 / (100 * (20 / 30))), 1);
    expect(g!.orders!.gap).toBeCloseTo(30 - 66.7, 5);
  });

  it("gives no estimate before any of the plan is due (the range starts the month but covers no planned day)", async () => {
    const zero = await planGap({ plan, range: { from: "2026-11-01", to: "2026-11-01" }, metrics: ["orders"], values: { orders: 0 }, lastYearDaily: async () => [0, ...Array(29).fill(10)] });
    expect(zero!.orders!.planned).toBe(0);
    expect(zero!.orders!.projected).toBeUndefined();
    expect(zero!.orders!.pctGap).toBeNull();
  });

  it("rounds money to whole cents and counts to one decimal, and the gap uses the rounded figures", async () => {
    const g = await planGap({ plan, range: { from: "2026-11-01", to: "2026-11-10" }, metrics: ["net_sales", "orders"], values: { net_sales: 300_001, orders: 31 }, lastYearDaily: noPattern });
    expect(Number.isInteger(g!.net_sales!.planned)).toBe(true);
    expect(g!.net_sales!.planned).toBe(333_333);
    expect(g!.net_sales!.gap).toBe(300_001 - 333_333);
    expect(g!.orders!.planned).toBe(33.3);
  });
});

describe("planGap: too early in the month for an estimate", () => {
  const through = (day: number) => ({ plan, range: { from: "2026-11-01", to: `2026-11-${String(day).padStart(2, "0")}` }, metrics: ["net_sales" as const, "orders" as const, "aov" as const], values: { net_sales: 40_000 * day, orders: 3 * day, aov: 9_000 }, lastYearDaily: noPattern });

  it("waits for five complete days", () => {
    expect(MIN_DAYS_FOR_ESTIMATE).toBe(5);
  });

  it("gives no estimate before the fifth day, and says how many days there are and how many it needs", async () => {
    for (const day of [1, 2, 3, 4]) {
      const g = await planGap(through(day));
      for (const metric of ["net_sales", "orders"] as const) {
        expect(g![metric]!.projected, `${metric} on day ${day}`).toBeUndefined();
        expect(g![metric]!.earlyMonth, `${metric} on day ${day}`).toEqual({ daysCounted: day, estimateAfterDays: 5 });
      }
    }
  });

  it("gives the estimate from the fifth day, with nothing to say about the month being young", async () => {
    const g = await planGap(through(5));
    expect(g!.net_sales!.projected).toBeGreaterThan(0);
    expect(g!.net_sales!.earlyMonth).toBeUndefined();
  });

  it("still says what each remaining day has to bring, and how the month stands against plan so far", async () => {
    const g = await planGap(through(2));
    expect(g!.net_sales).toMatchObject({ planned: 66_667, actual: 80_000, gap: 13_333, neededPerDay: Math.round((1_000_000 - 80_000) / 28), daysLeft: 28 });
  });

  it("is not a thing for a rate or an average, which never had an estimate", async () => {
    expect((await planGap(through(2)))!.aov!.earlyMonth).toBeUndefined();
  });

  it("is not a thing for a whole month, or a range that does not start the month", async () => {
    const whole = await planGap({ ...through(2), range: { from: "2026-11-01", to: "2026-11-30" } });
    expect(whole!.net_sales!.earlyMonth).toBeUndefined();
    const mid = await planGap({ ...through(2), range: { from: "2026-11-02", to: "2026-11-03" } });
    expect(mid!.net_sales!.earlyMonth).toBeUndefined();
  });
});

describe("planGap: other ranges and metrics", () => {
  it("plans only the days asked for when the range starts mid-month, and gives no estimate", async () => {
    const g = await planGap({ plan, range: { from: "2026-11-11", to: "2026-11-20" }, metrics: ["orders"], values: { orders: 20 }, lastYearDaily: noPattern });
    expect(g!.orders).toMatchObject({ planned: 33.3, actual: 20 });
    expect(g!.orders!.projected).toBeUndefined();
  });

  it("compares average order value and the returning rate with the month's target as it stands, with no spreading", async () => {
    const g = await planGap({ plan, range: { from: "2026-11-01", to: "2026-11-20" }, metrics: ["aov", "returning_customer_rate"], values: { aov: 9_000, returning_customer_rate: 0.3 }, lastYearDaily: lastYear });
    expect(g!.aov).toMatchObject({ target: 10_000, planned: 10_000, gap: -1_000 });
    expect(g!.returning_customer_rate).toMatchObject({ target: 0.4, planned: 0.4, actual: 0.3 });
    expect(g!.returning_customer_rate!.gap).toBeCloseTo(-0.1, 6);
    expect(g!.aov!.projected).toBeUndefined();
    expect(g!.aov!.spread).toBeUndefined();
  });

  it("covers only the metrics asked for that the plan has a target for", async () => {
    const g = await planGap({ plan, range: { from: "2026-10-01", to: "2026-10-31" }, metrics: ["net_sales", "aov", "gross_sales"], values: { net_sales: 1, aov: 2, gross_sales: 3 }, lastYearDaily: noPattern });
    expect(Object.keys(g!)).toEqual(["net_sales"]); // October has no aov target
  });

  it("is absent for a range that spans two months, a month with no plan, no plan at all, or no metric with a target", async () => {
    const base = { metrics: ["orders" as const], values: { orders: 1 }, lastYearDaily: noPattern };
    expect(await planGap({ ...base, plan, range: { from: "2026-10-20", to: "2026-11-05" } })).toBeUndefined();
    expect(await planGap({ ...base, plan, range: { from: "2026-12-01", to: "2026-12-31" } })).toBeUndefined();
    expect(await planGap({ ...base, plan: null, range: { from: "2026-11-01", to: "2026-11-30" } })).toBeUndefined();
    expect(await planGap({ ...base, metrics: ["gross_sales"], plan, range: { from: "2026-11-01", to: "2026-11-30" } })).toBeUndefined();
  });
});

describe("planGap: what each remaining day has to bring (neededPerDay)", () => {
  const base = { plan, metrics: ["net_sales" as const, "orders" as const], lastYearDaily: noPattern };

  it("is the target less the actual so far, over the days left in the month, in cents for money and one decimal for counts", async () => {
    // October has 31 days; through the 15th, 16 are left.
    const g = await planGap({ ...base, range: { from: "2026-10-01", to: "2026-10-15" }, values: { net_sales: 280_000, orders: 40 } });
    expect(g!.net_sales).toMatchObject({ daysLeft: 16, neededPerDay: Math.round((650_688 - 280_000) / 16) });
    expect(g!.orders).toMatchObject({ daysLeft: 16, neededPerDay: Math.round(((92 - 40) / 16) * 10) / 10 });
    expect(g!.net_sales!.targetMet).toBeUndefined();
  });

  it("is absent once the target is met, which targetMet says, and never negative", async () => {
    const g = await planGap({ ...base, range: { from: "2026-10-01", to: "2026-10-15" }, values: { net_sales: 700_000, orders: 92 } });
    expect(g!.net_sales).toMatchObject({ targetMet: true, daysLeft: 16 });
    expect(g!.net_sales!.neededPerDay).toBeUndefined();
    expect(g!.orders!.neededPerDay).toBeUndefined();
  });

  it("is absent for a whole month, a range that doesn't start the month, and a rate or an average", async () => {
    const whole = await planGap({ ...base, range: { from: "2026-10-01", to: "2026-10-31" }, values: { net_sales: 100, orders: 1 } });
    expect(whole!.net_sales!.neededPerDay).toBeUndefined();
    const mid = await planGap({ ...base, range: { from: "2026-10-05", to: "2026-10-15" }, values: { net_sales: 100, orders: 1 } });
    expect(mid!.net_sales!.neededPerDay).toBeUndefined();
    const rate = await planGap({ plan, range: { from: "2026-11-01", to: "2026-11-10" }, metrics: ["aov", "returning_customer_rate"], values: { aov: 9_000, returning_customer_rate: 0.3 }, lastYearDaily: noPattern });
    expect(rate!.aov!.neededPerDay).toBeUndefined();
    expect(rate!.returning_customer_rate!.neededPerDay).toBeUndefined();
  });
});
