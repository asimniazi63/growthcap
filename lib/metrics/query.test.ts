import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { setTestNow } from "../clock";
import type { Db } from "../db/client";
import { tenants } from "../db/schema";
import { createTestDb } from "../db/test-db";
import type { TenantContext } from "../tenancy/context";
import { loadDataset, readFixture, shopifyId } from "../../scripts/fixtures/load-db";
import { loadAdSpend, loadPlan as loadPlanFixture, readFixtureFile } from "../../scripts/fixtures/load-pace";
import { monthPeriod, monthlyMetrics, metricValue } from "../../scripts/seed/truth.js";
import { STORES } from "../../scripts/seed/stores.js";
import type { CoreMetricId, Dataset, StoreKey, Truth } from "../../scripts/seed/types.js";
import { CORE_METRIC_IDS } from "./registry";
import { getPaceView } from "../pace/view";
import { queryMetric, type QueryMetricInput } from "./query";
import { getCohorts } from "../tools/cohorts";
import { getZeroSalesDays } from "../tools/zero-sales-days";
import { getUnitEconomics } from "../tools/unit-economics";

let db: Db;
const fixtures = {} as Record<StoreKey, { dataset: Dataset; truth: Truth }>;
const ctxs = {} as Record<StoreKey, TenantContext>;

beforeAll(async () => {
  db = await createTestDb();
  for (const store of ["solenne", "tidepool"] as const) {
    const [t] = await db.insert(tenants).values({ orgId: `org_${store}`, name: STORES[store].name }).returning();
    fixtures[store] = readFixture(store);
    await loadDataset(db, t!.id, store, fixtures[store].dataset);
    await loadAdSpend(db, t!.id, readFixtureFile(store, "ad-spend.csv"));
    await loadPlanFixture(db, t!.id, readFixtureFile(store, "plan.csv"), `${store} plan`);
    ctxs[store] = {
      tenantId: t!.id,
      orgId: `org_${store}`,
      userId: "user_test",
      role: "gc_admin",
      shop: { domain: `${store}.myshopify.com`, timezone: STORES[store].timezone, currency: "USD", status: "connected" },
    };
  }
}, 240_000);

// Tidepool's orders with no ad spend loaded, to see what a brand without ad data gets.
let noAds: TenantContext;
beforeAll(async () => {
  const [t] = await db.insert(tenants).values({ orgId: "org_noads", name: "No ads" }).returning();
  await loadDataset(db, t!.id, "tidepool", fixtures.tidepool.dataset);
  noAds = { ...ctxs.tidepool, tenantId: t!.id, orgId: "org_noads" };
}, 240_000);

const run = (store: StoreKey, input: QueryMetricInput) => queryMetric(ctxs[store], input, { db });

// Counts exactly, money to the cent, rates to 4 decimal places.
function expectMetric(metric: CoreMetricId, actual: number, expected: number, where: string) {
  const exact = ["gross_sales", "discounts", "refunds", "net_sales", "orders", "units", "new_customer_orders"].includes(metric);
  if (exact) expect(actual, `${where} ${metric}`).toBe(expected);
  else expect(actual, `${where} ${metric}`).toBeCloseTo(expected, metric === "aov" ? 2 : 4);
}

