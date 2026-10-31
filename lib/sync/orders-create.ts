import { and, eq } from "drizzle-orm";
import { decryptSecret } from "../crypto/secrets";
import { AppError } from "../errors";
import { shopConnections } from "../db/schema";
import { shopifyGraphql } from "../shopify/client";
import { onWebhook, type WebhookCtx } from "../shopify/webhooks";
import { mapOrder, type OrderNode } from "./map";
import { SYNC_ORDER } from "./queries";
import { upsertOrder, type GraphqlFn } from "./sync";

const ORDER_GID = /^gid:\/\/shopify\/Order\/\d+$/;

export interface OrdersCreateDeps {
  graphql?: GraphqlFn; // tests inject a fake Shopify
}

// orders/create: the tenant is the one the verified shop domain maps to (ctx), never anything in the payload.
// The payload is REST-shaped and not used for values: only its order id is, and the order is fetched again from
// Shopify so it is stored in the same shape as a synced one. The write is an upsert, so a duplicate or concurrent
// delivery repeats the same write. Throwing makes the route answer 500, and Shopify retries.
export async function ordersCreateHandler(ctx: WebhookCtx, payload: unknown, deps: OrdersCreateDeps = {}): Promise<void> {
  const gid = payload && typeof payload === "object" && "admin_graphql_api_id" in payload ? payload.admin_graphql_api_id : undefined;
  if (typeof gid !== "string" || !ORDER_GID.test(gid)) throw new Error("orders/create payload has no valid order id");

  const [conn] = await ctx.db
    .select()
    .from(shopConnections)
    .where(and(eq(shopConnections.tenantId, ctx.tenantId), eq(shopConnections.shopDomain, ctx.shopDomain)))
    .limit(1);
  if (!conn || conn.status !== "connected" || !conn.tokenEnc) {
    throw new AppError("STORE_DISCONNECTED", `${ctx.shopDomain} is not connected, so its order can't be read`);
  }

  const graphql: GraphqlFn =
    deps.graphql ??
    ((query, variables) => shopifyGraphql({ shopDomain: conn.shopDomain, accessToken: decryptSecret(conn.tokenEnc!) }, query, variables));

  const { order } = await graphql<{ order: OrderNode | null }>(SYNC_ORDER, { id: gid });
  if (!order) throw new Error(`Order ${gid} not found in Shopify yet`);
  await upsertOrder(ctx.db, mapOrder(ctx.tenantId, conn.timezone, order));
}

export function registerSyncWebhooks(deps: OrdersCreateDeps = {}): void {
  onWebhook("orders/create", (ctx, payload) => ordersCreateHandler(ctx, payload, deps));
}
