import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { count, eq, is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../db/client";
import * as schema from "../db/schema";
import { createTestDb } from "../db/test-db";
import { pseudonymFor, type OrderNode, type ProductNode } from "./map";
import { SYNC_ORDER, SYNC_ORDERS, SYNC_PRODUCTS } from "./queries";
import { syncStore, type GraphqlFn } from "./sync";

const money = (amount: string) => ({ shopMoney: { amount } });
const TZ = "America/New_York";

const order = (n: number, over: Partial<OrderNode> = {}): OrderNode => ({
  id: `gid://shopify/Order/${n}`,
  name: `#${n}`,
  processedAt: `2026-03-0${(n % 9) + 1}T12:00:00-05:00`,
  createdAt: "2026-10-31T12:00:00Z",
  cancelledAt: null,
  tags: ["channel:web"],
  note: null,
  discountCodes: [],
  customer: { id: `gid://shopify/Customer/${n % 3}` },
  totalDiscountsSet: money("0.00"),
  totalShippingPriceSet: money("5.00"),
  lineItems: {
    pageInfo: { hasNextPage: false },
    nodes: [
      {
        id: `gid://shopify/LineItem/${n}`,
        quantity: 1,
        variant: { id: "gid://shopify/ProductVariant/7", product: { id: "gid://shopify/Product/70" } },
        originalUnitPriceSet: money("28.00"),
        discountAllocations: [],
      },
    ],
  },
  refunds: [],
  ...over,
});

const product: ProductNode = {
  id: "gid://shopify/Product/70",
  title: "Fig candle",
  handle: "fig-candle",
  status: "ACTIVE",
  description: "Warm",
  tags: [],
  variants: {
    pageInfo: { hasNextPage: false },
    nodes: [
      {
        id: "gid://shopify/ProductVariant/7",
        sku: "FIG",
        title: "Default Title",
        price: "28.00",
        inventoryItem: {
          unitCost: { amount: "9.00" },
          inventoryLevels: { nodes: [{ location: { id: "gid://shopify/Location/1" }, quantities: [{ name: "available", quantity: 12 }] }] },
        },
      },
    ],
  },
};

// A fake Admin API: products in one page, orders in pages of the given size.
function fakeShopify(orders: OrderNode[], pageSize = 2): { graphql: GraphqlFn; calls: string[] } {
  const calls: string[] = [];
  const graphql: GraphqlFn = async <T>(query: string, variables: Record<string, unknown> = {}) => {
    calls.push(query.match(/query (\w+)/)?.[1] ?? "?");
    if (query.includes("SyncProducts")) {
      return { products: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [product] } } as T;
    }
    const start = Number(variables.after ?? 0);
    const nodes = orders.slice(start, start + pageSize);
    const next = start + pageSize;
    return { orders: { pageInfo: { hasNextPage: next < orders.length, endCursor: String(next) }, nodes } } as T;
  };
  return { graphql, calls };
}

let db: Db;
let a: string;
let b: string;

beforeEach(async () => {
  db = await createTestDb();
  const rows = await db
    .insert(schema.tenants)
    .values([
      { orgId: "org_a", name: "A" },
      { orgId: "org_b", name: "B" },
    ])
    .returning();
  a = rows[0]!.id;
  b = rows[1]!.id;
});

const total = async (table: Parameters<Db["select"]>[0] extends never ? never : typeof schema.orders, tenantId: string) =>
  (await db.select({ n: count() }).from(table).where(eq(table.tenantId, tenantId)))[0]!.n;

