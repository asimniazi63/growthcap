import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../db/client";
import { complianceRequests, shopConnections, tenants, webhookEvents } from "../db/schema";
import { createTestDb } from "../db/test-db";
import { clearWebhookHandlers, handleWebhook, onWebhook, type WebhookCtx } from "./webhooks";

const SECRET = "test-api-secret";
const SHOP = "solenne.myshopify.com";

let db: Db;
let tenantId: string;

beforeEach(async () => {
  clearWebhookHandlers();
  db = await createTestDb();
  const [t] = await db.insert(tenants).values({ orgId: "org_a", name: "Solenne" }).returning();
  tenantId = t!.id;
  await db.insert(shopConnections).values({
    tenantId,
    shopDomain: SHOP,
    tokenEnc: { v: 1, iv: "aXY=", tag: "dGFn", data: "ZGF0YQ==" },
    refreshTokenEnc: { v: 1, iv: "aXY=", tag: "dGFn", data: "cmVmcmVzaA==" },
    expiresAt: new Date("2027-01-01T00:00:00Z"),
    scopes: "read_orders",
    timezone: "America/New_York",
    currency: "USD",
  });
});

const sign = (body: string, secret = SECRET) => createHmac("sha256", secret).update(body, "utf8").digest("base64");

function deliver(opts: { topic: string; webhookId?: string; shop?: string; body?: unknown; hmac?: string | null }) {
  const rawBody = JSON.stringify(opts.body ?? { id: 1 });
  const headers = new Headers({
    "X-Shopify-Topic": opts.topic,
    "X-Shopify-Shop-Domain": opts.shop ?? SHOP,
    "X-Shopify-Webhook-Id": opts.webhookId ?? "wh-1",
  });
  if (opts.hmac !== null) headers.set("X-Shopify-Hmac-Sha256", opts.hmac ?? sign(rawBody));
  return handleWebhook({ db, rawBody, headers, secret: SECRET });
}

const events = () => db.select().from(webhookEvents);

describe("verification", () => {
  it("accepts a valid HMAC and records the delivery as processed", async () => {
    expect(await deliver({ topic: "orders/create" })).toEqual({ status: 200 });
    const [e] = await events();
    expect(e).toMatchObject({ webhookId: "wh-1", topic: "orders/create", shopDomain: SHOP, error: null });
    expect(e!.processedAt).not.toBeNull();
  });

  it("rejects a wrong HMAC with 401 and records nothing", async () => {
    expect(await deliver({ topic: "app/uninstalled", hmac: sign("{}", "another-secret") })).toEqual({ status: 401 });
    expect(await events()).toEqual([]);
    const [conn] = await db.select().from(shopConnections);
    expect(conn!.status).toBe("connected");
  });

  it("rejects a missing HMAC, and an HMAC of a different body, with 401", async () => {
    expect(await deliver({ topic: "orders/create", hmac: null })).toEqual({ status: 401 });
    expect(await deliver({ topic: "orders/create", hmac: sign('{"id":2}') })).toEqual({ status: 401 });
    expect(await events()).toEqual([]);
  });

  it("rejects an HMAC that is not valid base64 of the right length, without throwing", async () => {
    expect(await deliver({ topic: "orders/create", hmac: "short" })).toEqual({ status: 401 });
  });

  it("answers 400 to a verified delivery that lacks the topic, shop or webhook id headers", async () => {
    const rawBody = "{}";
    const headers = new Headers({ "X-Shopify-Hmac-Sha256": sign(rawBody), "X-Shopify-Topic": "orders/create" });
    expect(await handleWebhook({ db, rawBody, headers, secret: SECRET })).toEqual({ status: 400 });
  });

  it("answers 400 to a verified delivery whose body is not JSON", async () => {
    const rawBody = "not json";
    const headers = new Headers({
      "X-Shopify-Hmac-Sha256": sign(rawBody),
      "X-Shopify-Topic": "orders/create",
      "X-Shopify-Shop-Domain": SHOP,
      "X-Shopify-Webhook-Id": "wh-bad",
    });
    expect(await handleWebhook({ db, rawBody, headers, secret: SECRET })).toEqual({ status: 400 });
  });
});

