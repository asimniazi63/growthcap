import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setTestNow } from "../clock";
import type { Db } from "../db/client";
import { orderLines, orders, refundLines, refunds, tenants } from "../db/schema";
import { createTestDb } from "../db/test-db";
import { seedTwoStores, shopifyId } from "../../scripts/fixtures/load-db";
import { metricValue } from "../../scripts/seed/truth.js";
import type { Dataset } from "../../scripts/seed/types.js";
import { ledgerFromToolResults } from "../agent/checker";
import { daysBetween, addDays } from "../metrics/dates";
import { loadSegmentCustomers } from "../metrics/segments";
import { SEGMENT_IDS, SEGMENT_RULES, type SegmentCustomer } from "../segments/definitions";
import { pseudonymFor } from "../sync/map";
import type { TenantContext } from "../tenancy/context";
import { getCustomerSegments, getCustomerSegmentsTool } from "./customer-segments";

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

const run = (input: Record<string, unknown> = {}, c: TenantContext = ctx) => getCustomerSegments(c, input as never, { db });
const WIDE = { from: "2000-01-01", to: "2099-12-31" }; // every order and every refund, whenever it was made
const pseudonym = (c: TenantContext, genId: string) => pseudonymFor(c.tenantId, shopifyId.customer(genId));
const dayOf = (iso: string) => iso.slice(0, 10); // processedAt carries the store's offset

// What the dataset says about each customer, worked out without any of the code under test.
function expected(d: Dataset, c: TenantContext) {
  const refunded = new Set(d.refunds.map((r) => r.orderGenId));
  const byCustomer = new Map<string, { dates: string[]; netBeforeRefunds: number; hasRefund: boolean }>();
  for (const o of d.orders) {
    const id = pseudonym(c, o.customerGenId);
    const e = byCustomer.get(id) ?? { dates: [], netBeforeRefunds: 0, hasRefund: false };
    e.dates.push(dayOf(o.processedAt));
    e.netBeforeRefunds += o.lines.reduce((n, l) => n + l.qty * l.unitPrice, 0) - o.discountCents;
    e.hasRefund ||= refunded.has(o.genId);
    byCustomer.set(id, e);
  }
  const last = d.orders.map((o) => dayOf(o.processedAt)).sort().at(-1)!;
  return { byCustomer, last, first: d.orders.map((o) => dayOf(o.processedAt)).sort()[0]! };
}

