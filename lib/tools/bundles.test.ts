import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setTestNow } from "../clock";
import type { Db } from "../db/client";
import { createTestDb } from "../db/test-db";
import { orderLines, orders, products, tenants } from "../db/schema";
import { seedTwoStores, shopifyId } from "../../scripts/fixtures/load-db";
import type { Dataset } from "../../scripts/seed/types.js";
import type { TenantContext } from "../tenancy/context";
import { ledgerFromToolResults } from "../agent/checker";
import { pairStatsOf } from "../metrics/merchandising";
import { getBundleCandidates } from "./bundles";

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

const run = (input: Record<string, unknown>, c: TenantContext = ctx) => getBundleCandidates(c, input as never, { db });

// The expected pairs, worked out from the generated dataset and nothing else: the distinct products of each order, then every pair.
// processedAt carries the store's offset, so its first ten characters are the store-local date.
interface Expected { a: string; b: string; together: number; ordersA: number; ordersB: number; orders: number; withTwo: number; titles: [string, string] }
function expectedPairs(d: Dataset, range?: { from: string; to: string }): { orders: number; withTwo: number; pairs: Expected[] } {
  const productOf = new Map(d.variants.map((v) => [v.genId, shopifyId.product(v.productGenId)]));
  const titleOf = new Map(d.products.map((p) => [shopifyId.product(p.genId), p.title]));
  const inRange = d.orders.filter((o) => !range || (o.processedAt.slice(0, 10) >= range.from && o.processedAt.slice(0, 10) <= range.to));
  const perProduct = new Map<string, number>();
  const together = new Map<string, number>();
  let withTwo = 0;
  for (const o of inRange) {
    const ids = [...new Set(o.lines.map((l) => productOf.get(l.variantGenId)!))].sort();
    if (ids.length >= 2) withTwo++;
    for (const id of ids) perProduct.set(id, (perProduct.get(id) ?? 0) + 1);
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) together.set(`${ids[i]}\n${ids[j]}`, (together.get(`${ids[i]}\n${ids[j]}`) ?? 0) + 1);
  }
  const pairs = [...together].map(([key, n]) => {
    const [a, b] = key.split("\n") as [string, string];
    return { a, b, together: n, ordersA: perProduct.get(a)!, ordersB: perProduct.get(b)!, orders: inRange.length, withTwo, titles: [titleOf.get(a)!, titleOf.get(b)!] as [string, string] };
  });
  return { orders: inRange.length, withTwo, pairs };
}
const liftOfExpected = (e: Expected) => (e.together / e.orders) / ((e.ordersA / e.orders) * (e.ordersB / e.orders));
const sortedByLift = (rows: Expected[]) => [...rows].sort((x, y) => liftOfExpected(y) - liftOfExpected(x) || y.together - x.together || (x.a < y.a ? -1 : x.a > y.a ? 1 : x.b < y.b ? -1 : x.b > y.b ? 1 : 0));

