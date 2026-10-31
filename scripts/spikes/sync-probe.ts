// `npm run sync:probe -- --store solenne|tidepool [--pages 3]`
// Runs the sync's own GraphQL queries against the real store with the stored token, maps what comes back, and prints
// errors, query cost and timings. Read-only: it writes nothing to Postgres or Shopify, and prints no token and no
// store data (only counts). Use it to check a query before a deploy instead of finding the error through a Resync.
import { existsSync } from "node:fs";
import { eq } from "drizzle-orm";
import { decryptSecret } from "../../lib/crypto/secrets";
import { getDb } from "../../lib/db/client";
import { shopConnections } from "../../lib/db/schema";
import { mapOrder, mapProduct, type OrderNode, type ProductNode } from "../../lib/sync/map";
import { SYNC_ORDERS, SYNC_PRODUCTS } from "../../lib/sync/queries";
import { SHOPIFY_API_VERSION } from "../../lib/shopify/version";
import { STORES } from "../seed/stores.js";
import type { StoreKey } from "../seed/types.js";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

interface Page<T> {
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
  nodes: T[];
}

async function main(): Promise<void> {
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  const store = arg("store") as StoreKey | undefined;
  if (store !== "solenne" && store !== "tidepool") throw new Error("Usage: npm run sync:probe -- --store solenne|tidepool [--pages N]");
  const pages = Number(arg("pages") ?? 1);

  const shopDomain = process.env[STORES[store].shopDomainEnv];
  if (!shopDomain) throw new Error(`${STORES[store].shopDomainEnv} is not set`);
  const [conn] = await getDb().select().from(shopConnections).where(eq(shopConnections.shopDomain, shopDomain)).limit(1);
  if (!conn?.tokenEnc || conn.status !== "connected") throw new Error(`${shopDomain} is not connected, so there is no token to probe with.`);
  const token = decryptSecret(conn.tokenEnc);

  async function call(query: string, after: string | null) {
    const started = Date.now();
    const res = await fetch(`https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
      body: JSON.stringify({ query, variables: { after } }),
    });
    const body = (await res.json().catch(() => null)) as { data?: Record<string, unknown>; errors?: { message: string }[]; extensions?: { cost?: Record<string, unknown> } } | null;
    return { status: res.status, ms: Date.now() - started, body };
  }

  for (const [name, query, field] of [["products", SYNC_PRODUCTS, "products"], ["orders", SYNC_ORDERS, "orders"]] as const) {
    let after: string | null = null;
    let total = 0;
    for (let p = 1; p <= pages; p++) {
      const { status, ms, body } = await call(query, after);
      const cost = body?.extensions?.cost as { requestedQueryCost?: number; actualQueryCost?: number; throttleStatus?: { currentlyAvailable?: number } } | undefined;
      if (status !== 200 || !body || body.errors) {
        console.log(`${name} page ${p}: FAILED (HTTP ${status}) ${(body?.errors ?? []).map((e) => e.message).join("; ")}`);
        break;
      }
      const page = body.data![field] as Page<OrderNode | ProductNode>;
      let mapped = 0;
      try {
        for (const node of page.nodes) {
          if (name === "orders") mapOrder(conn.tenantId, conn.timezone, node as OrderNode);
          else mapProduct(conn.tenantId, node as ProductNode);
          mapped++;
        }
      } catch (e) {
        console.log(`${name} page ${p}: mapping failed after ${mapped} nodes: ${e instanceof Error ? e.message : String(e)}`);
        break;
      }
      total += mapped;
      console.log(`${name} page ${p}: ok, ${page.nodes.length} nodes mapped, ${ms} ms, cost requested ${cost?.requestedQueryCost} / actual ${cost?.actualQueryCost}, bucket left ${cost?.throttleStatus?.currentlyAvailable}, more pages: ${page.pageInfo.hasNextPage}`);
      if (!page.pageInfo.hasNextPage) break;
      after = page.pageInfo.endCursor;
    }
    console.log(`${name}: ${total} nodes read and mapped`);
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
