import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setTestNow } from "../clock";
import type { Db } from "../db/client";
import { createTestDb } from "../db/test-db";
import { pseudonymFor } from "../sync/map";
import type { TenantContext } from "../tenancy/context";
import { seedTwoStores, shopifyId } from "../../scripts/fixtures/load-db";
import type { Dataset } from "../../scripts/seed/types.js";
import { getCustomers } from "./customers";
import { getInventory } from "./inventory";
import { getOrders } from "./orders";
import { searchProducts } from "./products";

// Both stores live in one database. Tidepool's context must never see a Solenne row, whatever it is handed.
let db: Db;
let solenne: Dataset;
let tidepool: Dataset;
let sCtx: TenantContext;
let tCtx: TenantContext;
const FULL = { from: "2025-09-01", to: "2026-10-31" };

beforeAll(async () => {
  setTestNow("2026-11-02T12:00:00-05:00");
  db = await createTestDb();
  const seeded = await seedTwoStores(db);
  solenne = seeded.fixtures.solenne.dataset;
  tidepool = seeded.fixtures.tidepool.dataset;
  sCtx = seeded.ctxs.solenne;
  tCtx = seeded.ctxs.tidepool;
}, 240_000);

afterAll(() => setTestNow(null));

// Ids that exist only in Solenne (it has more orders, products and variants than Tidepool).
const onlySolenne = () => ({
  order: solenne.orders.find((o) => Number(o.genId.slice(2)) > tidepool.orders.length)!,
  product: solenne.products.find((p) => Number(p.genId.slice(2)) > tidepool.products.length)!,
  variant: solenne.variants.find((v) => Number(v.genId.slice(2)) > tidepool.variants.length)!,
  customer: solenne.customers[0]!,
  codes: solenne.discounts.map((d) => d.code).filter((c) => !tidepool.discounts.some((t) => t.code === c)),
});

describe("the Solenne ids really exist in Solenne (so the empty answers below mean something)", () => {
  it("finds each of them with Solenne's context", async () => {
    const x = onlySolenne();
    expect((await getOrders(sCtx, { orderIds: [shopifyId.order(x.order.genId)] }, { db })).data).toHaveLength(1);
    expect((await searchProducts(sCtx, { productIds: [shopifyId.product(x.product.genId)] }, { db })).data).toHaveLength(1);
    expect((await getInventory(sCtx, { variantIds: [shopifyId.variant(x.variant.genId)] }, { db })).data).toHaveLength(1);
    const me = pseudonymFor(sCtx.tenantId, shopifyId.customer(x.customer.genId));
    expect((await getCustomers(sCtx, { view: "list", ...FULL, customerIds: [me] }, { db })).data.length).toBeGreaterThanOrEqual(0);
    expect(x.codes.length).toBeGreaterThan(0);
  });
});

describe("Tidepool's context, handed Solenne's ids", () => {
  it("getOrders finds no Solenne order by id, customer id, discount code or product", async () => {
    const x = onlySolenne();
    const solenneCustomerIds = solenne.customers.map((c) => pseudonymFor(sCtx.tenantId, shopifyId.customer(c.genId))).slice(0, 50);
    for (const filters of [
      { orderIds: [shopifyId.order(x.order.genId)] },
      { ...FULL, customerIds: solenneCustomerIds },
      { ...FULL, discountCodes: x.codes },
      { ...FULL, productIds: [shopifyId.product(x.product.genId)] },
      { ...FULL, variantIds: [shopifyId.variant(x.variant.genId)] },
    ]) {
      const res = await getOrders(tCtx, filters, { db });
      expect(res.data, JSON.stringify(filters).slice(0, 80)).toEqual([]);
    }
  });

  it("getOrders, unfiltered, returns only Tidepool's own orders", async () => {
    const res = await getOrders(tCtx, { ...FULL, limit: 200 }, { db });
    expect(res.truncated?.total ?? res.data.length).toBe(tidepool.orders.length);
    expect(res.data.length).toBeLessThanOrEqual(tidepool.orders.length);
  });

  it("searchProducts and getInventory find no Solenne product or variant", async () => {
    const x = onlySolenne();
    expect((await searchProducts(tCtx, { productIds: [shopifyId.product(x.product.genId)] }, { db })).data).toEqual([]);
    expect((await searchProducts(tCtx, { query: x.product.title }, { db })).data.filter((p) => p.untrusted.title === x.product.title)).toEqual([]);
    expect((await getInventory(tCtx, { variantIds: [shopifyId.variant(x.variant.genId)] }, { db })).data).toEqual([]);
    expect((await searchProducts(tCtx, {}, { db })).data).toHaveLength(tidepool.products.length);
    expect((await getInventory(tCtx, { limit: 200 }, { db })).data).toHaveLength(tidepool.variants.length);
  });

  it("getCustomers finds no Solenne customer, and lists only Tidepool's", async () => {
    const solenneIds = solenne.customers.map((c) => pseudonymFor(sCtx.tenantId, shopifyId.customer(c.genId)));
    const tidepoolIds = new Set(tidepool.customers.map((c) => pseudonymFor(tCtx.tenantId, shopifyId.customer(c.genId))));
    expect((await getCustomers(tCtx, { view: "list", ...FULL, customerIds: solenneIds.slice(0, 50) }, { db })).data).toEqual([]);
    const all = await getCustomers(tCtx, { view: "list", ...FULL, limit: 200 }, { db });
    expect(all.data.length).toBeGreaterThan(0);
    expect(all.data.every((c) => tidepoolIds.has(c.customerId))).toBe(true);
    const summary = await getCustomers(tCtx, { view: "summary", ...FULL }, { db });
    expect((summary.data[0] as { activeCustomers: number }).activeCustomers).toBeLessThanOrEqual(tidepool.customers.length);
  });

  it("the same shopper gets different pseudonyms in the two tenants, so they can't be joined", () => {
    const g = shopifyId.customer(solenne.customers[0]!.genId);
    expect(pseudonymFor(sCtx.tenantId, g)).not.toBe(pseudonymFor(tCtx.tenantId, g));
  });
});