describe("pairStatsOf, by hand", () => {
  // 10 orders: p1 and p2 together 5 times (4 of them as a pair, once with p3), p2 and p3 twice, 2 empty orders.
  const baskets = [...Array(4).fill(["p1", "p2"]), ...Array(2).fill(["p1"]), ["p2", "p3"], ["p1", "p2", "p3"], [], []];

  it("counts orders, orders with two or more products, and each pair", () => {
    const r = pairStatsOf(baskets, { minOrders: 2 });
    expect(r.ordersInRange).toBe(10);
    expect(r.ordersWithTwoOrMoreProducts).toBe(6);
    expect(r.pairs).toHaveLength(2); // p1-p3 appeared once only
    const p23 = r.pairs[0]!;
    expect(p23).toEqual({ productAId: "p2", productBId: "p3", ordersTogether: 2, ordersA: 6, ordersB: 2, support: 0.2, confidenceAtoB: 2 / 6, confidenceBtoA: 1, lift: 20 / 12 });
    const p12 = r.pairs[1]!;
    expect(p12).toMatchObject({ productAId: "p1", productBId: "p2", ordersTogether: 5, ordersA: 7, ordersB: 6, support: 0.5, confidenceAtoB: 5 / 7, confidenceBtoA: 5 / 6 });
    expect(p12.lift).toBeCloseTo(50 / 42, 12);
  });

  it("ignores repeats of one product in an order and puts the smaller id first", () => {
    const r = pairStatsOf([["b", "a", "a", "b"], ["a", "b"], ["b", "a"]], { minOrders: 2 });
    expect(r.pairs).toEqual([{ productAId: "a", productBId: "b", ordersTogether: 3, ordersA: 3, ordersB: 3, support: 1, confidenceAtoB: 1, confidenceBtoA: 1, lift: 1 }]);
  });

  it("sorts by lift, then orders together, then ids", () => {
    // b-c and a-d have the same lift and the same count: the ids decide. e-f has a lower lift.
    const r = pairStatsOf([["b", "c"], ["b", "c"], ["a", "d"], ["a", "d"], ["e", "f"], ["e", "f"], ["e"], ["f"], ["x"], ["y"], ["z"], ["w"]], { minOrders: 2 });
    expect(r.pairs.map((p) => `${p.productAId}-${p.productBId}`)).toEqual(["a-d", "b-c", "e-f"]);
    expect(r.pairs[0]!.lift).toBe(r.pairs[1]!.lift);
    expect(r.pairs[1]!.lift).toBeGreaterThan(r.pairs[2]!.lift);
  });

  it("keeps only pairs with a product in productIds, and keeps the real counts for them", () => {
    const r = pairStatsOf(baskets, { minOrders: 2, productIds: ["p3"] });
    expect(r.pairs.map((p) => `${p.productAId}-${p.productBId}`)).toEqual(["p2-p3"]);
    expect(r.pairs[0]!.ordersTogether).toBe(2);
    expect(r.ordersInRange).toBe(10);
  });

  it("returns nothing, without dividing by zero, for no orders or no pairs", () => {
    expect(pairStatsOf([], { minOrders: 2 })).toEqual({ ordersInRange: 0, ordersWithTwoOrMoreProducts: 0, pairs: [] });
    expect(pairStatsOf([["a"], ["b"]], { minOrders: 2 }).pairs).toEqual([]);
  });
});

