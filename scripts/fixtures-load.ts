// `npm run fixtures:load -- [--store solenne|tidepool|both] [--check]`
// Loads each store's plan.csv and ad-spend.csv into the brand's tenant in the database (.env.local's DATABASE_URL).
// Safe to run again: the same files leave the same rows. `--check` only reads and validates the files, and writes nothing.
// (Calendar and call notes belong to the Why ticket, T7.)
import { existsSync } from "node:fs";
import { eq } from "drizzle-orm";
import { getDb } from "../lib/db/client";
import { shopConnections } from "../lib/db/schema";
import { loadAdSpend, loadPlan, parseAdSpend, parsePlan, readFixtureFile } from "./fixtures/load-pace";
import { STORES } from "./seed/stores.js";
import type { StoreKey } from "./seed/types.js";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

async function main(): Promise<void> {
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  const which = arg("store") ?? "both";
  if (!["solenne", "tidepool", "both"].includes(which)) throw new Error("Usage: npm run fixtures:load -- [--store solenne|tidepool|both] [--check]");
  const stores: StoreKey[] = which === "both" ? ["solenne", "tidepool"] : [which as StoreKey];
  const checkOnly = process.argv.includes("--check");

  for (const store of stores) {
    const plan = readFixtureFile(store, "plan.csv");
    const spend = readFixtureFile(store, "ad-spend.csv");
    if (checkOnly) {
      console.log(`${store}: plan ${new Set(parsePlan(plan).map((t) => t.month)).size} months, ad spend ${parseAdSpend(spend).length} rows: files are valid, nothing written.`);
      continue;
    }
    const shopDomain = process.env[STORES[store].shopDomainEnv];
    const db = getDb();
    const [conn] = await db.select().from(shopConnections).where(eq(shopConnections.shopDomain, shopDomain ?? "")).limit(1);
    if (!conn) throw new Error(`${STORES[store].shopDomainEnv} is not connected to any brand.`);
    const p = await loadPlan(db, conn.tenantId, plan, `${STORES[store].name} plan (fixture)`);
    const a = await loadAdSpend(db, conn.tenantId, spend);
    console.log(`${store}: plan ${p.months} months, ad spend ${a.rows} rows loaded.`);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
