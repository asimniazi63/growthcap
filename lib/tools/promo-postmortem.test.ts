import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setTestNow } from "../clock";
import type { Db } from "../db/client";
import { createTestDb } from "../db/test-db";
import { seedTwoStores } from "../../scripts/fixtures/load-db";
import { metricValue } from "../../scripts/seed/truth.js";
import type { Dataset } from "../../scripts/seed/types.js";
import type { TenantContext } from "../tenancy/context";
import { ledgerFromToolResults } from "../agent/checker";
import { addDays } from "../metrics/dates";
import { liftOf } from "../metrics/postmortem";
import { getPromoPostmortem } from "./promo-postmortem";

let db: Db;
let ds: Dataset;
let tp: Dataset;
let ctx: TenantContext;
let tCtx: TenantContext;

beforeAll(async () => {
  setTestNow("2026-11-02T12:00:00-05:00");
  db = await createTestDb();
  const seeded = await seedTwoStores(db);
  ds = seeded.fixtures.solenne.dataset;
  tp = seeded.fixtures.tidepool.dataset;
  ctx = seeded.ctxs.solenne;
  tCtx = seeded.ctxs.tidepool;
}, 240_000);

afterAll(() => setTestNow(null));

const run = (input: Record<string, unknown>, c: TenantContext = ctx) => getPromoPostmortem(c, input as never, { db });
const truth = (d: Dataset, metric: "orders" | "net_sales" | "discounts", range: { from: string; to: string }, filter: Record<string, string> = {}) => metricValue(d, metric, filter, range);

describe("liftOf, by hand", () => {
  // 28 baseline days at 10 orders and $1,000.00 a day; a 4-day window; 28 days after.
  const base = { baselineDays: 28, baseline: { orders: 280, netSalesCents: 2_800_000 }, windowDays: 4 };

  it("works out expected, extra, the dip and the net lift", () => {
    const l = liftOf({ ...base, during: { orders: 200, netSalesCents: 1_500_000 }, afterDays: 28, after: { orders: 200, netSalesCents: 2_000_000 } });
    expect(l.ordersPerDay).toBe(10);
    expect(l.netSalesPerDayCents).toBe(100_000);
    expect(l.expected).toEqual({ orders: 40, netSalesCents: 400_000 });
    expect(l.extra).toEqual({ orders: 160, netSalesCents: 1_100_000, pctOfExpected: 2.75, ordersPctOfExpected: 4 });
    expect(l.afterExpected).toEqual({ orders: 280, netSalesCents: 2_800_000 });
    expect(l.pulledForward).toEqual({ orders: 80, netSalesCents: 800_000 });
    expect(l.netLift).toEqual({ orders: 80, netSalesCents: 300_000 });
  });

  it("never reports a negative pull-forward, and lets the net lift go negative", () => {
    const up = liftOf({ ...base, during: { orders: 30, netSalesCents: 300_000 }, afterDays: 28, after: { orders: 400, netSalesCents: 4_000_000 } });
    expect(up.pulledForward).toEqual({ orders: 0, netSalesCents: 0 });
    expect(up.extra.orders).toBe(-10);
    expect(up.netLift).toEqual({ orders: -10, netSalesCents: -100_000 });
  });

  it("expects nothing after the window when none of the after days are in the data, and has no share of an empty expectation", () => {
    const l = liftOf({ baselineDays: 14, baseline: { orders: 0, netSalesCents: 0 }, windowDays: 3, during: { orders: 5, netSalesCents: 50_000 }, afterDays: 0, after: { orders: 0, netSalesCents: 0 } });
    expect(l.afterExpected).toEqual({ orders: 0, netSalesCents: 0 });
    expect(l.pulledForward).toEqual({ orders: 0, netSalesCents: 0 });
    expect(l.extra.pctOfExpected).toBeNull();
    expect(l.extra.ordersPctOfExpected).toBeNull();
  });
});