describe("the pairs on the Solenne orders", () => {
  it("are exactly the ones counted from the dataset, in lift order, with every figure worked out", async () => {
    const res = await run({});
    const want = expectedPairs(ds);
    const wantRows = sortedByLift(want.pairs.filter((p) => p.together >= 5));
    expect(wantRows.length).toBeGreaterThan(10);
    expect(res.data.ordersInRange).toBe(ds.orders.length);
    expect(res.data.ordersWithTwoOrMoreProducts).toBe(want.withTwo);
    expect(res.data.pairs).toHaveLength(wantRows.length);
    res.data.pairs.forEach((row, i) => {
      const e = wantRows[i]!;
      expect(row.productAId, `row ${i}`).toBe(e.a);
      expect(row.productBId).toBe(e.b);
      expect(row.productAId < row.productBId).toBe(true);
      expect(row.ordersTogether).toBe(e.together);
      expect(row.ordersA).toBe(e.ordersA);
      expect(row.ordersB).toBe(e.ordersB);
      expect(row.support).toBeCloseTo(e.together / e.orders, 12);
      expect(row.confidenceAtoB).toBeCloseTo(e.together / e.ordersA, 12);
      expect(row.confidenceBtoA).toBeCloseTo(e.together / e.ordersB, 12);
      expect(row.lift).toBeCloseTo(liftOfExpected(e), 10);
      expect(row.untrusted).toEqual({ productA: e.titles[0], productB: e.titles[1] });
    });
    expect(res.truncated).toBeUndefined();
    expect(res.data.caveats).toBeUndefined();
  });

  it("covers the whole data window by default and says where the figures come from", async () => {
    const res = await run({});
    expect(res.range).toEqual({ from: "2025-09-01", to: "2026-10-31" });
    expect(res.queryId).toMatch(/^q_[0-9a-f]{12}$/);
    expect(res.asOf).toEqual(expect.any(String));
    expect(Object.keys(res.definitions)).toEqual(expect.arrayContaining(["support", "confidence", "lift", "pairs"]));
    expect(res.definitions.pairs).toMatch(/not proof/);
    expect(res.definitions.support).toMatch(/single product|one product/);
  });

  it("is the same on every call", async () => {
    const a = await run({ minOrders: 3 });
    const b = await run({ minOrders: 3 });
    expect(b).toEqual(a);
  });

  it("minOrders keeps only the pairs that appeared together at least that often", async () => {
    const want = expectedPairs(ds).pairs;
    for (const minOrders of [2, 5, 10, 15]) {
      const res = await run({ minOrders, limit: 500 });
      const wantN = want.filter((p) => p.together >= minOrders).length;
      expect(Math.min(wantN, 200), `minOrders ${minOrders}`).toBe(res.data.pairs.length);
      expect(res.data.pairs.every((p) => p.ordersTogether >= minOrders)).toBe(true);
      expect(res.truncated?.total ?? res.data.pairs.length).toBe(wantN);
    }
    expect(want.filter((p) => p.together >= 2).length).toBeGreaterThan(want.filter((p) => p.together >= 5).length);
  });

  it("returns no pairs and says so when none meets minOrders", async () => {
    const res = await run({ minOrders: 100 });
    expect(res.data.pairs).toEqual([]);
    expect(res.data.ordersInRange).toBe(ds.orders.length);
    expect(res.data.ordersWithTwoOrMoreProducts).toBeGreaterThan(0);
    expect(res.data.caveats!.join(" ")).toMatch(/no pair of products appeared together in at least 100 orders/i);
    expect(res.truncated).toBeUndefined();
  });

  it("productIds keeps only pairs that include one of them, with their real counts", async () => {
    const want = expectedPairs(ds).pairs.filter((p) => p.together >= 5);
    const hero = ds.products.find((p) => p.title === "Hero Vitamin C Serum")!;
    const heroId = shopifyId.product(hero.genId);
    const gift = shopifyId.product(ds.products.find((p) => p.title === "Gift Set Deluxe")!.genId);
    const res = await run({ productIds: [heroId] });
    const wantRows = sortedByLift(want.filter((p) => p.a === heroId || p.b === heroId));
    expect(wantRows.length).toBeGreaterThan(2);
    expect(res.data.pairs.map((p) => [p.productAId, p.productBId, p.ordersTogether])).toEqual(wantRows.map((e) => [e.a, e.b, e.together]));
    expect(res.data.pairs.every((p) => p.productAId === heroId || p.productBId === heroId)).toBe(true);
    expect(res.data.ordersInRange).toBe(ds.orders.length); // support still divides by every order

    const two = await run({ productIds: [heroId, gift] });
    expect(two.data.pairs.length).toBeGreaterThanOrEqual(res.data.pairs.length);
    expect(two.data.pairs.every((p) => [heroId, gift].some((id) => p.productAId === id || p.productBId === id))).toBe(true);
  });

  it("productIds that are in no pair give an empty list and a caveat", async () => {
    const res = await run({ productIds: ["gid://shopify/Product/999999"] });
    expect(res.data.pairs).toEqual([]);
    expect(res.data.caveats!.join(" ")).toMatch(/no pair/i);
  });

  it("limit cuts the list, keeps the top of it and says how many there were", async () => {
    const all = await run({});
    expect(all.data.pairs.length).toBeGreaterThan(5);
    const five = await run({ limit: 5 });
    expect(five.data.pairs).toHaveLength(5);
    expect(five.data.pairs).toEqual(all.data.pairs.slice(0, 5));
    expect(five.truncated).toEqual({ shown: 5, total: all.data.pairs.length });
    const one = await run({ limit: 1 });
    expect(one.data.pairs).toHaveLength(1);
    expect(one.truncated).toEqual({ shown: 1, total: all.data.pairs.length });
  });

  it("a limit of 500 returns at most 200 rows", async () => {
    const res = await run({ minOrders: 2, limit: 500 });
    expect(res.data.pairs.length).toBeLessThanOrEqual(200);
    expect(res.data.pairs.length).toBe(Math.min(200, res.truncated?.total ?? res.data.pairs.length));
  });

  it("counts only the orders in a given range", async () => {
    const range = { from: "2026-01-01", to: "2026-04-30" };
    const want = expectedPairs(ds, range);
    const res = await run({ ...range, minOrders: 2, limit: 500 });
    expect(res.range).toEqual(range);
    expect(res.data.ordersInRange).toBe(want.orders);
    expect(res.data.ordersWithTwoOrMoreProducts).toBe(want.withTwo);
    const wantRows = sortedByLift(want.pairs.filter((p) => p.together >= 2)).slice(0, 200);
    expect(res.data.pairs.map((p) => [p.productAId, p.productBId, p.ordersTogether, p.ordersA, p.ordersB])).toEqual(wantRows.map((e) => [e.a, e.b, e.together, e.ordersA, e.ordersB]));
    expect(want.orders).toBeLessThan(ds.orders.length);
  });

  it("takes a named period too", async () => {
    const res = await run({ period: "last_30_days", minOrders: 2 });
    expect(res.range).toEqual({ from: "2026-10-03", to: "2026-10-31" }); // cut to the last day of data
    expect(res.data.ordersInRange).toBe(expectedPairs(ds, { from: "2026-10-03", to: "2026-10-31" }).orders);
  });

  it("answers NO_DATA for a range wholly outside the data", async () => {
    await expect(run({ from: "2024-01-01", to: "2024-01-31" })).rejects.toMatchObject({ code: "NO_DATA" });
    await expect(run({ from: "2027-01-01", to: "2027-01-31" })).rejects.toMatchObject({ code: "NO_DATA" });
  });
});