describe("the customers, checked against the dataset", () => {
  let customers: SegmentCustomer[];
  let asOf: string;
  beforeAll(async () => {
    const loaded = await loadSegmentCustomers(db, ctx.tenantId);
    customers = loaded.customers;
    asOf = loaded.asOf;
  });

  it("has one customer per distinct buyer, as of the last day of orders", () => {
    const x = expected(ds, ctx);
    expect(asOf).toBe(x.last);
    expect(customers).toHaveLength(x.byCustomer.size);
    expect(new Set(customers.map((c) => c.customerId))).toEqual(new Set(x.byCustomer.keys()));
  });

  it("counts orders, first and last order dates, days since last and the median gap as the orders say", () => {
    const x = expected(ds, ctx);
    for (const c of customers) {
      const mine = x.byCustomer.get(c.customerId)!;
      const dates = [...mine.dates].sort();
      const gaps = dates.slice(1).map((d, i) => daysBetween(dates[i]!, d)).sort((a, b) => a - b);
      const median = gaps.length === 0 ? null : gaps.length % 2 ? gaps[gaps.length >> 1]! : (gaps[gaps.length / 2 - 1]! + gaps[gaps.length / 2]!) / 2;
      expect([c.orders, c.firstOrderDate, c.lastOrderDate, c.daysSinceLast, c.medianGapDays], c.customerId).toEqual([dates.length, dates[0], dates.at(-1), daysBetween(dates.at(-1)!, x.last), median]);
    }
  });

  it("LTV is gross less discounts for a customer with no refund, and less than that for one with a refund", () => {
    const x = expected(ds, ctx);
    let refundedCustomers = 0;
    for (const c of customers) {
      const mine = x.byCustomer.get(c.customerId)!;
      if (mine.hasRefund) {
        refundedCustomers++;
        expect(c.ltvCents, c.customerId).toBeLessThan(mine.netBeforeRefunds);
      } else expect(c.ltvCents, c.customerId).toBe(mine.netBeforeRefunds);
    }
    expect(refundedCustomers).toBeGreaterThan(0);
  });

  it("all customers' LTV adds up to the store's net sales (every order is a customer's), refunds counted against the order they came from", () => {
    // query_metric counts a refund on the day it was made, LTV on the order's customer. They agree over a window that holds every refund.
    const net = metricValue(ds, "net_sales", {}, WIDE);
    expect(customers.reduce((n, c) => n + c.ltvCents, 0)).toBe(net);
    const x = expected(ds, ctx);
    const before = [...x.byCustomer.values()].reduce((n, e) => n + e.netBeforeRefunds, 0);
    expect(before - net).toBe(metricValue(ds, "refunds", {}, WIDE));
  });

  it("customers with equal values get equal scores, whoever else is in the store", () => {
    const sameScore = (pick: (c: SegmentCustomer) => number, score: (c: SegmentCustomer) => number) => {
      const seen = new Map<number, number>();
      for (const c of customers) {
        const prior = seen.get(pick(c));
        if (prior !== undefined) expect(score(c), c.customerId).toBe(prior);
        else seen.set(pick(c), score(c));
      }
      return seen.size;
    };
    expect(sameScore((c) => c.daysSinceLast, (c) => c.r)).toBeLessThan(customers.length);
    expect(sameScore((c) => c.orders, (c) => c.f)).toBeLessThan(customers.length);
    expect(sameScore((c) => c.ltvCents, (c) => c.m)).toBeLessThanOrEqual(customers.length);
    for (const c of customers) for (const s of [c.r, c.f, c.m]) expect([1, 2, 3, 4, 5]).toContain(s);
  });

  it("a more recent, more frequent or bigger customer never scores lower than one who is less so", () => {
    const monotone = (pick: (c: SegmentCustomer) => number, score: (c: SegmentCustomer) => number) => {
      const sorted = [...customers].sort((a, b) => pick(a) - pick(b));
      for (let i = 1; i < sorted.length; i++) expect(score(sorted[i]!)).toBeGreaterThanOrEqual(score(sorted[i - 1]!));
    };
    monotone((c) => -c.daysSinceLast, (c) => c.r);
    monotone((c) => c.orders, (c) => c.f);
    monotone((c) => c.ltvCents, (c) => c.m);
  });

  it("each customer fits the words of their segment", () => {
    const R = SEGMENT_RULES;
    for (const c of customers) {
      if (c.segment === "champions") expect([c.orders >= R.champions.minOrders, c.daysSinceLast <= R.champions.maxDaysSinceLast]).toEqual([true, true]);
      if (c.segment === "at_risk") expect([c.orders >= R.atRisk.minOrders, c.daysSinceLast >= R.atRisk.minDaysSinceLast, c.daysSinceLast <= R.atRisk.maxDaysSinceLast]).toEqual([true, true, true]);
      if (c.segment === "due_to_reorder") {
        const ratio = c.daysSinceLast / Math.max(1, c.medianGapDays!);
        expect([c.orders >= R.dueToReorder.minOrders, ratio >= R.dueToReorder.minGapMultiple, ratio <= R.dueToReorder.maxGapMultiple]).toEqual([true, true, true]);
      }
      if (c.segment === "one_and_done") expect([c.orders, c.daysSinceLast >= R.oneAndDone.minDaysSinceLast]).toEqual([1, true]);
      if (c.segment === "active") expect(c.churnRisk).toBeLessThanOrEqual(1);
    }
  });
});