describe("the maths on real orders", () => {
  const window = { from: "2026-03-02", to: "2026-03-08" };
  const baseline = { from: "2026-02-02", to: "2026-03-01" };
  const after = { from: "2026-03-09", to: "2026-04-05" };

  it("takes the baseline, the window and the days after from the orders, and the parts add up", async () => {
    const res = await run(window);
    const d = res.data;
    const bOrders = truth(ds, "orders", baseline);
    const bNet = truth(ds, "net_sales", baseline);
    expect(d.window).toEqual({ ...window, days: 7 });
    expect(d.during).toEqual({ orders: truth(ds, "orders", window), netSalesCents: truth(ds, "net_sales", window) });
    expect(d.baseline).toEqual({ ...baseline, days: 28, orders: bOrders, netSalesCents: bNet, ordersPerDay: Math.round((bOrders / 28) * 100) / 100, netSalesPerDayCents: Math.round(bNet / 28) });
    expect(d.expected).toEqual({ orders: Math.round((bOrders * 7) / 28), netSalesCents: Math.round((bNet * 7) / 28) });
    expect(d.extra.orders).toBe(d.during.orders - d.expected.orders);
    expect(d.extra.netSalesCents).toBe(d.during.netSalesCents - d.expected.netSalesCents);
    expect(d.extra.pctOfExpected).toBeCloseTo(d.extra.netSalesCents / d.expected.netSalesCents, 10);
    expect(d.extra.ordersPctOfExpected).toBeCloseTo(d.extra.orders / d.expected.orders, 10);

    const aOrders = truth(ds, "orders", after);
    const aNet = truth(ds, "net_sales", after);
    expect(d.after).toMatchObject({ ...after, daysObserved: 28, fullyObserved: true, orders: aOrders, netSalesCents: aNet, expectedOrders: Math.round((bOrders * 28) / 28), expectedNetSalesCents: Math.round((bNet * 28) / 28) });
    expect(d.after.pulledForwardOrders).toBe(Math.max(0, d.after.expectedOrders - aOrders));
    expect(d.after.pulledForwardNetSalesCents).toBe(Math.max(0, d.after.expectedNetSalesCents - aNet));
    expect(d.netLift.orders).toBe(d.extra.orders - d.after.pulledForwardOrders);
    expect(d.netLift.netSalesCents).toBe(d.extra.netSalesCents - d.after.pulledForwardNetSalesCents);
    expect(d.codeOrders).toBeUndefined();
    expect(d.caveats).toBeUndefined();
    expect(res.range).toEqual(window);
    expect(res.queryId).toMatch(/^q_[0-9a-f]{12}$/);
  });

  it("uses the baseline length it is given: 14 days before and 14 after", async () => {
    const d = (await run({ ...window, baselineDays: 14 })).data;
    const b = { from: addDays(window.from, -14), to: addDays(window.from, -1) };
    expect(d.baseline).toMatchObject({ ...b, days: 14, orders: truth(ds, "orders", b) });
    expect(d.after).toMatchObject({ from: "2026-03-09", to: "2026-03-22", daysObserved: 14, fullyObserved: true });
    expect(d.expected.orders).toBe(Math.round((truth(ds, "orders", b) * 7) / 14));
  });

  it("agrees with query_metric and carries the definitions the verdict needs", async () => {
    const res = await run(window);
    expect(Object.keys(res.definitions)).toEqual(expect.arrayContaining(["baseline", "extra", "pulledForward", "netLift", "cohorts", "repeat_rate"]));
    expect(res.definitions.baseline).toMatch(/seasonal|price change/);
    expect(res.definitions).not.toHaveProperty("codeOrders");
    expect(res.asOf).toEqual(expect.any(String));
  });
});

