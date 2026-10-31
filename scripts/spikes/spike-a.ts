// Spike (a): can orders backdated more than 60 days be read with read_orders alone?
// Read-only. Uses the PRODUCT app (read scopes only), through the client credentials grant, so it answers
// what the real app will be able to see. Run after the pilot load:
//   npm run seed:spike-a -- --store solenne
import { parseArgs } from "node:util";
import { API_VERSION, AS_OF, STORES } from "../seed/stores.js";
import type { StoreKey } from "../seed/types.js";

process.loadEnvFile(".env.local");

const { values } = parseArgs({ options: { store: { type: "string" } } });
const store = values.store as StoreKey | undefined;
if (store !== "solenne" && store !== "tidepool") {
  console.error("usage: spike-a --store solenne|tidepool");
  process.exit(2);
}

const domain = process.env[STORES[store].shopDomainEnv];
const clientId = process.env.SHOPIFY_API_KEY;
const clientSecret = process.env.SHOPIFY_API_SECRET;
if (!domain || !clientId || !clientSecret) throw new Error("missing shop domain or product app credentials in .env.local");

const tokenRes = await fetch(`https://${domain}/admin/oauth/access_token`, {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret }),
});
if (!tokenRes.ok) throw new Error(`token request failed: HTTP ${tokenRes.status}`);
const { access_token: token, scope } = (await tokenRes.json()) as { access_token: string; scope: string };

// 60 days before the as-of date: anything processed before this is "older than 60 days" by processedAt.
const cutoff = new Date(Date.parse(`${AS_OF}T00:00:00Z`) - 60 * 86_400_000).toISOString().slice(0, 10);

async function gql<T>(query: string): Promise<T> {
  const res = await fetch(`https://${domain}/admin/api/${API_VERSION}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({ query }),
  });
  const body = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (body.errors?.length) throw new Error(body.errors.map((e) => e.message).join("; "));
  return body.data as T;
}

interface Row {
  name: string;
  processedAt: string;
  createdAt: string;
  sourceIdentifier: string | null;
}
const data = await gql<{
  old: { nodes: Row[] };
  all: { count: number };
  oldCount: { count: number };
}>(`{
  old: orders(first: 5, sortKey: PROCESSED_AT, query: "processed_at:<${cutoff}") {
    nodes { name processedAt createdAt sourceIdentifier }
  }
  all: ordersCount(limit: null) { count }
  oldCount: ordersCount(limit: null, query: "processed_at:<${cutoff}") { count }
}`);

console.log(`store: ${store} (${domain}), scopes: ${scope}`);
console.log(`cutoff (as-of ${AS_OF} minus 60 days): ${cutoff}`);
console.log(`orders visible in total: ${data.all.count}`);
console.log(`orders with processedAt before the cutoff: ${data.oldCount.count}`);
for (const o of data.old.nodes) console.log(`  ${o.name} processedAt ${o.processedAt} createdAt ${o.createdAt} source ${o.sourceIdentifier}`);
console.log(
  data.oldCount.count > 0
    ? "ANSWER: yes, orders backdated more than 60 days are readable with read_orders alone (they were created recently, which is what Shopify's 60-day window counts)."
    : "ANSWER: no backdated orders were returned. Either nothing is loaded yet or read_all_orders is needed.",
);