describe("get_customer_segments, summary", () => {
  it("reconciles: the segments' customers add up to the distinct buyers, and so do their shares and LTV", async () => {
    const res = await run();
    const d = res.data;
    const buyers = new Set(ds.orders.map((o) => o.customerGenId)).size;
    expect(d.totalCustomers).toBe(buyers);
    expect(d.segments.map((s) => s.id)).toEqual([...SEGMENT_IDS, "active"]);
    expect(d.segments.reduce((n, s) => n + s.customers, 0)).toBe(buyers);
    expect(d.segments.reduce((n, s) => n + s.shareOfCustomers, 0)).toBeCloseTo(1, 10);
    expect(d.segments.reduce((n, s) => n + s.totalLtvCents, 0)).toBe(metricValue(ds, "net_sales", {}, WIDE));
    expect(d.customers).toBeUndefined();
    expect(d.repeatCustomers).toBeLessThan(buyers);
    expect(d.repeatCustomers).toBeGreaterThan(0);
    expect(d.ordersWithoutCustomer).toBe(0);
  });

  it("Solenne has some customers in every segment, with these counts today", async () => {
    const d = (await run()).data;
    expect(Object.fromEntries(d.segments.map((s) => [s.id, s.customers]))).toEqual({ champions: 53, at_risk: 99, due_to_reorder: 16, one_and_done: 363, active: 97 });
    expect(d.caveats).toBeUndefined();
    for (const s of d.segments) {
      expect(s.title).toEqual(expect.any(String));
      expect(s.description).toEqual(expect.any(String));
      expect(s.avgLtvCents).toBe(Math.round(s.totalLtvCents / s.customers));
      expect(s.shareOfCustomers).toBeCloseTo(s.customers / d.totalCustomers, 10);
    }
  });

  it("champions are the biggest spenders and the one-and-done the smallest, and churn risk follows recency", async () => {
    const by = Object.fromEntries((await run()).data.segments.map((s) => [s.id, s]));
    expect(by.champions!.avgLtvCents).toBeGreaterThan(by.active!.avgLtvCents);
    expect(by.champions!.avgLtvCents).toBeGreaterThan(by.one_and_done!.avgLtvCents);
    expect(by.champions!.avgChurnRisk).toBeLessThan(by.at_risk!.avgChurnRisk);
    expect(by.one_and_done!.avgOrders).toBe(1);
    expect(by.champions!.avgOrders).toBeGreaterThanOrEqual(SEGMENT_RULES.champions.minOrders);
  });

  it("carries the asOf day, the rules as numbers, the typical gap and the definitions", async () => {
    const res = await run();
    expect(res.data.asOf).toBe(expected(ds, ctx).last);
    expect(res.data.rules).toEqual(SEGMENT_RULES);
    expect(res.data.typicalGapDays).toBeGreaterThan(0);
    expect(Object.keys(res.definitions)).toEqual(expect.arrayContaining(["segments", "ltv", "rfm", "churnRisk", "medianGapDays"]));
    expect(res.definitions.churnRisk).toMatch(/heuristic of how overdue.*not a prediction/);
    expect(res.definitions.ltv).toMatch(/refund/);
    expect(res.range).toEqual({ from: expected(ds, ctx).first, to: expected(ds, ctx).last });
    expect(res.queryId).toMatch(/^q_[0-9a-f]{12}$/);
    expect(res.asOf).toEqual(expect.any(String));
    expect(res.truncated).toBeUndefined();
  });

  it("gives the same answer twice, and a different query id for a different question", async () => {
    const a = await run();
    expect((await run()).queryId).toBe(a.queryId);
    expect((await run({ segment: "champions" })).queryId).not.toBe(a.queryId);
  });
});