describe("BFCM25 (S8)", () => {
  const window = { from: "2025-11-28", to: "2025-12-01" };

  it("finds the window from the code alone, and counts the orders that used it", async () => {
    const d = (await run({ code: "BFCM25" })).data;
    const used = ds.orders.filter((o) => o.discountCode === "BFCM25").map((o) => o.processedAt.slice(0, 10)).sort();
    expect(used.length).toBeGreaterThan(0);
    expect(d.code).toBe("BFCM25");
    expect(d.window).toEqual({ ...window, days: 4 });
    expect(d.codeOrders).toEqual({
      orders: truth(ds, "orders", window, { discount_code: "BFCM25" }),
      netSalesCents: truth(ds, "net_sales", window, { discount_code: "BFCM25" }),
      discountCents: truth(ds, "discounts", window, { discount_code: "BFCM25" }),
    });
    expect(d.codeOrders!.discountCents).toBeGreaterThan(0);
    expect(d.during.orders).toBe(truth(ds, "orders", window));
  });

  it("sold far more than the baseline and the dip afterwards is counted from the days after", async () => {
    const d = (await run({ code: "BFCM25" })).data;
    expect(d.extra.orders).toBeGreaterThan(0);
    expect(d.extra.ordersPctOfExpected!).toBeGreaterThan(2); // about 5x the daily orders
    expect(d.after.from).toBe("2025-12-02");
    expect(d.after.daysObserved).toBe(28);
    expect(d.netLift.orders).toBe(d.extra.orders - d.after.pulledForwardOrders);
    expect(d.netLift.netSalesCents).toBe(d.extra.netSalesCents - d.after.pulledForwardNetSalesCents);
  });

  it("its 180-day repeat rate equals the truth value and is below the comparison cohort's", async () => {
    const d = (await run({ code: "BFCM25", repeatWindowDays: 180, compareFrom: "2025-09-01", compareTo: "2026-04-30" })).data;
    const promo = d.customers.promoCohort;
    const comp = d.customers.comparison;
    expect(d.customers.repeatWindowDays).toBe(180);
    expect(promo.firstOrderCode).toBe("BFCM25");
    expect(promo.range).toEqual(window);
    expect(promo.repeatRate!).toBeCloseTo(metricValue(ds, "repeat_rate", { window_days: "180", first_order_code: "BFCM25" }, window), 6);
    expect(comp.excludedCode).toBe("BFCM25");
    expect(comp.range).toEqual({ from: "2025-09-01", to: "2026-04-30" });
    expect(comp.repeatRate!).toBeCloseTo(metricValue(ds, "repeat_rate", { window_days: "180", exclude_first_order_code: "BFCM25" }, comp.range), 6);
    expect(promo.repeatRate!).toBeLessThan(comp.repeatRate!);
    expect(d.customers.repeatRateGap).toBeCloseTo(promo.repeatRate! - comp.repeatRate!, 10);
    expect(d.customers.repeatRateGap!).toBeLessThan(0);
    expect(promo.customers + promo.notYetObserved).toBe(promo.cohortCustomers);
    expect(promo.repeaters).toBeLessThanOrEqual(promo.customers);
  });
});

describe("VIPGLOW25 (S6)", () => {
  const leak = { from: "2026-08-04", to: "2026-08-31" };

  it("the leak's first-time buyers repeat less than the customers before it, on the 30-day rate", async () => {
    const d = (await run({ code: "VIPGLOW25", ...leak, repeatWindowDays: 30 })).data;
    const promo = d.customers.promoCohort;
    const comp = d.customers.comparison;
    expect(d.window).toEqual({ ...leak, days: 28 });
    expect(promo.repeatRate!).toBeCloseTo(metricValue(ds, "repeat_rate", { window_days: "30", first_order_code: "VIPGLOW25" }, leak), 6);
    expect(comp.range).toEqual({ from: "2026-07-07", to: "2026-08-03" }); // the baseline range, by default
    expect(comp.repeatRate!).toBeCloseTo(metricValue(ds, "repeat_rate", { window_days: "30", exclude_first_order_code: "VIPGLOW25" }, comp.range), 6);
    expect(promo.repeatRate!).toBeLessThan(comp.repeatRate!);
    expect(d.customers.repeatRateGap!).toBeLessThan(0);
    expect(d.codeOrders!.orders).toBe(truth(ds, "orders", leak, { discount_code: "VIPGLOW25" }));
    expect(d.codeOrders!.discountCents).toBe(truth(ds, "discounts", leak, { discount_code: "VIPGLOW25" }));
  });

  it("with the code alone, the window runs from its first to its last day of use, which for a VIP code outlasts the leak", async () => {
    const days = ds.orders.filter((o) => o.discountCode === "VIPGLOW25").map((o) => o.processedAt.slice(0, 10)).sort(); // processedAt carries the store's offset
    const d = (await run({ code: "VIPGLOW25" })).data;
    expect(d.window.from).toBe(days[0]);
    expect(d.window.to).toBe(days.at(-1));
    expect(d.window.to > leak.to).toBe(true);
    expect(d.caveats!.join(" ")).toMatch(/much longer than the 28-day baseline/);
  });
});

