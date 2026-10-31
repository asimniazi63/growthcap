// `npm run reconcile:truth -- --store solenne|tidepool [--journal .seed-journal/<store>.json]`
// Reads the synced Postgres (DATABASE_URL), computes every month and metric through lib/metrics, compares them with
// fixtures/<store>/truth.json and the dataset's counts, and writes the result to docs/evals/reconciliation.md.
// Read-only: it changes nothing in Postgres or Shopify. Exits 1 when a difference has no explanation.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { getDb } from "../lib/db/client";
import { shopConnections } from "../lib/db/schema";
import type { TenantContext } from "../lib/tenancy/context";
import { readFixture } from "./fixtures/load-db";
import { EXPLANATIONS } from "./reconcile/explanations";
import { idMapFromJournal, reconcileStore, renderStoreSection, unexplainedCount, upsertSection } from "./reconcile/reconcile";
import { STORES } from "./seed/stores.js";
import type { StoreKey } from "./seed/types.js";

const REPORT = "docs/evals/reconciliation.md";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  const store = arg("store") as StoreKey | undefined;
  if (store !== "solenne" && store !== "tidepool") throw new Error("Usage: npm run reconcile:truth -- --store solenne|tidepool [--journal <file>]");

  const shopDomain = process.env[STORES[store].shopDomainEnv];
  if (!shopDomain) throw new Error(`${STORES[store].shopDomainEnv} is not set`);
  const db = getDb();
  const [conn] = await db.select().from(shopConnections).where(eq(shopConnections.shopDomain, shopDomain)).limit(1);
  if (!conn) throw new Error(`${shopDomain} is not connected to any brand yet, so nothing is synced to compare.`);

  const journalPath = arg("journal") ?? `.seed-journal/${store}.json`;
  const ids = existsSync(journalPath) ? idMapFromJournal(JSON.parse(readFileSync(journalPath, "utf8"))) : undefined;
  if (!ids) console.log(`No journal at ${journalPath}: storyline checks on products and variants will be skipped.`);

  const ctx: TenantContext = {
    tenantId: conn.tenantId,
    orgId: "operator",
    userId: "reconcile-truth",
    role: "gc_admin",
    shop: { domain: conn.shopDomain, timezone: conn.timezone, currency: conn.currency, status: conn.status },
  };
  const { dataset, truth } = readFixture(store);
  const rec = await reconcileStore({ db, ctx, truth, dataset, ids });

  const section = renderStoreSection(rec, EXPLANATIONS, new Date().toISOString().slice(0, 10));
  mkdirSync("docs/evals", { recursive: true });
  writeFileSync(REPORT, upsertSection(existsSync(REPORT) ? readFileSync(REPORT, "utf8") : null, store, section));

  const unexplained = unexplainedCount(rec, EXPLANATIONS);
  console.log(`${STORES[store].name}: ${rec.differences.length} differences (${unexplained} unexplained), ${rec.skipped.length} checks skipped. Written to ${REPORT}.`);
  if (unexplained > 0) process.exitCode = 1;
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
