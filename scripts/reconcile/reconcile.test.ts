import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../../lib/db/client";
import { orders, products, refundLines, tenants } from "../../lib/db/schema";
import { createTestDb } from "../../lib/db/test-db";
import type { TenantContext } from "../../lib/tenancy/context";
import { loadDataset, readFixture, seedTwoStores, shopifyId } from "../fixtures/load-db";
import { STORES } from "../seed/stores.js";
import { idMapFromJournal, reconcileStore, renderStoreSection, upsertSection, type Reconciliation } from "./reconcile";

const ids = { product: shopifyId.product, variant: shopifyId.variant };

let db: Db;
let seeded: Awaited<ReturnType<typeof seedTwoStores>>;

beforeAll(async () => {
  db = await createTestDb();
  seeded = await seedTwoStores(db);
}, 240_000);

const reconcile = (store: "solenne" | "tidepool", over: Partial<Parameters<typeof reconcileStore>[0]> = {}) =>
  reconcileStore({ db, ctx: seeded.ctxs[store], truth: seeded.fixtures[store].truth, dataset: seeded.fixtures[store].dataset, ids, ...over });

describe.each(["solenne", "tidepool"] as const)("reconcileStore on a faithful sync of %s", (store) => {
  it("finds no differences in any month, storyline check or count", async () => {
    const rec = await reconcile(store);
    expect(rec.differences).toEqual([]);
    expect(rec.checked.months).toBe(Object.keys(seeded.fixtures[store].truth.monthly).length);
    expect(rec.checked.monthlyValues).toBe(rec.checked.months * 11);
    expect(rec.checked.storylineChecks).toBeGreaterThan(0);
    expect(rec.checked.counts).toBe(5);
  });
});

describe("reconcileStore on data that has gone wrong", () => {
  // Each test gets its own small database, because it breaks the data on purpose.
  async function tidepool() {
    const d = await createTestDb();
    const [t] = await d.insert(tenants).values({ orgId: "org_t", name: "Tidepool" }).returning();
    const fx = readFixture("tidepool");
    await loadDataset(d, t!.id, "tidepool", fx.dataset);
    const ctx: TenantContext = { tenantId: t!.id, orgId: "org_t", userId: "u", role: "gc_admin", shop: { domain: "t.myshopify.com", timezone: STORES.tidepool.timezone, currency: "USD", status: "connected" } };
    return { d, ctx, fx };
  }

  it("reports a lost refund in the month it was made", async () => {
    const { d, ctx, fx } = await tidepool();
    const [line] = await d.select().from(refundLines).limit(1);
    await d.delete(refundLines).where(eq(refundLines.id, line!.id));
    const rec = await reconcileStore({ db: d, ctx, truth: fx.truth, dataset: fx.dataset, ids });
    const monthly = rec.differences.filter((x) => x.kind === "monthly");
    // Losing a refund line changes the refund total, net sales, and the share of units refunded.
    expect(monthly.map((x) => x.metric).sort()).toEqual(["net_sales", "refund_rate", "refunds"]);
    for (const x of monthly) expect(x.actual).not.toBe(x.expected);
    expect(new Set(monthly.map((x) => x.where)).size).toBe(1);
  });

  it("reports months with no synced orders, instead of passing over them", async () => {
    const { d, ctx, fx } = await tidepool();
    await d.delete(orders).where(eq(orders.tenantId, ctx.tenantId));
    const rec = await reconcileStore({ db: d, ctx, truth: fx.truth, dataset: fx.dataset, ids });
    expect(rec.differences.filter((x) => x.kind === "monthly" && x.actual === null).length).toBe(Object.keys(fx.truth.monthly).length);
  });

  it("reports a count that differs from the dataset", async () => {
    const { d, ctx, fx } = await tidepool();
    const [p] = await d.select().from(products).limit(1);
    await d.delete(products).where(eq(products.id, p!.id));
    const rec = await reconcileStore({ db: d, ctx, truth: fx.truth, dataset: fx.dataset, ids });
    expect(rec.differences.filter((x) => x.kind === "count")).toEqual([expect.objectContaining({ metric: "products", expected: fx.dataset.products.length, actual: fx.dataset.products.length - 1 })]);
  });
});

describe("what it cannot check", () => {
  it("skips checks on products and variants when it has no id map, and says why", async () => {
    const rec = await reconcile("solenne", { ids: undefined });
    expect(rec.differences).toEqual([]);
    expect(rec.skipped.some((s) => /seed journal/.test(s.why))).toBe(true);
    expect(rec.checked.storylineChecks).toBeLessThan((await reconcile("solenne")).checked.storylineChecks);
  });

  it("leaves repeat_rate and zero_sales_days to T12 and lists them as skipped", async () => {
    const rec = await reconcile("solenne");
    expect(rec.skipped.some((s) => /T12/.test(s.why))).toBe(true);
  });
});

describe("idMapFromJournal", () => {
  it("maps generator ids to Shopify ids from the loader's journal", () => {
    const map = idMapFromJournal({
      entries: {
        "product:P_007": { status: "done", shopifyId: "gid://shopify/Product/9001", data: { variants: { V_012: { id: "gid://shopify/ProductVariant/77", inventoryItemId: "x" } } } },
        "order:O_00001": { status: "done", shopifyId: "gid://shopify/Order/1" },
        "product:P_008": { status: "inflight" },
      },
    });
    expect(map.product("P_007")).toBe("gid://shopify/Product/9001");
    expect(map.variant("V_012")).toBe("gid://shopify/ProductVariant/77");
    expect(() => map.product("P_008")).toThrow(/P_008/);
    expect(() => map.variant("V_999")).toThrow(/V_999/);
  });
});

describe("the report", () => {
  const rec: Reconciliation = {
    store: "solenne",
    checked: { months: 14, monthlyValues: 154, storylineChecks: 9, counts: 5 },
    differences: [
      { kind: "monthly", where: "2026-03", metric: "refunds", expected: 5980, actual: 5900 },
      { kind: "monthly", where: "2026-04", metric: "orders", expected: 90, actual: null },
    ],
    skipped: [{ where: "S2 units", why: "needs the seed journal" }],
  };

  it("lists each difference, with its explanation or the word UNEXPLAINED", () => {
    const text = renderStoreSection(rec, [{ store: "solenne", where: "2026-03", metric: "refunds", note: "Refund values differ by Shopify's rounding." }], "2026-11-01");
    expect(text).toContain("Solenne");
    expect(text).toContain("2026-11-01");
    expect(text).toMatch(/2026-03.*refunds.*5980.*5900.*Shopify's rounding/);
    expect(text).toMatch(/2026-04.*orders.*no synced orders.*UNEXPLAINED/);
    expect(text).toContain("1 unexplained");
    expect(text).toContain("needs the seed journal");
  });

  it("says plainly when there are no differences", () => {
    const text = renderStoreSection({ ...rec, differences: [], skipped: [] }, [], "2026-11-01");
    expect(text).toMatch(/no differences/i);
    expect(text).not.toContain("UNEXPLAINED");
  });

  it("replaces only its own store's section and keeps the other's", () => {
    const first = upsertSection(null, "solenne", "SOLENNE ONE");
    const both = upsertSection(first, "tidepool", "TIDEPOOL ONE");
    const again = upsertSection(both, "solenne", "SOLENNE TWO");
    expect(again).toContain("SOLENNE TWO");
    expect(again).not.toContain("SOLENNE ONE");
    expect(again).toContain("TIDEPOOL ONE");
    expect(again.match(/<!-- reconcile:solenne -->/g)).toHaveLength(1);
  });
});