describe("the edges of the data", () => {
  it("a window that ends on the last day of data has no days after it to look at", async () => {
    const res = await run({ from: "2026-10-25", to: "2026-10-31" });
    const d = res.data;
    expect(d.after).toMatchObject({ daysObserved: 0, fullyObserved: false, orders: 0, netSalesCents: 0, expectedOrders: 0, expectedNetSalesCents: 0, pulledForwardOrders: 0, pulledForwardNetSalesCents: 0 });
    expect(d.netLift).toEqual({ orders: d.extra.orders, netSalesCents: d.extra.netSalesCents });
    expect(d.caveats!.join(" ")).toMatch(/days after the window/);
  });

  it("a window with some days after it, but not all, says so", async () => {
    const d = (await run({ from: "2026-10-10", to: "2026-10-20" })).data;
    expect(d.after).toMatchObject({ from: "2026-10-21", to: "2026-10-31", daysObserved: 11, fullyObserved: false });
    expect(d.after.expectedOrders).toBe(Math.round((d.baseline.orders * 11) / d.baseline.days));
    expect(d.caveats!.join(" ")).toMatch(/Only 11 days of the 28 days after the window/);
  });

  it("cuts a window that runs past the data to the last day", async () => {
    const res = await run({ from: "2026-10-25", to: "2026-11-15" });
    expect(res.data.window).toEqual({ from: "2026-10-25", to: "2026-10-31", days: 7 });
    expect(res.range).toEqual({ from: "2026-10-25", to: "2026-10-31" });
    expect(res.data.caveats!.join(" ")).toMatch(/runs past the last day of data/);
  });

  it("uses fewer baseline days when the data starts inside them, and says so", async () => {
    const d = (await run({ from: "2025-09-10", to: "2025-09-12" })).data;
    expect(d.baseline).toMatchObject({ from: "2025-09-01", to: "2025-09-09", days: 9 });
    expect(d.expected.orders).toBe(Math.round((d.baseline.orders * 3) / 9));
    expect(d.caveats!.join(" ")).toMatch(/Only 9 days of the 28-day baseline/);
  });

  it("has nothing to compare a window at the very start of the data with", async () => {
    await expect(run({ from: "2025-09-01", to: "2025-09-07" })).rejects.toMatchObject({ code: "NO_DATA", message: expect.stringMatching(/no days before the window to use as a baseline/) });
  });

  it("answers NO_DATA for a window wholly outside the data", async () => {
    await expect(run({ from: "2024-01-01", to: "2024-01-31" })).rejects.toMatchObject({ code: "NO_DATA" });
    await expect(run({ from: "2027-01-01", to: "2027-01-31" })).rejects.toMatchObject({ code: "NO_DATA" });
  });

  it("flags a cohort with nobody old enough to count yet", async () => {
    const d = (await run({ from: "2026-10-20", to: "2026-10-25", repeatWindowDays: 180 })).data;
    expect(d.customers.promoCohort.repeatRate).toBeNull();
    expect(d.customers.promoCohort.cohortCustomers).toBeGreaterThan(0);
    expect(d.customers.promoCohort.notYetObserved).toBe(d.customers.promoCohort.cohortCustomers);
    expect(d.customers.repeatRateGap).toBeNull();
    expect(d.caveats!.join(" ")).toMatch(/old enough yet/);
  });
});

