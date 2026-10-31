import { createHmac, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { complianceRequests, shopConnections, webhookEvents } from "../db/schema";

export interface WebhookCtx {
  tenantId: string;
  shopDomain: string;
  webhookId: string;
}

export type WebhookHandler = (ctx: WebhookCtx, payload: unknown) => Promise<void>;

const handlers = new Map<string, WebhookHandler[]>();

// Registers a handler for a topic such as "orders/create". The handler runs only for a delivery whose HMAC verified,
// and its tenant comes from the verified shop domain, never from the payload.
export function onWebhook(topic: string, handler: WebhookHandler): void {
  handlers.set(topic, [...(handlers.get(topic) ?? []), handler]);
}

// For tests: forget every registered handler.
export function clearWebhookHandlers(): void {
  handlers.clear();
}

// The topics Shopify requires every app to answer. We hold no personal data, so they are recorded and nothing more.
const COMPLIANCE_TOPICS = new Set(["customers/data_request", "customers/redact", "shop/redact"]);

// Shopify signs the raw body with the app's client secret: base64(HMAC-SHA256(body)).
function hmacIsValid(rawBody: string, header: string | null, secret: string): boolean {
  if (!header) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest();
  const given = Buffer.from(header, "base64");
  // Re-encoding rejects headers that only decode to the right bytes by ignoring stray characters.
  if (given.length !== expected.length || given.toString("base64") !== header) return false;
  return timingSafeEqual(given, expected);
}

export interface HandleWebhookInput {
  db: Db;
  rawBody: string;
  headers: Pick<Headers, "get">;
  secret: string;
}

export async function handleWebhook({ db, rawBody, headers, secret }: HandleWebhookInput): Promise<{ status: number }> {
  if (!hmacIsValid(rawBody, headers.get("x-shopify-hmac-sha256"), secret)) return { status: 401 };

  const topic = headers.get("x-shopify-topic");
  const shopDomain = headers.get("x-shopify-shop-domain")?.toLowerCase();
  const webhookId = headers.get("x-shopify-webhook-id");
  if (!topic || !shopDomain || !webhookId) return { status: 400 };

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return { status: 400 };
  }

  // Idempotency: a delivery that was processed is skipped. One whose handler failed has processed_at unset,
  // so Shopify's retry is processed again.
  await db.insert(webhookEvents).values({ webhookId, topic, shopDomain }).onConflictDoNothing({ target: webhookEvents.webhookId });
  const [event] = await db.select().from(webhookEvents).where(eq(webhookEvents.webhookId, webhookId)).limit(1);
  if (event?.processedAt) return { status: 200 };

  const markProcessed = (tx: Pick<Db, "update">) =>
    tx.update(webhookEvents).set({ processedAt: new Date(), error: null }).where(eq(webhookEvents.webhookId, webhookId));

  try {
    if (COMPLIANCE_TOPICS.has(topic)) {
      // Works for a shop with no tenant yet. The row and the "processed" mark go together, so a retry can't double it.
      await db.transaction(async (tx) => {
        await tx.insert(complianceRequests).values({ shopDomain, topic });
        await markProcessed(tx);
      });
      return { status: 200 };
    }

    const [connection] = await db
      .select({ tenantId: shopConnections.tenantId })
      .from(shopConnections)
      .where(eq(shopConnections.shopDomain, shopDomain))
      .limit(1);

    // A shop we don't know has nothing to update or process. Answer 200 so Shopify stops retrying.
    if (connection) {
      if (topic === "app/uninstalled") {
        await db
          .update(shopConnections)
          .set({ status: "disconnected", tokenEnc: null, refreshTokenEnc: null, expiresAt: null, updatedAt: new Date() })
          .where(eq(shopConnections.shopDomain, shopDomain));
      }
      for (const handler of handlers.get(topic) ?? []) {
        await handler({ tenantId: connection.tenantId, shopDomain, webhookId }, payload);
      }
    }
    await markProcessed(db);
    return { status: 200 };
  } catch (e) {
    await db
      .update(webhookEvents)
      .set({ error: e instanceof Error ? e.message : String(e) })
      .where(eq(webhookEvents.webhookId, webhookId));
    return { status: 500 };
  }
}
