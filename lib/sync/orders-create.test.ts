import { createHmac } from "node:crypto";
import { count, eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { encryptSecret } from "../crypto/secrets";
import type { Db } from "../db/client";
import { orderLines, orders, shopConnections, tenants, webhookEvents } from "../db/schema";
import { createTestDb } from "../db/test-db";
import { clearWebhookHandlers, handleWebhook } from "../shopify/webhooks";
import type { OrderNode } from "./map";
import { ordersCreateHandler, registerSyncWebhooks } from "./orders-create";
import type { GraphqlFn } from "./sync";

const SECRET = "test-api-secret";
const SHOP = "solenne.myshopify.com";
const money = (amount: string) => ({ shopMoney: { amount } });

const node = (id: number, over: Partial<OrderNode> = {}): OrderNode => ({
  id: `gid://shopify/Order/${id}`,
  name: `#${id}`,
  processedAt: "2026-10-31T10:00:00-04:00",
  createdAt: "2026-10-31T10:00:00-04:00",
  cancelledAt: null,
  tags: ["channel:web"],
  note: null,
  discountCodes: [],
  customer: { id: "gid://shopify/Customer/5" },
  totalDiscountsSet: money("0.00"),
  totalShippingPriceSet: money("0.00"),
  lineItems: {
    pageInfo: { hasNextPage: false },
    nodes: [
      {
        id: `gid://shopify/LineItem/${id}`,
        quantity: 2,
        variant: { id: "gid://shopify/ProductVariant/7", product: { id: "gid://shopify/Product/70" } },
        originalUnitPriceSet: money("28.00"),
        discountAllocations: [],
      },
    ],
  },
  refunds: [],
  ...over,
});

let db: Db;
let tenantId: string;
let fetched: string[];

// A fake Shopify that knows these orders and records which ids were asked for.
const shopify = (known: OrderNode[]): GraphqlFn =>
  (async (_q: string, vars: Record<string, unknown> = {}) => {
    fetched.push(String(vars.id));
    return { order: known.find((o) => o.id === vars.id) ?? null };
  }) as GraphqlFn;

beforeAll(() => {
  process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
});

beforeEach(async () => {
  clearWebhookHandlers();
  fetched = [];
  db = await createTestDb();
  const [t] = await db.insert(tenants).values({ orgId: "org_a", name: "Solenne" }).returning();
  tenantId = t!.id;
  await db.insert(shopConnections).values({
    tenantId,
    shopDomain: SHOP,
    tokenEnc: encryptSecret("shpat_test"),
    scopes: "read_orders",
    timezone: "America/New_York",
    currency: "USD",
  });
});

const ctx = (webhookId = "wh-1") => ({ db, tenantId, shopDomain: SHOP, webhookId });
const countOrders = async () => (await db.select({ n: count() }).from(orders))[0]!.n;

describe("ordersCreateHandler", () => {
  it("fetches the order by its id from Shopify and stores it under the verified tenant", async () => {
    await ordersCreateHandler(ctx(), { admin_graphql_api_id: "gid://shopify/Order/9001", total_price: "999999.00" }, { graphql: shopify([node(9001)]) });
    expect(fetched).toEqual(["gid://shopify/Order/9001"]);
    const [row] = await db.select().from(orders);
    expect(row).toMatchObject({ tenantId, id: "gid://shopify/Order/9001", grossCents: 5600, localDate: "2026-10-31" });
  });

  it("is an idempotent upsert: handling the same order twice leaves one order and one line", async () => {
    const graphql = shopify([node(9001)]);
    const payload = { admin_graphql_api_id: "gid://shopify/Order/9001" };
    await Promise.all([ordersCreateHandler(ctx("wh-a"), payload, { graphql }), ordersCreateHandler(ctx("wh-b"), payload, { graphql })]);
    await ordersCreateHandler(ctx("wh-c"), payload, { graphql });
    expect(await countOrders()).toBe(1);
    expect((await db.select({ n: count() }).from(orderLines))[0]!.n).toBe(1);
  });

  it("rejects a payload without an order id, and one that names something that is not an order", async () => {
    const graphql = shopify([]);
    await expect(ordersCreateHandler(ctx(), { id: 1 }, { graphql })).rejects.toThrow(/order id/i);
    await expect(ordersCreateHandler(ctx(), { admin_graphql_api_id: "gid://shopify/Customer/1" }, { graphql })).rejects.toThrow(/order id/i);
    expect(fetched).toEqual([]);
  });

  it("fails (so Shopify retries) when Shopify cannot return the order yet", async () => {
    await expect(ordersCreateHandler(ctx(), { admin_graphql_api_id: "gid://shopify/Order/404" }, { graphql: shopify([]) })).rejects.toThrow(/not found/i);
    expect(await countOrders()).toBe(0);
  });

  it("refuses a disconnected shop, which holds no token", async () => {
    await db.update(shopConnections).set({ status: "disconnected", tokenEnc: null });
    await expect(ordersCreateHandler(ctx(), { admin_graphql_api_id: "gid://shopify/Order/9001" })).rejects.toMatchObject({ code: "STORE_DISCONNECTED" });
  });
});

describe("orders/create through the webhook route", () => {
  const sign = (body: string) => createHmac("sha256", SECRET).update(body, "utf8").digest("base64");
  const deliver = (webhookId: string, body: unknown) => {
    const rawBody = JSON.stringify(body);
    return handleWebhook({
      db,
      rawBody,
      secret: SECRET,
      headers: new Headers({
        "X-Shopify-Topic": "orders/create",
        "X-Shopify-Shop-Domain": SHOP,
        "X-Shopify-Webhook-Id": webhookId,
        "X-Shopify-Hmac-Sha256": sign(rawBody),
      }),
    });
  };

  it("stores the order once, and a duplicate delivery is a no-op that does not call Shopify again", async () => {
    registerSyncWebhooks({ graphql: shopify([node(9001)]) });
    const body = { admin_graphql_api_id: "gid://shopify/Order/9001" };
    expect(await deliver("wh-1", body)).toEqual({ status: 200 });
    expect(await deliver("wh-1", body)).toEqual({ status: 200 });
    expect(await countOrders()).toBe(1);
    expect(fetched).toHaveLength(1);
    const [ev] = await db.select().from(webhookEvents).where(eq(webhookEvents.webhookId, "wh-1"));
    expect(ev!.processedAt).not.toBeNull();
  });

  it("answers 500 and records the error when the handler fails, so Shopify retries", async () => {
    registerSyncWebhooks({ graphql: shopify([]) });
    expect(await deliver("wh-2", { admin_graphql_api_id: "gid://shopify/Order/404" })).toEqual({ status: 500 });
    const [ev] = await db.select().from(webhookEvents).where(eq(webhookEvents.webhookId, "wh-2"));
    expect(ev).toMatchObject({ processedAt: null });
    expect(ev!.error).toMatch(/not found/i);
  });
});