describe("filtering, sorting and limits", () => {
  it("a segment alone gives that row only, with shares still of the whole store", async () => {
    const all = (await run()).data;
    const one = (await run({ segment: "at_risk" })).data;
    expect(one.segments).toHaveLength(1);
    expect(one.segments[0]).toEqual(all.segments.find((s) => s.id === "at_risk"));
    expect(one.totalCustomers).toBe(all.totalCustomers);
    expect(one.customers).toBeUndefined();
  });

  it("the list is only that segment's customers, all of them when they fit, with no truncation", async () => {
    const res = await run({ segment: "due_to_reorder", view: "list" });
    expect(res.data.customers).toHaveLength(16);
    expect(res.data.customers!.every((c) => c.segment === "due_to_reorder")).toBe(true);
    expect(res.truncated).toBeUndefined();
    const active = await run({ segment: "active", view: "list", limit: 200 });
    expect(active.data.customers!.every((c) => c.segment === "active")).toBe(true);
    expect(active.data.customers).toHaveLength(active.data.segments[0]!.customers);
  });

  it("lists customers by pseudonymous id and scores only: no name, email, phone or address", async () => {
    const res = await run({ view: "list", limit: 5 });
    for (const c of res.data.customers!) {
      expect(Object.keys(c).sort()).toEqual(["churnRisk", "customerId", "daysSinceLast", "f", "firstOrderDate", "lastOrderDate", "ltvCents", "m", "medianGapDays", "orders", "r", "segment"]);
      expect(c.customerId).toMatch(/^CUST_[0-9a-f]+$/);
    }
  });

  it("sorts by LTV, highest first, by default", async () => {
    const list = (await run({ view: "list", limit: 200 })).data.customers!;
    expect(list).toHaveLength(200);
    for (let i = 1; i < list.length; i++) expect(list[i - 1]!.ltvCents).toBeGreaterThanOrEqual(list[i]!.ltvCents);
    const top = (await loadSegmentCustomers(db, ctx.tenantId)).customers[0]!;
    expect(list[0]).toEqual(top);
  });

  it("sorts by churn risk, highest first, then by LTV", async () => {
    const list = (await run({ view: "list", sort: "churn_risk", limit: 200 })).data.customers!;
    expect(list[0]!.churnRisk).toBe(1);
    for (let i = 1; i < list.length; i++) {
      const [a, b] = [list[i - 1]!, list[i]!];
      expect(a.churnRisk).toBeGreaterThanOrEqual(b.churnRisk);
      if (a.churnRisk === b.churnRisk) expect(a.ltvCents).toBeGreaterThanOrEqual(b.ltvCents);
    }
  });

  it("sorts by days since the last order, longest ago first", async () => {
    const list = (await run({ view: "list", sort: "days_since_last", segment: "one_and_done", limit: 50 })).data.customers!;
    for (let i = 1; i < list.length; i++) expect(list[i - 1]!.daysSinceLast).toBeGreaterThanOrEqual(list[i]!.daysSinceLast);
    const all = (await loadSegmentCustomers(db, ctx.tenantId)).customers.filter((c) => c.segment === "one_and_done");
    expect(list[0]!.daysSinceLast).toBe(Math.max(...all.map((c) => c.daysSinceLast)));
  });

  it("lists 50 by default and says how many there were; a limit cuts it, and 200 is the most", async () => {
    const d = await run({ view: "list" });
    expect(d.data.customers).toHaveLength(50);
    expect(d.truncated).toEqual({ shown: 50, total: d.data.totalCustomers });
    const five = await run({ view: "list", limit: 5 });
    expect(five.data.customers).toHaveLength(5);
    expect(five.truncated).toEqual({ shown: 5, total: five.data.totalCustomers });
    const most = await run({ view: "list", limit: 500 });
    expect(most.data.customers).toHaveLength(200);
    expect(most.truncated).toEqual({ shown: 200, total: most.data.totalCustomers });
    // the totals still describe everyone, not the rows shown
    expect(most.data.totalCustomers).toBe(d.data.totalCustomers);
    expect(most.data.segments.reduce((n, s) => n + s.customers, 0)).toBe(d.data.totalCustomers);
  });

  it("the truncated total counts only the chosen segment", async () => {
    const res = await run({ view: "list", segment: "one_and_done", limit: 10 });
    expect(res.truncated).toEqual({ shown: 10, total: 363 });
  });
});