describe.each(["solenne", "tidepool"] as const)("%s: every metric equals truth.json", (store) => {
  it("matches every month of the data window for all 11 metrics", async () => {
    const months = Object.entries(fixtures[store].truth.monthly);
    expect(months.length).toBeGreaterThan(1);
    for (const [month, expected] of months) {
      const { from, to } = monthPeriod(month);
      const res = await run(store, { metrics: [...CORE_METRIC_IDS], from, to });
      expect(res.data).toHaveLength(1);
      for (const m of CORE_METRIC_IDS) expectMetric(m, res.data[0]!.values[m]!, expected[m], month);
    }
  });

  it("matches the storyline checks the core metrics can answer", async () => {
    let checked = 0;
    for (const sl of fixtures[store].truth.storylines) {
      for (const c of sl.checks) {
        if (!(CORE_METRIC_IDS as readonly string[]).includes(c.metric)) continue; // repeat_rate and zero_sales_days: T12
        const f = c.filter;
        const filters: NonNullable<QueryMetricInput["filters"]> = {};
        if (f.discount_code) filters.discountCodes = [f.discount_code];
        if (f.channel) filters.channels = [f.channel];
        if (f.tag) filters.tags = [f.tag];
        if (f.exclude_tag) filters.excludeTags = [f.exclude_tag];
        if (f.customer_type) filters.customerType = f.customer_type as "new" | "returning";
        if (f.product) filters.productIds = [shopifyId.product(f.product)];
        if (f.variant) filters.variantIds = [shopifyId.variant(f.variant)];
        const res = await run(store, { metrics: [c.metric as CoreMetricId], from: c.period.from, to: c.period.to, filters });
        const actual = res.data[0]!.values[c.metric as CoreMetricId]!;
        expect(Math.abs(actual - c.expected), `${sl.id} ${c.metric} ${JSON.stringify(f)}`).toBeLessThanOrEqual(c.tolerance);
        // And it agrees with the independent truth computation on the dataset itself.
        expect(actual).toBeCloseTo(metricValue(fixtures[store].dataset, c.metric as CoreMetricId, f, c.period), 4);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});

describe("dates", () => {
  it("counts an order on its store-local date at the edges of a day (00:30 and 23:30)", async () => {
    // Solenne is New York: pick every order within an hour of local midnight and compare day by day with truth.
    const { dataset } = fixtures.solenne;
    const edge = dataset.orders.filter((o) => /T(23:[34]|00:[0-5])/.test(o.processedAt.slice(10)));
    expect(edge.length).toBeGreaterThan(0);
    for (const o of edge.slice(0, 5)) {
      const day = o.processedAt.slice(0, 10);
      const res = await run("solenne", { metrics: ["orders"], from: day, to: day });
      expect(res.data[0]!.values.orders).toBe(metricValue(dataset, "orders", {}, { from: day, to: day }));
    }
  });

  it("fills empty days with zeros inside the data window, so a quiet stretch shows as 0", async () => {
    const res = await run("solenne", { metrics: ["orders", "units"], from: "2026-07-01", to: "2026-07-31", groupBy: ["day"] });
    expect(res.data).toHaveLength(31);
    expect(res.data.map((r) => r.group.day)).toEqual([...res.data.map((r) => r.group.day)].sort());
    const total = res.data.reduce((s, r) => s + r.values.orders!, 0);
    expect(total).toBe(metricValue(fixtures.solenne.dataset, "orders", {}, { from: "2026-07-01", to: "2026-07-31" }));
  });

  it("answers NO_DATA outside the data window, for both stores", async () => {
    await expect(run("solenne", { metrics: ["orders"], from: "2025-01-01", to: "2025-01-31" })).rejects.toMatchObject({ code: "NO_DATA" });
    await expect(run("tidepool", { metrics: ["orders"], from: "2025-09-01", to: "2025-10-31" })).rejects.toMatchObject({ code: "NO_DATA" });
    await expect(run("solenne", { metrics: ["orders"], from: "2027-01-01", to: "2027-01-31" })).rejects.toMatchObject({ code: "NO_DATA" });
  });

  it("resolves named periods with the store's clock, pinned to the end of the data", async () => {
    setTestNow("2026-11-02T12:00:00-05:00");
    try {
      const res = await run("solenne", { metrics: ["orders"], period: "last_month" });
      expect(res.range).toEqual({ from: "2026-10-01", to: "2026-10-31" }); // the data ends on Oct 31, so "today" is Nov 1 and October is "last month"
      const def = await run("solenne", { metrics: ["orders"] });
      expect(def.range.to).toBe("2026-11-01");
      expect(def.range.from).toBe("2026-10-03");
    } finally {
      setTestNow(null);
    }
  });
});

describe("refunds across months", () => {
  it("puts a refund in the month it was made for `refunds`, and in the order's month for `refund_rate`", async () => {
    const { dataset } = fixtures.solenne;
    const order = new Map(dataset.orders.map((o) => [o.genId, o]));
    const late = dataset.refunds.find((r) => order.get(r.orderGenId)!.processedAt.slice(0, 7) !== r.processedAt.slice(0, 7));
    expect(late, "the dataset has a refund in a later month than its order").toBeDefined();
    const refundMonth = monthPeriod(late!.processedAt.slice(0, 7));
    const orderMonth = monthPeriod(order.get(late!.orderGenId)!.processedAt.slice(0, 7));
    const inRefundMonth = await run("solenne", { metrics: ["refunds"], ...refundMonth });
    expect(inRefundMonth.data[0]!.values.refunds).toBe(metricValue(dataset, "refunds", {}, refundMonth));
    const inOrderMonth = await run("solenne", { metrics: ["refund_rate"], ...orderMonth });
    expect(inOrderMonth.data[0]!.values.refund_rate).toBeCloseTo(metricValue(dataset, "refund_rate", {}, orderMonth), 4);
    expect(inOrderMonth.data[0]!.values.refund_rate).toBeGreaterThan(0);
  });
});

describe("grouping, comparing and sharing", () => {
  it("groups by channel and gives each group's share, which adds up to 1", async () => {
    const res = await run("solenne", { metrics: ["gross_sales", "orders"], from: "2026-05-01", to: "2026-05-31", groupBy: ["channel"] });
    expect(res.data.length).toBeGreaterThan(1);
    const shares = res.data.map((r) => r.share!.gross_sales!);
    expect(shares.reduce((s, x) => s + x, 0)).toBeCloseTo(1, 6);
    const total = res.data.reduce((s, r) => s + r.values.gross_sales!, 0);
    expect(total).toBe(metricValue(fixtures.solenne.dataset, "gross_sales", {}, { from: "2026-05-01", to: "2026-05-31" }));
  });

  it("compares with the previous period and returns the change, so the model never subtracts", async () => {
    const res = await run("solenne", { metrics: ["net_sales"], from: "2026-05-01", to: "2026-05-31", compareTo: "previous_period" });
    const row = res.data[0]!;
    const april = metricValue(fixtures.solenne.dataset, "net_sales", {}, monthPeriod("2026-04"));
    expect(row.previous!.net_sales).toBe(april);
    expect(row.change!.net_sales).toBe(row.values.net_sales! - april);
    expect(row.pctChange!.net_sales).toBeCloseTo((row.values.net_sales! - april) / april, 6);
  });

  it("compares with the same dates a year earlier", async () => {
    const res = await run("solenne", { metrics: ["orders"], from: "2026-09-01", to: "2026-09-30", compareTo: "previous_year" });
    expect(res.data[0]!.previous!.orders).toBe(metricValue(fixtures.solenne.dataset, "orders", {}, monthPeriod("2025-09")));
  });

  it("limits grouped rows and says what was cut", async () => {
    const res = await run("solenne", { metrics: ["units"], from: "2025-09-01", to: "2026-10-31", groupBy: ["variant"], limit: 5 });
    expect(res.data).toHaveLength(5);
    expect(res.truncated).toMatchObject({ shown: 5 });
    expect(res.truncated!.total).toBeGreaterThan(5);
    const units = res.data.map((r) => r.values.units!);
    expect(units).toEqual([...units].sort((a, b) => b - a));
  });
});

describe("results carry what the agent must quote", () => {
  it("returns definitions, a query id, the range and when the data was last synced", async () => {
    const res = await run("solenne", { metrics: ["aov", "refund_rate"], from: "2026-05-01", to: "2026-05-31" });
    expect(Object.keys(res.definitions).sort()).toEqual(["aov", "refund_rate"]);
    expect(res.definitions.aov).toMatch(/net sales|order/i);
    expect(res.queryId).toMatch(/^q_[0-9a-f]{12}$/);
    expect(res.range).toEqual({ from: "2026-05-01", to: "2026-05-31" });
    expect(Date.parse(res.asOf)).not.toBeNaN();
    const again = await run("solenne", { metrics: ["aov", "refund_rate"], from: "2026-05-01", to: "2026-05-31" });
    expect(again.queryId).toBe(res.queryId);
  });
});

describe("isolation and access", () => {
  it("never returns another tenant's rows: both stores share one database, and each answers only for itself", async () => {
    const t = fixtures.tidepool.dataset;
    const s = fixtures.solenne.dataset;
    const full = { from: "2025-09-01", to: "2026-10-31" };
    const tidepoolAll = await run("tidepool", { metrics: ["orders", "gross_sales"], ...full });
    expect(tidepoolAll.data[0]!.values.orders).toBe(metricValue(t, "orders", {}, full));
    expect(tidepoolAll.data[0]!.values.gross_sales).toBe(metricValue(t, "gross_sales", {}, full));
    expect(metricValue(s, "orders", {}, full)).toBeGreaterThan(tidepoolAll.data[0]!.values.orders! * 5);
  });

  it("finds nothing for Tidepool when handed Solenne-only discount codes, or any grouping that would list Solenne rows", async () => {
    const tidepoolCodes = new Set(fixtures.tidepool.dataset.discounts.map((d) => d.code));
    const solenneOnly = fixtures.solenne.dataset.discounts.map((d) => d.code).filter((c) => !tidepoolCodes.has(c));
    expect(solenneOnly.length).toBeGreaterThan(0);
    const res = await run("tidepool", { metrics: ["orders"], from: "2025-11-01", to: "2026-10-31", filters: { discountCodes: solenneOnly } });
    expect(res.data[0]!.values.orders).toBe(0);
    const byCode = await run("tidepool", { metrics: ["orders"], from: "2025-11-01", to: "2026-10-31", groupBy: ["discount_code"] });
    const codes = byCode.data.map((r) => r.group.discount_code);
    expect(codes.filter((c) => solenneOnly.includes(c!))).toEqual([]);
  });

  it("throws STORE_DISCONNECTED when the store is disconnected or missing", async () => {
    const input = { metrics: ["orders"], from: "2026-05-01", to: "2026-05-31" } satisfies QueryMetricInput;
    await expect(queryMetric({ ...ctxs.solenne, shop: { ...ctxs.solenne.shop!, status: "disconnected" } }, input, { db })).rejects.toMatchObject({ code: "STORE_DISCONNECTED" });
    await expect(queryMetric({ ...ctxs.solenne, shop: null }, input, { db })).rejects.toMatchObject({ code: "STORE_DISCONNECTED" });
  });
});

describe("input validation", () => {
  const bad = (input: unknown) => expect(queryMetric(ctxs.solenne, input as QueryMetricInput, { db })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  it("rejects an unknown metric or dimension, a malformed date, from after to, and unknown keys", async () => {
    await bad({ metrics: ["profit"] });
    await bad({ metrics: [] });
    await bad({ metrics: ["orders"], groupBy: ["zodiac"] });
    await bad({ metrics: ["orders"], from: "05/01/2026", to: "2026-05-31" });
    await bad({ metrics: ["orders"], from: "2026-02-30", to: "2026-03-01" });
    await bad({ metrics: ["orders"], from: "2026-06-01", to: "2026-05-01" });
    await bad({ metrics: ["orders"], period: "last_30_days", tenantId: "other" });
    await bad({ metrics: ["orders"], filters: { shop: "other.myshopify.com" } });
  });
  it("caps a limit of 500 at 200 rows and marks the result truncated", async () => {
    const res = await run("solenne", { metrics: ["orders"], from: "2025-09-01", to: "2026-10-31", groupBy: ["day"], limit: 500 });
    expect(res.data).toHaveLength(200);
    expect(res.truncated).toMatchObject({ shown: 200 });
    expect(res.truncated!.total).toBeGreaterThan(200);
  });
});

// Keeps the independent truth helper honest: it must agree with the stored monthly figures.
describe("truth helper", () => {
  it("monthlyMetrics reproduces truth.json", () => {
    const { dataset, truth } = fixtures.tidepool;
    expect(monthlyMetrics(dataset)["2026-03"]).toEqual(truth.monthly["2026-03"]);
  });
});

// ---- MER and new-customer CAC (T6). The expected values come from truth.json (net sales, new-customer orders) and the
// ad-spend.csv file read line by line here, not from the loader or the query engine.
const spendByDay = (store: StoreKey) => {
  const out = new Map<string, number>();
  for (const l of readFixtureFile(store, "ad-spend.csv").split("\n")) {
    const m = /^(\d{4}-\d{2}-\d{2}),\w+,(\d+)$/.exec(l);
    if (m) out.set(m[1]!, (out.get(m[1]!) ?? 0) + Number(m[2]));
  }
  return out;
};
const spendIn = (store: StoreKey, from: string, to: string) => [...spendByDay(store)].filter(([d]) => d >= from && d <= to).reduce((s, [, v]) => s + v, 0);

describe.each(["solenne", "tidepool"] as const)("%s: MER and new-customer CAC", (store) => {
  it("equal net sales over ad spend, and ad spend over new-customer orders, for every month", async () => {
    let checked = 0;
    for (const [month, expected] of Object.entries(fixtures[store].truth.monthly)) {
      const { from, to } = monthPeriod(month);
      const spend = spendIn(store, from, to);
      if (spend === 0) continue;
      const res = await run(store, { metrics: ["mer", "new_customer_cac"], from, to });
      expect(res.data[0]!.values.mer, `${month} mer`).toBeCloseTo(expected.net_sales / spend, 8);
      expect(res.data[0]!.values.new_customer_cac, `${month} cac`).toBeCloseTo(expected.new_customer_orders === 0 ? 0 : spend / expected.new_customer_orders, 6);
      checked++;
    }
    expect(checked).toBeGreaterThan(5);
  });

  it("uses each month's own spend when grouped by month", async () => {
    const res = await run(store, { metrics: ["mer"], from: "2026-07-01", to: "2026-09-30", groupBy: ["month"] });
    expect(res.data.map((r) => r.group.month)).toEqual(["2026-07", "2026-08", "2026-09"]);
    for (const r of res.data) {
      const { from, to } = monthPeriod(r.group.month!);
      expect(r.values.mer).toBeCloseTo(fixtures[store].truth.monthly[r.group.month!]!.net_sales / spendIn(store, from, to), 8);
    }
  });

  it("uses the day's own spend when grouped by day, and a part week's spend only for the days asked for", async () => {
    const res = await run(store, { metrics: ["mer"], from: "2026-09-02", to: "2026-09-04", groupBy: ["week"] });
    expect(res.data).toHaveLength(1); // 2026-09-02 is a Wednesday: one week bucket, but only 3 days of spend and sales
    const net = metricValue(fixtures[store].dataset, "net_sales", {}, { from: "2026-09-02", to: "2026-09-04" });
    expect(res.data[0]!.values.mer).toBeCloseTo(net / spendIn(store, "2026-09-02", "2026-09-04"), 8);
    const days = await run(store, { metrics: ["mer"], from: "2026-09-02", to: "2026-09-04", groupBy: ["day"] });
    for (const d of days.data) {
      const day = d.group.day!;
      expect(d.values.mer).toBeCloseTo(metricValue(fixtures[store].dataset, "net_sales", {}, { from: day, to: day }) / spendIn(store, day, day), 8);
    }
  });

  it("compares with the earlier period's own spend", async () => {
    const res = await run(store, { metrics: ["mer"], from: "2026-09-01", to: "2026-09-30", compareTo: "previous_period" });
    const aug = monthPeriod("2026-08");
    expect(res.data[0]!.previous!.mer).toBeCloseTo(fixtures[store].truth.monthly["2026-08"]!.net_sales / spendIn(store, aug.from, aug.to), 8);
  });

  it("leaves ad spend whole when orders are filtered: wholesale-free MER is wholesale-free net sales over all the spend", async () => {
    const { from, to } = monthPeriod("2026-05");
    const res = await run(store, { metrics: ["mer"], from, to, filters: { excludeTags: ["wholesale"] } });
    const net = metricValue(fixtures[store].dataset, "net_sales", { exclude_tag: "wholesale" }, { from, to });
    expect(res.data[0]!.values.mer).toBeCloseTo(net / spendIn(store, from, to), 8);
  });

  it("refuses a grouping that ad spend can't be split by", async () => {
    for (const groupBy of [["product"], ["variant"], ["channel"], ["discount_code"], ["customer_type"], ["tag"]] as const) {
      await expect(run(store, { metrics: ["mer"], period: "last_30_days", groupBy: [...groupBy] })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    }
    await expect(run(store, { metrics: ["new_customer_cac"], period: "last_30_days", groupBy: ["month", "product"] })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("still groups the other metrics by product when MER is not asked for", async () => {
    const res = await run(store, { metrics: ["net_sales"], period: "last_30_days", groupBy: ["product"] });
    expect(res.data.length).toBeGreaterThan(0);
  });

  it("describes both metrics in the result's definitions", async () => {
    const res = await run(store, { metrics: ["mer", "new_customer_cac"], period: "last_30_days" });
    expect(Object.keys(res.definitions).sort()).toEqual(["mer", "new_customer_cac"]);
    expect(res.definitions.mer).toMatch(/ad spend/i);
  });
});

describe("MER and CAC without ad spend or without new customers", () => {
  it("are 0 for a brand that has no ad spend loaded, and the definition says what 0 means", async () => {
    const res = await queryMetric(noAds, { metrics: ["mer", "new_customer_cac", "net_sales"], from: "2026-09-01", to: "2026-09-30" }, { db });
    expect(res.data[0]!.values.net_sales).toBeGreaterThan(0);
    expect(res.data[0]!.values.mer).toBe(0);
    expect(res.data[0]!.values.new_customer_cac).toBe(0);
    expect(res.definitions.mer).toMatch(/0 when/);
  });

  it("keeps one brand's ad spend out of another's", async () => {
    const solenne = await run("solenne", { metrics: ["mer"], from: "2026-09-01", to: "2026-09-30" });
    const tidepool = await run("tidepool", { metrics: ["mer"], from: "2026-09-01", to: "2026-09-30" });
    expect(solenne.data[0]!.values.mer).not.toBeCloseTo(tidepool.data[0]!.values.mer!, 3);
  });
});

// ---- Names beside ids. The live chat showed "Product" in every row of a table because grouped rows carried only gids and
// the model skipped the extra search_products call. Titles are store text, so they sit under `untrusted`.
describe.each(["solenne", "tidepool"] as const)("%s: product and variant names on grouped rows", (store) => {
  const titles = () => {
    const ds = fixtures[store].dataset;
    const product = new Map(ds.products.map((p) => [shopifyId.product(p.genId), p.title]));
    const variant = new Map(ds.variants.map((v) => [shopifyId.variant(v.genId), { variant: v.title, product: product.get(shopifyId.product(v.productGenId))! }]));
    return { product, variant };
  };

  it("gives each product row its title", async () => {
    const res = await run(store, { metrics: ["units"], from: "2026-09-01", to: "2026-09-30", groupBy: ["product"] });
    const { product } = titles();
    expect(res.data.length).toBeGreaterThan(3);
    for (const r of res.data) expect(r.untrusted, r.group.product).toEqual({ product: product.get(r.group.product!) });
  });

  it("gives each variant row its variant title and its product's title", async () => {
    const res = await run(store, { metrics: ["units"], from: "2026-09-01", to: "2026-09-30", groupBy: ["variant"] });
    const { variant } = titles();
    expect(res.data.length).toBeGreaterThan(3);
    for (const r of res.data) expect(r.untrusted, r.group.variant).toEqual(variant.get(r.group.variant!));
  });

  it("adds no names to groupings that have none, or to a total", async () => {
    for (const groupBy of [["day"], ["discount_code"], ["channel"]] as const) {
      const res = await run(store, { metrics: ["orders"], from: "2026-09-01", to: "2026-09-07", groupBy: [...groupBy] });
      expect(res.data.every((r) => r.untrusted === undefined)).toBe(true);
    }
    const total = await run(store, { metrics: ["orders"], from: "2026-09-01", to: "2026-09-07" });
    expect(total.data[0]!.untrusted).toBeUndefined();
  });
});

// ---- gapToPlan (T6). Plan figures are read from plan.csv here; actuals come from truth.json and the dataset.
const planRow = (store: StoreKey, month: string) => {
  const line = readFixtureFile(store, "plan.csv").split("\n").find((l) => l.startsWith(`${month},`));
  if (!line) return undefined;
  const [, net, orders, newOrders, aov, returning] = line.split(",");
  return { net_sales: Number(net), orders: Number(orders), new_customer_orders: Number(newOrders), aov: Number(aov), returning_customer_rate: Number(returning) };
};

describe.each(["solenne", "tidepool"] as const)("%s: gapToPlan", (store) => {
  it("compares every whole month in the data with its plan: the plan's figure, truth.json's actual and the difference", async () => {
    let checked = 0;
    for (const [month, expected] of Object.entries(fixtures[store].truth.monthly)) {
      const plan = planRow(store, month);
      if (!plan) continue;
      const { from, to } = monthPeriod(month);
      const res = await run(store, { metrics: ["net_sales", "orders", "new_customer_orders"], from, to });
      const gap = res.data[0]!.gapToPlan!;
      for (const m of ["net_sales", "orders", "new_customer_orders"] as const) {
        expect(gap[m], `${month} ${m}`).toMatchObject({ month, target: plan[m], planned: plan[m], actual: expected[m], gap: expected[m] - plan[m] });
        expect(gap[m]!.projected).toBeUndefined();
      }
      checked++;
    }
    expect(checked).toBeGreaterThan(5);
  });

  it("spreads a month-to-date target by the same month last year when the data has it, and evenly when it doesn't", async () => {
    const ds = fixtures[store].dataset;
    const target = planRow(store, "2026-09")!.orders;
    const day = (d: string) => metricValue(ds, "orders", {}, { from: d, to: d });
    const lastYearCovered = fixtures[store].truth.window.from <= "2025-09-01";
    const last = Array.from({ length: 30 }, (_, i) => day(`2025-09-${String(i + 1).padStart(2, "0")}`));
    const total = last.reduce((s, v) => s + v, 0);
    const share = lastYearCovered ? last.slice(0, 15).reduce((s, v) => s + v, 0) / total : 15 / 30;

    const res = await run(store, { metrics: ["orders"], from: "2026-09-01", to: "2026-09-15" });
    const g = res.data[0]!.gapToPlan!.orders!;
    const actual = metricValue(ds, "orders", {}, { from: "2026-09-01", to: "2026-09-15" });
    expect(g.spread).toBe(lastYearCovered ? "last_year" : "even");
    expect(g.planned).toBeCloseTo(target * share, 1);
    expect(g.actual).toBe(actual);
    expect(g.projected).toBeCloseTo(actual + target * (1 - share) * (actual / (target * share)), 1);
  });

  it("is left out when the result is grouped, filtered, spans two months, or the brand has no plan", async () => {
    const m = { metrics: ["net_sales" as const], from: "2026-09-01", to: "2026-09-30" };
    expect((await run(store, { ...m, groupBy: ["channel"] })).data.every((r) => r.gapToPlan === undefined)).toBe(true);
    expect((await run(store, { ...m, filters: { excludeTags: ["wholesale"] } })).data[0]!.gapToPlan).toBeUndefined();
    expect((await run(store, { ...m, from: "2026-09-20", to: "2026-10-10" })).data[0]!.gapToPlan).toBeUndefined();
    expect((await queryMetric(noAds, m, { db })).data[0]!.gapToPlan).toBeUndefined();
  });
});

describe("gapToPlan: the Solenne October story (S9)", () => {
  it("shows net sales about 9% behind plan and new-customer orders about 20% behind", async () => {
    const res = await run("solenne", { metrics: ["net_sales", "new_customer_orders"], from: "2026-10-01", to: "2026-10-31" });
    const g = res.data[0]!.gapToPlan!;
    expect(g.net_sales!.pctGap!).toBeLessThan(-0.09);
    expect(g.net_sales!.pctGap!).toBeGreaterThan(-0.095);
    expect(g.new_customer_orders!.pctGap!).toBeLessThan(-0.18);
    expect(g.new_customer_orders!.pctGap!).toBeGreaterThan(-0.25);
  });
});

// ---- The /pace view: this month to date, through yesterday, and how last month finished.
describe.each(["solenne", "tidepool"] as const)("%s: the pace view", (store) => {
  afterEach(() => setTestNow(null));

  it("counts this month through yesterday, and shows last month whole", async () => {
    setTestNow("2026-10-16T12:00:00-04:00");
    const view = await getPaceView(ctxs[store], { db });
    expect(view).toMatchObject({ today: "2026-10-16", month: "2026-10", through: "2026-10-15", started: true, hasPlan: true });
    const ds = fixtures[store].dataset;
    expect(view.thisMonth!.gaps!.net_sales).toMatchObject({ throughDate: "2026-10-15", actual: metricValue(ds, "net_sales", {}, { from: "2026-10-01", to: "2026-10-15" }) });
    expect(view.thisMonth!.gaps!.net_sales!.projected).toBeGreaterThan(0);
    expect(view.lastMonth).toMatchObject({ month: "2026-09" });
    expect(view.lastMonth!.gaps!.net_sales).toMatchObject({ actual: fixtures[store].truth.monthly["2026-09"]!.net_sales, throughDate: "2026-09-30" });
  });

  it("carries the plan's own name and the time the data was last synced", async () => {
    setTestNow("2026-10-16T12:00:00-04:00");
    const view = await getPaceView(ctxs[store], { db });
    expect(view.planLabel).toBe(`${store} plan`);
    expect(view.asOf).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe("the pace view: the morning after the data ends", () => {
  afterEach(() => setTestNow(null));

  it("says the new month hasn't started, and shows October (the S9 month) as last month", async () => {
    setTestNow("2026-11-03T12:00:00Z"); // the newest order is more than 36 hours old, so today is the day after it
    const view = await getPaceView(ctxs.solenne, { db });
    expect(view).toMatchObject({ today: "2026-11-01", month: "2026-11", through: "2026-10-31", started: false, demoClock: true });
    expect(view.thisMonth).toBeNull();
    expect(view.lastMonth).toMatchObject({ month: "2026-10" });
    expect(view.lastMonth!.gaps!.net_sales!.pctGap!).toBeLessThan(-0.09);
  });

  it("has no plan to show for a brand without one, and still returns the dates", async () => {
    setTestNow("2026-10-16T12:00:00-04:00");
    const view = await getPaceView(noAds, { db });
    expect(view).toMatchObject({ hasPlan: false, planLabel: null });
    expect(view.thisMonth?.gaps).toBeUndefined();
  });
});

// ---- T12: gross margin, repeat rate, zero-sales days, the cohort grid, unit economics and "need $X a day". Expected values come
// from the independent truth helper (scripts/seed/truth.ts) and plan.csv, never from the code under test.
describe.each(["solenne", "tidepool"] as const)("%s: gross_margin equals truth", (store) => {
  it("matches the independent computation for every month, and says how many variants had no cost", async () => {
    for (const month of Object.keys(fixtures[store].truth.monthly)) {
      const period = monthPeriod(month);
      const res = await run(store, { metrics: ["gross_margin"], ...period });
      expect(res.data[0]!.values.gross_margin!, month).toBeCloseTo(metricValue(fixtures[store].dataset, "gross_margin", {}, period), 4);
      expect(res.data[0]!.costCoverage).toEqual({ variantsWithoutCost: 0, unitsWithoutCost: 0 });
    }
  });
});

describe.each(["solenne", "tidepool"] as const)("%s: repeat_rate and zero_sales_days equal truth", (store) => {
  it("get_cohorts matches every repeat_rate storyline check", async () => {
    let checked = 0;
    for (const sl of fixtures[store].truth.storylines) {
      for (const c of sl.checks.filter((x) => x.metric === "repeat_rate")) {
        const f = c.filter;
        const res = await getCohorts(
          ctxs[store],
          {
            from: c.period.from,
            to: c.period.to,
            windowDays: Number(f.window_days ?? 30) as 30 | 60 | 180,
            ...(f.first_order_code ? { firstOrderCode: f.first_order_code } : {}),
            ...(f.exclude_first_order_code ? { excludeFirstOrderCode: f.exclude_first_order_code } : {}),
            ...(f.exclude_tag ? { excludeTags: [f.exclude_tag] } : {}),
            grid: false,
          },
          { db },
        );
        expect(res.data.summary.repeatRate ?? 0, `${sl.id} ${JSON.stringify(f)}`).toBeCloseTo(metricValue(fixtures[store].dataset, "repeat_rate", f, c.period), 4);
        expect(res.data.summary.repeatRate ?? 0).toBeCloseTo(c.expected, 2);
        checked++;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(0);
  });

  it("get_zero_sales_days matches every zero_sales_days storyline check", async () => {
    for (const sl of fixtures[store].truth.storylines) {
      for (const c of sl.checks.filter((x) => x.metric === "zero_sales_days")) {
        const variantId = shopifyId.variant(c.filter.variant!);
        const res = await getZeroSalesDays(ctxs[store], { from: c.period.from, to: c.period.to, variantIds: [variantId] }, { db });
        const days = res.data.find((r) => r.variantId === variantId)?.zeroSalesDays ?? 0;
        expect(days, `${sl.id}`).toBe(metricValue(fixtures[store].dataset, "zero_sales_days", c.filter, c.period));
        expect(days).toBe(c.expected);
      }
    }
  });
});

describe("the cohort grid", () => {
  it("each cell is the repeat share for that first-order month and window, and shares only grow along a row", async () => {
    const ds = fixtures.solenne.dataset;
    const res = await getCohorts(ctxs.solenne, { from: "2026-01-01", to: "2026-06-30", maxMonthsSince: 3 }, { db });
    expect(res.data.cells).toHaveLength(6 * 3);
    for (const cell of res.data.cells) {
      const period = monthPeriod(cell.cohort);
      expect(cell.repeatShare ?? 0, `${cell.cohort} +${cell.monthsSince}`).toBeCloseTo(metricValue(ds, "repeat_rate", { window_days: String(cell.windowDays) }, period), 4);
    }
    for (const cohort of new Set(res.data.cells.map((c) => c.cohort))) {
      const row = res.data.cells.filter((c) => c.cohort === cohort).sort((a, b) => a.monthsSince - b.monthsSince);
      for (let i = 1; i < row.length; i++) if (row[i]!.repeatShare !== null && row[i - 1]!.repeatShare !== null) expect(row[i]!.repeatShare!).toBeGreaterThanOrEqual(row[i - 1]!.repeatShare!);
    }
  });

  it("leaves a cell null when nobody in the cohort has been a customer long enough", async () => {
    const res = await getCohorts(ctxs.solenne, { from: "2026-10-01", to: "2026-10-31", maxMonthsSince: 6 }, { db });
    expect(res.data.cells.at(-1)!.repeatShare).toBeNull();
  });

  it("rejects a tenant, and a grid wider than 24 first-order months", async () => {
    await expect(getCohorts(ctxs.solenne, { tenantId: "other" } as never, { db })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(getCohorts(ctxs.solenne, { from: "2024-01-01", to: "2026-10-31" }, { db })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
});

describe("unit economics", () => {
  it("contribution margin is net sales less cost of goods less ad spend, per month", async () => {
    const res = await getUnitEconomics(ctxs.solenne, { from: "2026-08-01", to: "2026-09-30" }, { db });
    for (const m of res.data.months) {
      expect(m.netSalesCents).toBe(fixtures.solenne.truth.monthly[m.month]!.net_sales);
      expect(m.contributionMarginCents).toBe(m.netSalesCents - m.costOfGoodsCents - m.adSpendCents);
      expect(m.costOfGoodsCents).toBeGreaterThan(0);
    }
    expect(res.definitions.contributionMargin).toMatch(/today's unit cost/i);
  });

  it("a cohort's payback is the first month its cumulative gross margin covers the new-customer CAC", async () => {
    const res = await getUnitEconomics(ctxs.solenne, { from: "2026-03-01", to: "2026-09-30" }, { db });
    expect(res.data.payback.length).toBeGreaterThan(0);
    for (const c of res.data.payback) {
      if (c.paybackMonths === null) expect(c.curve.every((p) => p.cumulativeGrossMarginCents < c.acquisitionCostCents)).toBe(true);
      else {
        expect(c.curve.find((p) => p.monthsSince === c.paybackMonths)!.cumulativeGrossMarginCents).toBeGreaterThanOrEqual(c.acquisitionCostCents);
        expect(c.curve.filter((p) => p.monthsSince < c.paybackMonths!).every((p) => p.cumulativeGrossMarginCents < c.acquisitionCostCents)).toBe(true);
      }
    }
  });
});

describe.each(["solenne", "tidepool"] as const)("%s: need X a day to hit plan", (store) => {
  it("is the remaining target over the remaining days, never negative, and absent when the month is over", async () => {
    const plan = planRow(store, "2026-10")!;
    const through = metricValue(fixtures[store].dataset, "net_sales", {}, { from: "2026-10-01", to: "2026-10-15" });
    const res = await run(store, { metrics: ["net_sales", "orders"], from: "2026-10-01", to: "2026-10-15" });
    const g = res.data[0]!.gapToPlan!;
    expect(g.net_sales!.daysLeft).toBe(16);
    if (through < plan.net_sales) expect(g.net_sales!.neededPerDay).toBe(Math.round((plan.net_sales - through) / 16));
    else expect(g.net_sales).toMatchObject({ targetMet: true });
    expect(g.net_sales!.neededPerDay ?? 0).toBeGreaterThanOrEqual(0);

    const whole = await run(store, { metrics: ["net_sales"], from: "2026-10-01", to: "2026-10-31" });
    expect(whole.data[0]!.gapToPlan!.net_sales!.neededPerDay).toBeUndefined();
    const lateStart = await run(store, { metrics: ["net_sales"], from: "2026-10-05", to: "2026-10-15" });
    expect(lateStart.data[0]!.gapToPlan!.net_sales!.neededPerDay).toBeUndefined();
  });
});