describe("validation", () => {
  it("rejects a key it doesn't know", async () => {
    for (const key of ["tenantId", "shopDomain", "orgId", "shop"]) await expect(run({ code: "BFCM25", [key]: "other" }), key).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("needs a code, or both from and to", async () => {
    await expect(run({})).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(run({ baselineDays: 14 })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(run({ from: "2026-03-02" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(run({ code: "BFCM25", to: "2025-12-01" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("rejects from after to, a bad date, and a baseline or repeat window that isn't offered", async () => {
    await expect(run({ from: "2026-03-08", to: "2026-03-02" })).rejects.toMatchObject({ code: "INVALID_INPUT", message: expect.stringMatching(/is after to/) });
    await expect(run({ from: "03/02/2026", to: "2026-03-08" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(run({ code: "BFCM25", baselineDays: 30 })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(run({ code: "BFCM25", repeatWindowDays: 90 })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(run({ code: "" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("needs both comparison dates, in order", async () => {
    await expect(run({ code: "BFCM25", compareFrom: "2025-09-01" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(run({ code: "BFCM25", compareTo: "2025-09-30" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(run({ code: "BFCM25", compareFrom: "2025-10-01", compareTo: "2025-09-01" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("answers NO_DATA for a code that was never used, naming it", async () => {
    await expect(run({ code: "NOSUCHCODE" })).rejects.toMatchObject({ code: "NO_DATA", message: expect.stringContaining("NOSUCHCODE") });
    await expect(run({ code: "bfcm25" })).rejects.toMatchObject({ code: "NO_DATA" }); // codes match exactly, as in query_metric
  });

  it("answers a code that exists but wasn't used inside the window with zero orders and a caveat", async () => {
    const d = (await run({ code: "BFCM25", from: "2026-03-02", to: "2026-03-08" })).data;
    expect(d.codeOrders).toEqual({ orders: 0, netSalesCents: 0, discountCents: 0 });
    expect(d.customers.promoCohort.cohortCustomers).toBe(0);
    expect(d.customers.promoCohort.repeatRate).toBeNull();
    expect(d.caveats!.join(" ")).toMatch(/No order used BFCM25 inside this window/);
  });

  it("refuses a store that isn't connected", async () => {
    await expect(run({ code: "BFCM25" }, { ...ctx, shop: { ...ctx.shop!, status: "disconnected" } })).rejects.toMatchObject({ code: "STORE_DISCONNECTED" });
  });
});

describe("tenant isolation", () => {
  it("Tidepool never sees a code that only Solenne has used", async () => {
    const onlySolenne = ds.discounts.map((d) => d.code).filter((c) => !tp.discounts.some((t) => t.code === c));
    expect(onlySolenne).toContain("VIPGLOW25");
    for (const code of onlySolenne) await expect(run({ code }, tCtx), code).rejects.toMatchObject({ code: "NO_DATA" });
    await expect(run({ code: "VIPGLOW25", from: "2026-08-04", to: "2026-08-31" }, tCtx)).rejects.toMatchObject({ code: "NO_DATA" });
    expect((await run({ code: "VIPGLOW25" })).data.codeOrders!.orders).toBeGreaterThan(0);
  });

  it("a code both stores use is read from the caller's own orders only", async () => {
    const window = { from: "2025-11-28", to: "2025-12-01" };
    const t = (await run({ code: "BFCM25" }, tCtx)).data;
    const s = (await run({ code: "BFCM25" })).data;
    expect(t.during.orders).toBe(truth(tp, "orders", window));
    expect(t.codeOrders!.orders).toBe(truth(tp, "orders", window, { discount_code: "BFCM25" }));
    expect(s.during.orders).toBe(truth(ds, "orders", window));
    expect(t.during.orders).not.toBe(s.during.orders);
  });
});

describe("the number checker", () => {
  it("reads the shares and the gap as percentages and the cents as dollars", async () => {
    const res = await run({ code: "BFCM25", repeatWindowDays: 180 });
    const entries = ledgerFromToolResults([res]).entries;
    const at = (path: string) => entries.find((e) => e.path === path)!;
    expect(at("data.extra.pctOfExpected")).toMatchObject({ unit: "rate", value: res.data.extra.pctOfExpected! * 100 });
    expect(at("data.extra.ordersPctOfExpected")).toMatchObject({ unit: "rate" });
    expect(at("data.customers.repeatRateGap")).toMatchObject({ unit: "rate", value: res.data.customers.repeatRateGap! * 100 });
    expect(at("data.netLift.netSalesCents")).toMatchObject({ unit: "money", value: res.data.netLift.netSalesCents / 100 });
    expect(at("data.baseline.ordersPerDay")).toMatchObject({ unit: "count" });
  });
});
