// Loads a seed dataset (fixtures/<store>/dataset.json) into a database as one tenant, through the same code path
// production uses: the dataset is served as Admin GraphQL nodes by a fake Shopify and read by syncStore. So the
// metric tests exercise the sync and the mappers as well as the metric queries.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Db } from "../../lib/db/client";
import { tenants } from "../../lib/db/schema";
import type { TenantContext } from "../../lib/tenancy/context";
import type { OrderNode, ProductNode } from "../../lib/sync/map";
import { syncStore, type GraphqlFn } from "../../lib/sync/sync";
import { allocate, roundHalfUp } from "../seed/money.js";
import { STORES } from "../seed/stores.js";
import type { Dataset, StoreKey, Truth } from "../seed/types.js";

export function readFixture(store: StoreKey): { dataset: Dataset; truth: Truth } {
  const read = (name: string) => JSON.parse(readFileSync(fileURLToPath(new URL(`../../fixtures/${store}/${name}`, import.meta.url)), "utf8"));
  return { dataset: read("dataset.json") as Dataset, truth: read("truth.json") as Truth };
}

const num = (genId: string) => (genId.startsWith("CUST_") ? parseInt(genId.slice(5), 16) : Number(genId.replace(/\D/g, "")));
const gid = (kind: string, n: number) => `gid://shopify/${kind}/${n}`;
const money = (cents: number) => ({ shopMoney: { amount: `${Math.trunc(cents / 100)}.${String(cents % 100).padStart(2, "0")}` } });

// The Shopify id a generator id gets in the fake store, so tests can turn a truth.json filter into a real one.
export const shopifyId = {
  product: (genId: string) => gid("Product", num(genId)),
  variant: (genId: string) => gid("ProductVariant", num(genId)),
  order: (genId: string) => gid("Order", num(genId)),
  customer: (genId: string) => gid("Customer", num(genId)),
};

function orderNodes(ds: Dataset): OrderNode[] {
  const byOrder = new Map(ds.orders.map((o) => [o.genId, o]));
  const refundsByOrder = new Map<string, Dataset["refunds"]>();
  for (const r of ds.refunds) refundsByOrder.set(r.orderGenId, [...(refundsByOrder.get(r.orderGenId) ?? []), r]);

  return ds.orders.map((o) => {
    const n = num(o.genId);
    const alloc = allocate(o.discountCents, o.lines.map((l) => l.qty * l.unitPrice));
    const lineId = (i: number) => gid("LineItem", n * 100 + i);
    const variants = new Map(ds.variants.map((v) => [v.genId, v]));
    return {
      id: gid("Order", n),
      name: `#${1000 + n}`,
      processedAt: o.processedAt,
      createdAt: "2026-10-31T12:00:00Z", // the import time, as in the real store
      cancelledAt: null,
      tags: o.tags,
      note: o.note ?? null,
      discountCodes: o.discountCode ? [o.discountCode] : [],
      customer: { id: gid("Customer", num(o.customerGenId)) },
      totalDiscountsSet: money(o.discountCents),
      totalShippingPriceSet: money(o.shipping),
      lineItems: {
        pageInfo: { hasNextPage: false },
        nodes: o.lines.map((l, i) => ({
          id: lineId(i),
          quantity: l.qty,
          variant: { id: shopifyId.variant(l.variantGenId), product: { id: shopifyId.product(variants.get(l.variantGenId)!.productGenId) } },
          originalUnitPriceSet: money(l.unitPrice),
          discountAllocations: alloc[i] ? [{ allocatedAmountSet: money(alloc[i]!) }] : [],
        })),
      },
      refunds: (refundsByOrder.get(o.genId) ?? []).map((r) => ({
        id: gid("Refund", num(r.genId)),
        processedAt: r.processedAt,
        refundLineItems: {
          pageInfo: { hasNextPage: false },
          nodes: r.lines.map((rl, j) => {
            const i = byOrder.get(r.orderGenId)!.lines.findIndex((l) => l.variantGenId === rl.variantGenId);
            const l = o.lines[i]!;
            const net = l.qty * l.unitPrice - (alloc[i] ?? 0);
            return {
              id: gid("RefundLineItem", num(r.genId) * 100 + j),
              quantity: rl.qty,
              lineItem: { id: lineId(i) },
              subtotalSet: money(rl.qty === l.qty ? net : roundHalfUp((net * rl.qty) / l.qty)),
            };
          }),
        },
      })),
    };
  });
}

function productNodes(ds: Dataset): ProductNode[] {
  const locations = new Map(ds.locations.map((l) => [l.genId, l.name]));
  return ds.products.map((p) => ({
    id: shopifyId.product(p.genId),
    title: p.title,
    handle: p.genId.toLowerCase(),
    status: "ACTIVE",
    description: p.description,
    tags: [],
    variants: {
      pageInfo: { hasNextPage: false },
      nodes: ds.variants
        .filter((v) => v.productGenId === p.genId)
        .map((v) => ({
          id: shopifyId.variant(v.genId),
          sku: v.sku,
          title: v.title,
          price: money(v.price).shopMoney.amount,
          inventoryItem: {
            unitCost: money(v.unitCost).shopMoney,
            inventoryLevels: {
              nodes: ds.inventory
                .filter((i) => i.variantGenId === v.genId)
                .map((i) => ({
                  location: { id: gid("Location", num(i.locationGenId)), name: locations.get(i.locationGenId) ?? "" },
                  quantities: [{ name: "available", quantity: i.available }],
                })),
            },
          },
        })),
    },
  }));
}

// A fake Admin API holding the whole dataset: products 5 to a page, orders 10 to a page, like the real queries.
export function fakeShopifyFor(ds: Dataset): GraphqlFn {
  const products = productNodes(ds);
  const orders = orderNodes(ds);
  const page = <T>(all: T[], size: number, after: unknown) => {
    const start = Number(after ?? 0);
    const end = start + size;
    return { pageInfo: { hasNextPage: end < all.length, endCursor: String(end) }, nodes: all.slice(start, end) };
  };
  return (async (query: string, variables: Record<string, unknown> = {}) => {
    if (query.includes("query SyncProducts")) return { products: page(products, 5, variables.after) };
    if (query.includes("query SyncOrders")) return { orders: page(orders, 10, variables.after) };
    if (query.includes("query SyncOrder(")) return { order: orders.find((o) => o.id === variables.id) ?? null };
    throw new Error(`The fake Shopify doesn't answer: ${query.slice(0, 40)}`);
  }) as GraphqlFn;
}

export async function loadDataset(db: Db, tenantId: string, store: StoreKey, ds: Dataset): Promise<void> {
  await syncStore({ db, tenantId, timezone: STORES[store].timezone, graphql: fakeShopifyFor(ds) });
}

// Both stores in one database as two tenants, each with a connected-store context, as the tool tests need.
export async function seedTwoStores(db: Db) {
  const fixtures = {} as Record<StoreKey, { dataset: Dataset; truth: Truth }>;
  const ctxs = {} as Record<StoreKey, TenantContext>;
  for (const store of ["solenne", "tidepool"] as const) {
    const [t] = await db.insert(tenants).values({ orgId: `org_${store}`, name: STORES[store].name }).returning();
    fixtures[store] = readFixture(store);
    await loadDataset(db, t!.id, store, fixtures[store].dataset);
    ctxs[store] = {
      tenantId: t!.id,
      orgId: `org_${store}`,
      userId: "user_test",
      role: "gc_admin",
      shop: { domain: `${store}.myshopify.com`, timezone: STORES[store].timezone, currency: "USD", status: "connected" },
    };
  }
  return { fixtures, ctxs };
}
