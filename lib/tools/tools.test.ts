import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setTestNow } from "../clock";
import type { Db } from "../db/client";
import { createTestDb } from "../db/test-db";
import { CORE_METRIC_IDS, METRICS } from "../metrics/registry";
import { queryMetric } from "../metrics/query";
import { pseudonymFor } from "../sync/map";
import type { TenantContext } from "../tenancy/context";
import { seedTwoStores, shopifyId } from "../../scripts/fixtures/load-db";
import { metricValue } from "../../scripts/seed/truth.js";
import type { Dataset } from "../../scripts/seed/types.js";
import { addDays } from "../metrics/dates";
import { getCustomers } from "./customers";
import { describeMetrics } from "./describe";
import { getInventory } from "./inventory";
import { getOrders } from "./orders";
import { searchProducts } from "./products";

let db: Db;
let ds: Dataset;
let ctx: TenantContext;
const FULL = { from: "2025-09-01", to: "2026-10-31" };

beforeAll(async () => {
  setTestNow("2026-11-02T12:00:00-05:00"); // two days after the data ends, so "today" is the day after the newest order
  db = await createTestDb();
  const seeded = await seedTwoStores(db);
  ds = seeded.fixtures.solenne.dataset;
  ctx = seeded.ctxs.solenne;
}, 240_000);

afterAll(() => setTestNow(null));

const newestDay = () => ds.orders[ds.orders.length - 1]!.processedAt.slice(0, 10);
const today = () => addDays(newestDay(), 1); // the data is stale, so "today" is the day after its newest order

describe("getOrders", () => {
  it("returns the 50 newest orders of the full window and says how many there are in all", async () => {
    const res = await getOrders(ctx, FULL, { db });
    expect(res.data).toHaveLength(50);
    expect(res.truncated).toEqual({ shown: 50, total: ds.orders.length });
    expect(res.range).toEqual(FULL);
    const dates = res.data.map((o) => o.date);
    expect(dates[0]).toBe(newestDay());
    expect(dates).toEqual([...dates].sort().reverse());
  });

  it("filters by discount code, and the count agrees with the metric", async () => {
    const code = "WELCOME10";
    const res = await getOrders(ctx, { ...FULL, discountCodes: [code], limit: 200 }, { db });
    const metric = await queryMetric(ctx, { metrics: ["orders"], ...FULL, filters: { discountCodes: [code] } }, { db });
    expect(res.truncated?.total ?? res.data.length).toBe(metric.data[0]!.values.orders);
    expect(res.data.every((o) => o.discountCode === code)).toBe(true);
  });

  it("filters to first orders of a customer, and the count agrees with new_customer_orders", async () => {
    const range = { from: "2026-05-01", to: "2026-05-31" };
    const res = await getOrders(ctx, { ...range, customerType: "new", limit: 200 }, { db });
    expect(res.truncated?.total ?? res.data.length).toBe(metricValue(ds, "new_customer_orders", {}, range));
  });

  it("finds only the orders that have a refund", async () => {
    const refunded = new Set(ds.refunds.map((r) => r.orderGenId));
    const res = await getOrders(ctx, { ...FULL, hasRefund: true, limit: 200 }, { db });
    expect(res.data).toHaveLength(refunded.size);
    expect(res.data.every((o) => o.refundedCents > 0)).toBe(true);
  });

  it("adds up: gross minus discounts minus refunds is the net on every row", async () => {
    const res = await getOrders(ctx, { ...FULL, limit: 200 }, { db });
    for (const o of res.data) expect(o.grossCents - o.discountCents - o.refundedCents).toBe(o.netCents);
  });

  it("returns one order's lines and refunds when asked for it by id", async () => {
    const refund = ds.refunds[0]!;
    const order = ds.orders.find((o) => o.genId === refund.orderGenId)!;
    const res = await getOrders(ctx, { orderIds: [shopifyId.order(order.genId)] }, { db });
    expect(res.data).toHaveLength(1);
    const row = res.data[0]!;
    expect(row.detail!.lines).toHaveLength(order.lines.length);
    expect(row.detail!.refunds.length).toBeGreaterThan(0);
    expect(row.refundedCents).toBe(row.detail!.refunds.reduce((s, r) => s + r.amountCents, 0));
    expect(row.units).toBe(order.lines.reduce((s, l) => s + l.qty, 0));
  });

  it("returns an order's note only when asked, for one order, and only under `untrusted`", async () => {
    const order = ds.orders.find((o) => o.note)!;
    const id = shopifyId.order(order.genId);
    const without = await getOrders(ctx, { orderIds: [id] }, { db });
    expect(without.data[0]!.untrusted).not.toHaveProperty("note");
    const withNote = await getOrders(ctx, { orderIds: [id], includeNote: true }, { db });
    expect(withNote.data[0]!.untrusted.note).toBe(order.note);
    expect(JSON.stringify({ ...withNote.data[0]!, untrusted: undefined })).not.toContain(order.note!);
    const list = await getOrders(ctx, { ...FULL, limit: 200 }, { db });
    expect(list.data.every((o) => !("note" in o.untrusted))).toBe(true);
  });

  it("looks an order up by id even without dates", async () => {
    const res = await getOrders(ctx, { orderIds: [shopifyId.order(ds.orders[0]!.genId)] }, { db });
    expect(res.data.map((o) => o.id)).toEqual([shopifyId.order(ds.orders[0]!.genId)]);
  });
});