describe("syncStore", () => {
  it("pages through products and orders, stores them under the tenant, and records a succeeded run", async () => {
    const orders = [1, 2, 3, 4, 5].map((n) => order(n));
    const { graphql, calls } = fakeShopify(orders);
    const run = await syncStore({ db, tenantId: a, timezone: TZ, graphql });

    expect(calls.filter((c) => c === "SyncOrders")).toHaveLength(3); // 2 + 2 + 1
    expect(await total(schema.orders, a)).toBe(5);
    expect((await db.select({ n: count() }).from(schema.orderLines).where(eq(schema.orderLines.tenantId, a)))[0]!.n).toBe(5);
    expect((await db.select({ n: count() }).from(schema.variants).where(eq(schema.variants.tenantId, a)))[0]!.n).toBe(1);
    expect((await db.select({ n: count() }).from(schema.inventoryLevels).where(eq(schema.inventoryLevels.tenantId, a)))[0]!.n).toBe(1);
    expect((await db.select({ n: count() }).from(schema.customers).where(eq(schema.customers.tenantId, a)))[0]!.n).toBe(3);

    const [row] = await db.select().from(schema.syncRuns).where(eq(schema.syncRuns.id, run.runId));
    expect(row).toMatchObject({ tenantId: a, status: "succeeded", counts: { products: 1, orders: 5 } });
    expect(row!.finishedAt).not.toBeNull();
  });

  it("is idempotent: a second sync of the same data changes no counts", async () => {
    const orders = [1, 2, 3].map((n) => order(n, { refunds: n === 1 ? [{ id: "gid://shopify/Refund/1", processedAt: "2026-03-12T09:00:00-04:00", refundLineItems: { pageInfo: { hasNextPage: false }, nodes: [{ id: "gid://shopify/RefundLineItem/1", quantity: 1, lineItem: { id: "gid://shopify/LineItem/1" }, subtotalSet: money("28.00") }] } }] : [] }));
    const { graphql } = fakeShopify(orders);
    await syncStore({ db, tenantId: a, timezone: TZ, graphql });
    await syncStore({ db, tenantId: a, timezone: TZ, graphql });
    expect(await total(schema.orders, a)).toBe(3);
    expect((await db.select({ n: count() }).from(schema.refunds).where(eq(schema.refunds.tenantId, a)))[0]!.n).toBe(1);
    expect((await db.select({ n: count() }).from(schema.refundLines).where(eq(schema.refundLines.tenantId, a)))[0]!.n).toBe(1);
    expect((await db.select({ n: count() }).from(schema.orderLines).where(eq(schema.orderLines.tenantId, a)))[0]!.n).toBe(3);
  });

  it("copes with one page holding several orders of the same customer, and keeps the earliest first order", async () => {
    // Orders 1 and 4 share a customer (n % 3), and so do 2 and 5, all in one page of five.
    const orders = [1, 2, 3, 4, 5].map((n) => order(n, { processedAt: `2026-03-0${6 - n}T12:00:00-05:00` }));
    await syncStore({ db, tenantId: a, timezone: TZ, graphql: fakeShopify(orders, 5).graphql });
    expect(await total(schema.orders, a)).toBe(5);
    const custs = await db.select().from(schema.customers).where(eq(schema.customers.tenantId, a));
    expect(custs).toHaveLength(3);
    const dateOf = (n: number) => new Date(`2026-03-0${6 - n}T12:00:00-05:00`).getTime();
    const customerOf = (n: number) => pseudonymFor(a, `gid://shopify/Customer/${n % 3}`);
    for (const n of [1, 2, 3]) {
      const earliest = Math.min(dateOf(n), dateOf(n + 3 <= 5 ? n + 3 : n));
      expect(custs.find((c) => c.id === customerOf(n))!.firstSeenAt.getTime()).toBe(earliest);
    }
  });

  it("updates an order that changed in Shopify", async () => {
    await syncStore({ db, tenantId: a, timezone: TZ, graphql: fakeShopify([order(1)]).graphql });
    await syncStore({ db, tenantId: a, timezone: TZ, graphql: fakeShopify([order(1, { cancelledAt: "2026-03-05T00:00:00Z", note: "changed" })]).graphql });
    const [row] = await db.select().from(schema.orders).where(eq(schema.orders.tenantId, a));
    expect(row).toMatchObject({ note: "changed" });
    expect(row!.cancelledAt).not.toBeNull();
  });

  it("never deletes an order that Shopify stops returning (the 60-day window)", async () => {
    await syncStore({ db, tenantId: a, timezone: TZ, graphql: fakeShopify([order(1), order(2), order(3)]).graphql });
    await syncStore({ db, tenantId: a, timezone: TZ, graphql: fakeShopify([order(3)]).graphql });
    expect(await total(schema.orders, a)).toBe(3);
  });

  it("keeps two tenants' rows apart", async () => {
    await syncStore({ db, tenantId: a, timezone: TZ, graphql: fakeShopify([order(1), order(2)]).graphql });
    await syncStore({ db, tenantId: b, timezone: TZ, graphql: fakeShopify([order(1)]).graphql });
    expect(await total(schema.orders, a)).toBe(2);
    expect(await total(schema.orders, b)).toBe(1);
    const mine = await db.select().from(schema.customers).where(eq(schema.customers.tenantId, a));
    const theirs = await db.select().from(schema.customers).where(eq(schema.customers.tenantId, b));
    expect(mine.map((c) => c.id).filter((id) => theirs.some((t) => t.id === id))).toEqual([]);
  });

  it("marks the run failed with the reason when Shopify fails, and keeps the pages already stored", async () => {
    const good = fakeShopify([1, 2, 3, 4].map((n) => order(n))).graphql;
    let orderCalls = 0;
    const graphql: GraphqlFn = async <T>(q: string, v?: Record<string, unknown>) => {
      if (q.includes("SyncOrders") && ++orderCalls === 2) throw new Error("Shopify is unavailable");
      return good<T>(q, v);
    };
    await expect(syncStore({ db, tenantId: a, timezone: TZ, graphql })).rejects.toThrow("Shopify is unavailable");
    const [row] = await db.select().from(schema.syncRuns).where(eq(schema.syncRuns.tenantId, a));
    expect(row).toMatchObject({ status: "failed", error: "Shopify is unavailable" });
    expect(await total(schema.orders, a)).toBe(2);
  });
});