describe("handlers and idempotency", () => {
  it("runs the registered handler with the tenant resolved from the verified shop header, never from the payload", async () => {
    const seen: { ctx: WebhookCtx; payload: unknown }[] = [];
    onWebhook("orders/create", async (ctx, payload) => void seen.push({ ctx, payload }));
    await deliver({ topic: "orders/create", webhookId: "wh-7", body: { id: 5, shop_domain: "evil.myshopify.com" } });
    expect(seen).toEqual([{ ctx: { db, tenantId, shopDomain: SHOP, webhookId: "wh-7" }, payload: { id: 5, shop_domain: "evil.myshopify.com" } }]);
  });

  it("does not run a handler for a shop that isn't connected, and still answers 200 so Shopify stops retrying", async () => {
    let calls = 0;
    onWebhook("orders/create", async () => void calls++);
    expect(await deliver({ topic: "orders/create", shop: "stranger.myshopify.com" })).toEqual({ status: 200 });
    expect(calls).toBe(0);
  });

  it("skips a repeated delivery that was already processed", async () => {
    let calls = 0;
    onWebhook("orders/create", async () => void calls++);
    expect(await deliver({ topic: "orders/create", webhookId: "wh-1" })).toEqual({ status: 200 });
    expect(await deliver({ topic: "orders/create", webhookId: "wh-1" })).toEqual({ status: 200 });
    expect(calls).toBe(1);
    expect(await events()).toHaveLength(1);
  });

  it("answers 500 and records the error when the handler fails, then processes the retry", async () => {
    let calls = 0;
    onWebhook("orders/create", async () => {
      calls++;
      if (calls === 1) throw new Error("database was down");
    });
    expect(await deliver({ topic: "orders/create", webhookId: "wh-9" })).toEqual({ status: 500 });
    const [failed] = await events();
    expect(failed).toMatchObject({ webhookId: "wh-9", error: "database was down", processedAt: null });

    expect(await deliver({ topic: "orders/create", webhookId: "wh-9" })).toEqual({ status: 200 });
    expect(calls).toBe(2);
    const [retried] = await events();
    expect(retried).toMatchObject({ webhookId: "wh-9", error: null });
    expect(retried!.processedAt).not.toBeNull();
    expect(await events()).toHaveLength(1);
  });

  it("records a topic nobody handles as processed and answers 200", async () => {
    expect(await deliver({ topic: "products/update", webhookId: "wh-2" })).toEqual({ status: 200 });
    expect((await events())[0]!.processedAt).not.toBeNull();
  });
});

describe("app/uninstalled", () => {
  it("disconnects the shop and clears its tokens, leaving the row for history", async () => {
    expect(await deliver({ topic: "app/uninstalled" })).toEqual({ status: 200 });
    const [conn] = await db.select().from(shopConnections);
    expect(conn).toMatchObject({ shopDomain: SHOP, status: "disconnected", tokenEnc: null, refreshTokenEnc: null, expiresAt: null });
  });

  it("only touches the shop named in the verified header, whatever the payload says", async () => {
    const [other] = await db.insert(tenants).values({ orgId: "org_b", name: "Tidepool" }).returning();
    await db.insert(shopConnections).values({
      tenantId: other!.id,
      shopDomain: "tidepool.myshopify.com",
      tokenEnc: { v: 1, iv: "aXY=", tag: "dGFn", data: "ZGF0YQ==" },
      timezone: "America/Los_Angeles",
      currency: "USD",
    });
    await deliver({ topic: "app/uninstalled", body: { myshopify_domain: "tidepool.myshopify.com" } });
    const tidepool = await db.select().from(shopConnections).where(eq(shopConnections.shopDomain, "tidepool.myshopify.com"));
    expect(tidepool[0]).toMatchObject({ status: "connected" });
    expect(tidepool[0]!.tokenEnc).not.toBeNull();
  });

  it("lets the tenant connect again afterwards: the disconnected row doesn't block a new connected one", async () => {
    await deliver({ topic: "app/uninstalled" });
    await db.insert(shopConnections).values({ tenantId, shopDomain: "solenne-new.myshopify.com", timezone: "America/New_York", currency: "USD" });
    expect(await db.select().from(shopConnections)).toHaveLength(2);
  });
});

describe("compliance topics", () => {
  it.each(["customers/data_request", "customers/redact", "shop/redact"])("%s returns 200 and writes a compliance_requests row", async (topic) => {
    expect(await deliver({ topic, webhookId: `wh-${topic}` })).toEqual({ status: 200 });
    const rows = await db.select().from(complianceRequests);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ shopDomain: SHOP, topic });
  });

  it("works for a shop that has no connection or tenant yet", async () => {
    expect(await deliver({ topic: "shop/redact", shop: "never-connected.myshopify.com", webhookId: "wh-x" })).toEqual({ status: 200 });
    expect(await db.select().from(complianceRequests)).toMatchObject([{ shopDomain: "never-connected.myshopify.com", topic: "shop/redact" }]);
  });

  it("writes one row for a delivery that Shopify repeats", async () => {
    await deliver({ topic: "customers/redact", webhookId: "wh-same" });
    await deliver({ topic: "customers/redact", webhookId: "wh-same" });
    expect(await db.select().from(complianceRequests)).toHaveLength(1);
  });
});