describe("searchProducts", () => {
  it("finds products by part of the name, ignoring case", async () => {
    const expected = ds.products.filter((p) => /serum/i.test(p.title)).map((p) => shopifyId.product(p.genId)).sort();
    expect(expected.length).toBeGreaterThan(0);
    const res = await searchProducts(ctx, { query: "SERUM" }, { db });
    expect(res.data.map((p) => p.id).sort()).toEqual(expected);
  });

  it("returns price, unit cost and the margin worked out, so the model doesn't", async () => {
    const p = ds.products[0]!;
    const res = await searchProducts(ctx, { productIds: [shopifyId.product(p.genId)] }, { db });
    const variants = ds.variants.filter((v) => v.productGenId === p.genId);
    expect(res.data[0]!.variants).toHaveLength(variants.length);
    for (const v of variants) {
      const row = res.data[0]!.variants.find((x) => x.id === shopifyId.variant(v.genId))!;
      expect(row).toMatchObject({ priceCents: v.price, unitCostCents: v.unitCost, marginCents: v.price - v.unitCost });
      expect(row.marginRate).toBeCloseTo((v.price - v.unitCost) / v.price, 6);
    }
    expect(res.data[0]!.priceMinCents).toBe(Math.min(...variants.map((v) => v.price)));
    expect(res.data[0]!.priceMaxCents).toBe(Math.max(...variants.map((v) => v.price)));
  });

  it("returns the whole catalogue in one page and keeps store text under `untrusted`", async () => {
    const res = await searchProducts(ctx, {}, { db });
    expect(res.data).toHaveLength(ds.products.length);
    expect(res.truncated).toBeUndefined();
    const first = res.data[0]!;
    expect(first.untrusted.title).toEqual(expect.any(String));
    expect(first).not.toHaveProperty("title");
    expect(first).not.toHaveProperty("description");
  });

  it("treats % and _ in the search as plain characters", async () => {
    const res = await searchProducts(ctx, { query: "%" }, { db });
    expect(res.data).toEqual([]);
  });
});

describe("getInventory", () => {
  const onHand = (variantGenId: string) => ds.inventory.filter((i) => i.variantGenId === variantGenId).reduce((s, i) => s + i.available, 0);

  it("works out days of cover from the last 30 days of sales", async () => {
    const res = await getInventory(ctx, { limit: 200 }, { db });
    expect(res.data).toHaveLength(ds.variants.length);
    expect(res.range).toEqual({ from: addDays(today(), -29), to: today() });
    let withCover = 0;
    for (const v of ds.variants) {
      const row = res.data.find((r) => r.variantId === shopifyId.variant(v.genId))!;
      const sold = metricValue(ds, "units", { variant: v.genId }, res.range);
      expect(row.available).toBe(onHand(v.genId));
      expect(row.unitsSold).toBe(sold);
      if (sold === 0) expect(row.daysOfCover).toBeNull();
      else {
        withCover++;
        expect(row.dailyRate).toBeCloseTo(sold / 30, 6);
        expect(row.daysOfCover).toBeCloseTo(onHand(v.genId) / (sold / 30), 6);
      }
    }
    expect(withCover).toBeGreaterThan(0);
  });

  it("lists the variants that will run out first, and puts the ones with no sales last", async () => {
    const res = await getInventory(ctx, { limit: 200 }, { db });
    const covers = res.data.map((r) => r.daysOfCover);
    const numeric = covers.filter((c): c is number => c !== null);
    expect(numeric).toEqual([...numeric].sort((a, b) => a - b));
    expect(covers.indexOf(null)).toBeGreaterThanOrEqual(numeric.length === covers.length ? covers.length : numeric.length);
  });

  it("keeps only variants with at most the given days of cover", async () => {
    const res = await getInventory(ctx, { maxDaysOfCover: 20, limit: 200 }, { db });
    expect(res.data.length).toBeGreaterThan(0);
    expect(res.data.every((r) => r.daysOfCover !== null && r.daysOfCover <= 20)).toBe(true);
  });

  it("shows stock per location and keeps store text under `untrusted`", async () => {
    const v = ds.variants[0]!;
    const res = await getInventory(ctx, { variantIds: [shopifyId.variant(v.genId)] }, { db });
    const row = res.data[0]!;
    expect(row.locations.reduce((s, l) => s + l.available, 0)).toBe(row.available);
    expect(row.untrusted.product).toEqual(expect.any(String));
  });
});