describe("validation", () => {
  it("rejects a key it doesn't know", async () => {
    for (const key of ["tenantId", "shopDomain", "orgId", "shop", "customerId", "email"]) await expect(run({ [key]: "other" }), key).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("rejects a segment, view or sort that isn't offered, and a bad limit", async () => {
    await expect(run({ segment: "whales" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(run({ segment: "one-and-done" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(run({ view: "csv" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(run({ sort: "name" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(run({ limit: 0 })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(run({ limit: 501 })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(run({ limit: "ten" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("refuses a store that isn't connected", async () => {
    await expect(run({}, { ...ctx, shop: { ...ctx.shop!, status: "disconnected" } })).rejects.toMatchObject({ code: "STORE_DISCONNECTED" });
    await expect(run({}, { ...ctx, shop: null })).rejects.toMatchObject({ code: "STORE_DISCONNECTED" });
  });

  it("is a tool entry whose schema is the strict input schema", () => {
    expect(getCustomerSegmentsTool.schema.safeParse({ tenantId: "x" }).success).toBe(false);
    expect(getCustomerSegmentsTool.schema.safeParse({ segment: "champions", view: "list", sort: "ltv", limit: 10 }).success).toBe(true);
    expect(getCustomerSegmentsTool.description).toMatch(/not a prediction/);
  });
});

describe("tenant isolation", () => {
  it("Tidepool's segments are its own customers and orders only", async () => {
    const t = await run({ view: "list", limit: 200 }, tCtx);
    const own = expected(tp, tCtx);
    expect(t.data.totalCustomers).toBe(own.byCustomer.size);
    expect(t.data.asOf).toBe(own.last);
    expect(t.range).toEqual({ from: own.first, to: own.last });
    expect(t.data.customers!.every((c) => own.byCustomer.has(c.customerId))).toBe(true);
    expect(t.data.segments.reduce((n, s) => n + s.totalLtvCents, 0)).toBe(metricValue(tp, "net_sales", {}, WIDE));
    const s = await run();
    expect(t.data.totalCustomers).not.toBe(s.data.totalCustomers);
    expect(t.data.asOf).not.toBe(s.data.asOf);
  });

  it("the same shopper is a different pseudonym in each store, so a Solenne id is not found in Tidepool", async () => {
    const solenneIds = new Set((await loadSegmentCustomers(db, ctx.tenantId)).customers.map((c) => c.customerId));
    const tidepoolIds = (await loadSegmentCustomers(db, tCtx.tenantId)).customers.map((c) => c.customerId);
    expect(tidepoolIds.length).toBeGreaterThan(0);
    expect(tidepoolIds.some((id) => solenneIds.has(id))).toBe(false);
  });
});

describe("the number checker", () => {
  it("reads shares and churn risk as percentages, and cents as dollars", async () => {
    const res = await run({ view: "list", limit: 3 });
    const entries = ledgerFromToolResults([res]).entries;
    const at = (path: string) => entries.find((e) => e.path === path)!;
    expect(at("data.segments[0].shareOfCustomers")).toMatchObject({ unit: "rate", value: res.data.segments[0]!.shareOfCustomers * 100 });
    expect(at("data.segments[0].avgChurnRisk")).toMatchObject({ unit: "rate", value: res.data.segments[0]!.avgChurnRisk * 100 });
    expect(at("data.customers[0].churnRisk")).toMatchObject({ unit: "rate", value: res.data.customers![0]!.churnRisk * 100 });
    expect(at("data.segments[0].avgLtvCents")).toMatchObject({ unit: "money", value: res.data.segments[0]!.avgLtvCents / 100 });
    expect(at("data.customers[0].daysSinceLast")).toMatchObject({ unit: "count" });
    expect(at("data.rules.champions.maxDaysSinceLast")).toMatchObject({ unit: "count", value: SEGMENT_RULES.champions.maxDaysSinceLast });
  });
});

describe("hand-made orders", () => {
  // Three buyers and some guests, all dated from 2026-10-31 (the last order day):
  //  H1: orders 200, 100 and 20 days ago. 2 x $15.00 less a $3.00 discount = $27.00; $50.00 of which $10.00 was refunded
  //      (the refund made after the data ends); $20.00. LTV $87.00. A cancelled $99.00 order is not counted at all.
  //  H2: one order 100 days ago for $30.00.
  //  guests: two orders with no customer.
  let hCtx: TenantContext;
  const ASOF = "2026-10-31";
  const ago = (n: number) => addDays(ASOF, -n);

  beforeAll(async () => {
    const [t] = await db.insert(tenants).values({ orgId: "org_segments_by_hand", name: "By hand" }).returning();
    const tenantId = t!.id;
    hCtx = { tenantId, orgId: "org_segments_by_hand", userId: "user_test", role: "gc_admin", shop: { domain: "by-hand.myshopify.com", timezone: "America/New_York", currency: "USD", status: "connected" } };
    const order = async (id: string, daysAgo: number, customerId: string | null, line: { qty: number; unit: number; discount: number } | null, cancelled = false) => {
      const day = ago(daysAgo);
      const gross = line ? line.qty * line.unit : 0;
      await db.insert(orders).values({
        tenantId, id, name: `#${id}`, processedAt: new Date(`${day}T15:00:00Z`), localDate: day, customerId, grossCents: gross, discountCents: line?.discount ?? 0, shippingCents: 500, channel: "web",
        cancelledAt: cancelled ? new Date(`${day}T16:00:00Z`) : null,
      });
      if (line) await db.insert(orderLines).values({ tenantId, id: `${id}_l`, orderId: id, variantId: "v1", productId: "p1", quantity: line.qty, unitPriceCents: line.unit, discountCents: line.discount });
    };
    await order("h1a", 200, "CUST_H1", { qty: 2, unit: 1500, discount: 300 });
    await order("h1b", 100, "CUST_H1", { qty: 1, unit: 5000, discount: 0 });
    await order("h1c", 20, "CUST_H1", { qty: 1, unit: 2000, discount: 0 });
    await order("h1x", 10, "CUST_H1", { qty: 1, unit: 9900, discount: 0 }, true);
    await order("h2a", 100, "CUST_H2", { qty: 1, unit: 3000, discount: 0 });
    await order("g1", 30, null, { qty: 1, unit: 1000, discount: 0 });
    await order("g2", 0, null, { qty: 1, unit: 1000, discount: 0 });
    await db.insert(refunds).values({ tenantId, id: "r1", orderId: "h1b", processedAt: new Date("2026-11-15T12:00:00Z"), localDate: "2026-11-15", amountCents: 1000 });
    await db.insert(refundLines).values({ tenantId, id: "r1_l", refundId: "r1", orderLineId: "h1b_l", quantity: 1, subtotalCents: 1000 });
  });

  const hand = (input: Record<string, unknown> = {}) => getCustomerSegments(hCtx, input as never, { db });

  it("counts customers with a non-cancelled order, leaves guests out and says how many orders that was", async () => {
    const d = (await hand({ view: "list" })).data;
    expect(d.totalCustomers).toBe(2);
    expect(d.ordersWithoutCustomer).toBe(2);
    expect(d.asOf).toBe(ASOF);
    expect(d.customers!.map((c) => c.customerId).sort()).toEqual(["CUST_H1", "CUST_H2"]);
    expect(d.caveats!.join(" ")).toMatch(/2 orders \(ordersWithoutCustomer\) have no customer/);
  });

  it("LTV is the lines after discount and after refunds taken off the order they belong to, shipping and cancelled orders left out", async () => {
    const d = (await hand({ view: "list" })).data;
    const by = Object.fromEntries(d.customers!.map((c) => [c.customerId, c]));
    expect(by.CUST_H1!.ltvCents).toBe(2700 + 4000 + 2000);
    expect(by.CUST_H2!.ltvCents).toBe(3000);
  });

  it("works out orders, dates, gaps and days since last by hand", async () => {
    const by = Object.fromEntries((await hand({ view: "list" })).data.customers!.map((c) => [c.customerId, c]));
    expect(by.CUST_H1).toMatchObject({ orders: 3, firstOrderDate: ago(200), lastOrderDate: ago(20), daysSinceLast: 20, medianGapDays: 90, segment: "champions", churnRisk: 0 });
    expect(by.CUST_H2).toMatchObject({ orders: 1, firstOrderDate: ago(100), lastOrderDate: ago(100), daysSinceLast: 100, medianGapDays: null, segment: "one_and_done" });
  });

  it("judges a one-order customer by the store's typical gap, which here is the one repeat customer's", async () => {
    const d = (await hand({ view: "list" })).data;
    expect(d.typicalGapDays).toBe(90);
    expect(d.repeatCustomers).toBe(1);
    expect(d.customers!.find((c) => c.customerId === "CUST_H2")!.churnRisk).toBe(0.056); // (100 / 90 - 1) / 2
  });

  it("says when too few customers have ordered twice, and names each segment nobody is in", async () => {
    const d = (await hand()).data;
    const text = d.caveats!.join(" ");
    expect(text).toMatch(/Fewer than two customers have ordered more than once/);
    expect(text).toMatch(/No customer is in At risk right now/);
    expect(text).toMatch(/No customer is in Due to reorder right now/);
    expect(text).toMatch(/No customer is in Active right now/);
    expect(text).not.toMatch(/No customer is in Champions/);
    expect(text).not.toMatch(/No customer is in One and done/);
    expect(d.segments.find((s) => s.id === "at_risk")).toMatchObject({ customers: 0, shareOfCustomers: 0, avgLtvCents: 0, totalLtvCents: 0, avgChurnRisk: 0 });
  });

  it("names only the asked segment in the empty-segment caveats", async () => {
    const d = (await hand({ segment: "champions" })).data;
    expect(d.segments).toHaveLength(1);
    expect(d.caveats!.join(" ")).not.toMatch(/No customer is in/);
  });

  it("a store whose orders are all guests has no customers and says so, and a store with no orders has no data", async () => {
    const [g] = await db.insert(tenants).values({ orgId: "org_segments_guests", name: "Guests" }).returning();
    const gCtx: TenantContext = { ...hCtx, tenantId: g!.id, orgId: "org_segments_guests" };
    await expect(getCustomerSegments(gCtx, {}, { db })).rejects.toMatchObject({ code: "NO_DATA" });
    await db.insert(orders).values({ tenantId: g!.id, id: "gx", name: "#gx", processedAt: new Date("2026-10-01T15:00:00Z"), localDate: "2026-10-01", customerId: null, grossCents: 1000, discountCents: 0, shippingCents: 0, channel: "web" });
    const d = (await getCustomerSegments(gCtx, { view: "list" }, { db })).data;
    expect(d.totalCustomers).toBe(0);
    expect(d.ordersWithoutCustomer).toBe(1);
    expect(d.customers).toEqual([]);
    expect(d.segments.every((s) => s.customers === 0 && s.shareOfCustomers === 0)).toBe(true);
    expect(d.caveats!.join(" ")).toMatch(/no customers to segment/);
  });
});