describe("scopes", () => {
  it("the sync queries ask for no field that needs a scope the app was not granted (a location's name needs read_locations)", () => {
    for (const q of [SYNC_PRODUCTS, SYNC_ORDERS, SYNC_ORDER]) {
      expect(q).not.toMatch(/location\s*\{[^}]*\bname\b/);
      expect(q).not.toMatch(/\blocations\b/);
    }
  });
});

describe("personal data", () => {
  const PERSONAL = /(^|_)(name|email|phone|address|first_name|last_name|street|zip|postal)(_|$)/;

  it("no table has a name, email, phone or address column (only titles and order numbers)", () => {
    const allowed = new Set(["products.title", "variants.title", "orders.name", "inventory_levels.location_name", "tenants.name"]);
    const tables = (Object.values(schema) as unknown[]).filter((t) => is(t, PgTable)) as PgTable[];
    const cols = tables.flatMap((t) => {
      const cfg = getTableConfig(t);
      return cfg.columns.map((c) => `${cfg.name}.${c.name}`);
    });
    expect(cols.length).toBeGreaterThan(40);
    expect(cols.filter((c) => PERSONAL.test(c.split(".")[1]!) && !allowed.has(c))).toEqual([]);
  });

  it("no GraphQL document in lib/sync or lib/shopify asks for a personal field", () => {
    const dirs = ["../sync", "../shopify"].map((d) => fileURLToPath(new URL(d, import.meta.url)));
    const docs = dirs.flatMap((d) => readdirSync(d).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts")).map((f) => readFileSync(`${d}/${f}`, "utf8")));
    const forbidden = /\b(email|phone|firstName|lastName|displayName|defaultAddress|shippingAddress|billingAddress|addresses)\b/;
    // Only the GraphQL template strings are scanned.
    const gql = docs.flatMap((src) => [...src.matchAll(/`([^`]*\b(?:query|mutation)\s+\w+[^`]*)`/g)].map((m) => m[1]!));
    expect(gql.length).toBeGreaterThan(0);
    for (const q of gql) expect(q).not.toMatch(forbidden);
  });
});