describe("getCustomers", () => {
  const range = { from: "2026-05-01", to: "2026-05-31" };
  const pseudo = (genId: string) => pseudonymFor(ctx.tenantId, shopifyId.customer(genId));
  const firstDate = new Map<string, string>();
  const inRange = new Map<string, { orders: number; spend: number; last: string }>();

  beforeAll(() => {
    for (const o of ds.orders) {
      const d = o.processedAt.slice(0, 10);
      if (!firstDate.has(o.customerGenId)) firstDate.set(o.customerGenId, d);
      if (d < range.from || d > range.to) continue;
      const gross = o.lines.reduce((s, l) => s + l.qty * l.unitPrice, 0);
      const cur = inRange.get(o.customerGenId) ?? { orders: 0, spend: 0, last: "" };
      inRange.set(o.customerGenId, { orders: cur.orders + 1, spend: cur.spend + gross - o.discountCents, last: d > cur.last ? d : cur.last });
    }
  });

  it("counts the customers who ordered, split into new and returning (first order before the period)", async () => {
    const res = await getCustomers(ctx, { view: "summary", ...range }, { db });
    const active = [...inRange.keys()];
    const fresh = active.filter((c) => firstDate.get(c)! >= range.from);
    expect(res.data).toEqual([expect.objectContaining({ activeCustomers: active.length, newCustomers: fresh.length, returningCustomers: active.length - fresh.length })]);
    expect(res.data[0]).toMatchObject({ newCustomers: metricValue(ds, "new_customer_orders", {}, range) });
  });

  it("lists the top customers by spend, by pseudonymous id only", async () => {
    const res = await getCustomers(ctx, { view: "list", ...range, rankBy: "spend", limit: 5 }, { db });
    const expected = [...inRange.entries()].sort((a, b) => b[1].spend - a[1].spend || pseudo(a[0]).localeCompare(pseudo(b[0]))).slice(0, 5);
    expect(res.data.map((c) => ({ id: c.customerId, spend: c.spendCents }))).toEqual(expected.map(([g, v]) => ({ id: pseudo(g), spend: v.spend })));
    expect(res.data.every((c) => /^CUST_[0-9a-f]{16}$/.test(c.customerId))).toBe(true);
    expect(res.data[0]).toMatchObject({ orders: expected[0]![1].orders, lastOrderDate: expected[0]![1].last, firstOrderDate: firstDate.get(expected[0]![0]) });
    expect(JSON.stringify(res.data)).not.toMatch(/@|gid:/);
  });

  it("looks up named customers", async () => {
    const [g] = [...inRange.keys()];
    const res = await getCustomers(ctx, { view: "list", ...range, customerIds: [pseudo(g!)] }, { db });
    expect(res.data.map((c) => c.customerId)).toEqual([pseudo(g!)]);
  });

  it("keeps customers with at least a number of orders", async () => {
    const res = await getCustomers(ctx, { view: "list", from: FULL.from, to: FULL.to, minOrders: 5, limit: 200 }, { db });
    expect(res.data.length).toBeGreaterThan(0);
    expect(res.data.every((c) => c.orders >= 5)).toBe(true);
  });
});

describe("describeMetrics", () => {
  it("describes all 11 metrics from the registry, with the units, groupings and periods the tools accept", async () => {
    const res = await describeMetrics(ctx, {}, { db });
    expect(res.data.metrics.map((m) => m.id)).toEqual([...CORE_METRIC_IDS]);
    for (const m of res.data.metrics) expect(m.definition).toBe(METRICS[m.id].definition);
    expect(res.data.groupBy).toContain("channel");
    expect(res.data.periods).toContain("last_30_days");
    expect(res.data.units).toMatch(/cents/);
  });

  it("describes just the metrics asked for", async () => {
    const res = await describeMetrics(ctx, { metrics: ["aov"] }, { db });
    expect(res.data.metrics.map((m) => m.id)).toEqual(["aov"]);
    expect(Object.keys(res.definitions)).toEqual(["aov"]);
  });
});