describe("validation", () => {
  it("rejects a key it doesn't know", async () => {
    for (const key of ["tenantId", "shopDomain", "orgId", "shop"]) await expect(run({ [key]: "other" }), key).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("rejects from after to, a bad date, and only one of from and to", async () => {
    await expect(run({ from: "2026-03-08", to: "2026-03-02" })).rejects.toMatchObject({ code: "INVALID_INPUT", message: expect.stringMatching(/is after to/) });
    await expect(run({ from: "03/02/2026", to: "2026-03-08" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(run({ from: "2026-03-02" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("rejects a minOrders outside 2 to 100, a fraction, and a bad limit or product list", async () => {
    for (const minOrders of [0, 1, 101, 2.5, "5"]) await expect(run({ minOrders }), String(minOrders)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(run({ limit: 0 })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(run({ productIds: "P_001" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(run({ productIds: [""] })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("refuses a store that isn't connected", async () => {
    await expect(run({}, { ...ctx, shop: { ...ctx.shop!, status: "disconnected" } })).rejects.toMatchObject({ code: "STORE_DISCONNECTED" });
  });
});

describe("tenant isolation", () => {
  it("Tidepool's pairs are counted from Tidepool's orders only", async () => {
    const want = expectedPairs(tp);
    const res = await run({ minOrders: 2, limit: 500 }, tCtx);
    const sol = await run({ minOrders: 2, limit: 500 });
    expect(res.data.ordersInRange).toBe(tp.orders.length);
    expect(res.data.ordersInRange).not.toBe(sol.data.ordersInRange);
    expect(res.data.ordersWithTwoOrMoreProducts).toBe(want.withTwo);
    const wantRows = sortedByLift(want.pairs.filter((p) => p.together >= 2));
    expect(wantRows.length).toBeGreaterThan(0);
    expect(res.data.pairs.map((p) => [p.productAId, p.productBId, p.ordersTogether, p.ordersA, p.ordersB])).toEqual(wantRows.map((e) => [e.a, e.b, e.together, e.ordersA, e.ordersB]));
  });

  it("never shows a Solenne product to Tidepool, however it is asked", async () => {
    const tidepoolTitles = new Set(tp.products.map((p) => p.title));
    const onlySolenne = ds.products.filter((p) => !tidepoolTitles.has(p.title));
    expect(onlySolenne.length).toBeGreaterThan(0);
    const res = await run({ minOrders: 2, limit: 500 }, tCtx);
    const shown = res.data.pairs.flatMap((p) => [p.untrusted.productA, p.untrusted.productB]);
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.every((t) => tidepoolTitles.has(t))).toBe(true);
    // A product id that exists only in Solenne (a higher number than Tidepool has products) finds nothing in Tidepool.
    const high = ds.products.find((p) => Number(p.genId.slice(2)) > tp.products.length)!;
    const asked = await run({ productIds: [shopifyId.product(high.genId)], minOrders: 2 }, tCtx);
    expect(asked.data.pairs).toEqual([]);
    const solenneRes = await run({ minOrders: 2, limit: 500 });
    expect(solenneRes.data.pairs.some((p) => onlySolenne.some((s) => s.title === p.untrusted.productA || s.title === p.untrusted.productB))).toBe(true);
  });
});

describe("what the pairs mean, on hand-made orders", () => {
  // One product (A) with two variants, B and C with one each. Seven counted orders:
  //  o1 A1 B1 | o2 A2 B1 | o3 A1 A2 B1 | o4 A1 x3, B1 x2 | o5 A1 | o6 B1 C1 | o7 (no lines at all)
  // and o8 (A1 B1), which is cancelled and must not count anywhere.
  let hCtx: TenantContext;

  beforeAll(async () => {
    const [t] = await db.insert(tenants).values({ orgId: "org_bundles_by_hand", name: "By hand" }).returning();
    const tenantId = t!.id;
    hCtx = { tenantId, orgId: "org_bundles_by_hand", userId: "user_test", role: "gc_admin", shop: { domain: "by-hand.myshopify.com", timezone: "America/New_York", currency: "USD", status: "connected" } };
    await db.insert(products).values(["A", "B", "C"].map((id) => ({ tenantId, id: `prod_${id}`, title: `Product ${id}`, handle: id.toLowerCase(), status: "ACTIVE" })));
    // [variant, quantity] per line; the product is the variant's first letter.
    const lines: Record<string, [string, number][]> = {
      o1: [["A1", 1], ["B1", 1]],
      o2: [["A2", 1], ["B1", 1]],
      o3: [["A1", 1], ["A2", 1], ["B1", 1]],
      o4: [["A1", 3], ["B1", 2]],
      o5: [["A1", 1]],
      o6: [["B1", 1], ["C1", 1]],
      o7: [],
      o8: [["A1", 1], ["B1", 1]],
    };
    for (const [id, items] of Object.entries(lines)) {
      const day = `2026-05-0${id.slice(1)}`;
      await db.insert(orders).values({
        tenantId, id, name: `#${id}`, processedAt: new Date(`${day}T15:00:00Z`), localDate: day, customerId: null,
        grossCents: 1000, discountCents: 0, shippingCents: 0, channel: "web", cancelledAt: id === "o8" ? new Date(`${day}T16:00:00Z`) : null,
      });
      if (items.length > 0) {
        await db.insert(orderLines).values(items.map(([variant, qty], i) => ({ tenantId, id: `${id}_l${i}`, orderId: id, variantId: `var_${variant}`, productId: `prod_${variant[0]}`, quantity: qty, unitPriceCents: 1000, discountCents: 0 })));
      }
    }
  });

  const hand = (input: Record<string, unknown> = {}) => getBundleCandidates(hCtx, { minOrders: 2, ...input } as never, { db });

  it("collapses variants into their product, ignores quantity, leaves out cancelled orders and counts orders with no lines", async () => {
    const res = await hand();
    expect(res.data.ordersInRange).toBe(7);
    expect(res.data.ordersWithTwoOrMoreProducts).toBe(5);
    expect(res.data.pairs).toHaveLength(1); // B and C appeared together once only
    const row = res.data.pairs[0]!;
    expect(row).toMatchObject({ productAId: "prod_A", productBId: "prod_B", ordersTogether: 4, ordersA: 5, ordersB: 5 });
    expect(row.support).toBeCloseTo(4 / 7, 12);
    expect(row.confidenceAtoB).toBeCloseTo(4 / 5, 12);
    expect(row.confidenceBtoA).toBeCloseTo(4 / 5, 12);
    expect(row.lift).toBeCloseTo((4 * 7) / (5 * 5), 12);
    expect(row.untrusted).toEqual({ productA: "Product A", productB: "Product B" });
    expect(res.range).toEqual({ from: "2026-05-01", to: "2026-05-07" }); // the cancelled order's day is not in the data
  });

  it("a range that holds only the cancelled order has no data", async () => {
    await expect(hand({ from: "2026-05-08", to: "2026-05-09" })).rejects.toMatchObject({ code: "NO_DATA" });
  });

  it("says when no order has two products", async () => {
    const res = await hand({ from: "2026-05-05", to: "2026-05-05" });
    expect(res.data.ordersInRange).toBe(1);
    expect(res.data.ordersWithTwoOrMoreProducts).toBe(0);
    expect(res.data.pairs).toEqual([]);
    expect(res.data.caveats!.join(" ")).toMatch(/no order in this range has two different products/i);
  });
});

describe("the number checker", () => {
  it("reads support and confidence as percentages and lift as a plain ratio", async () => {
    const res = await run({ limit: 3 });
    const row = res.data.pairs[0]!;
    const entries = ledgerFromToolResults([res]).entries;
    const at = (path: string) => entries.find((e) => e.path === path)!;
    expect(at("data.pairs[0].support")).toMatchObject({ unit: "rate", value: row.support * 100 });
    expect(at("data.pairs[0].confidenceAtoB")).toMatchObject({ unit: "rate", value: row.confidenceAtoB * 100 });
    expect(at("data.pairs[0].confidenceBtoA")).toMatchObject({ unit: "rate", value: row.confidenceBtoA * 100 });
    expect(at("data.pairs[0].lift")).toMatchObject({ unit: "count", value: row.lift });
    expect(at("data.pairs[0].ordersTogether")).toMatchObject({ unit: "count", value: row.ordersTogether });
  });
});
