// `npm run fixtures:load -- [--store solenne|tidepool|both] [--check]`
// Loads each store's plan.csv, ad-spend.csv, calendar.csv and call-notes/*.md into the brand's tenant in the database
// (.env.local's DATABASE_URL). Safe to run again: the same files leave the same rows. `--check` only reads and validates the
// files, and writes nothing.
import { existsSync } from "node:fs";
import { eq } from "drizzle-orm";
import { getDb } from "../lib/db/client";
import { shopConnections } from "../lib/db/schema";
import { loadAdSpend, loadPlan, parseAdSpend, parsePlan, readFixtureFile } from "./fixtures/load-pace";
import { loadCalendar, loadCallNotes, parseCalendar, parseCallNotes, readCallNoteFiles } from "./fixtures/load-why";
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
    const calendar = readFixtureFile(store, "calendar.csv");
    const noteFiles = readCallNoteFiles(store);
    if (checkOnly) {
      console.log(
        `${store}: plan ${new Set(parsePlan(plan).map((t) => t.month)).size} months, ad spend ${parseAdSpend(spend).length} rows, calendar ${parseCalendar(calendar).length} events, call notes ${parseCallNotes(noteFiles).length}: files are valid, nothing written.`,
      );
      continue;
    }
    const shopDomain = process.env[STORES[store].shopDomainEnv];
    const db = getDb();
    const [conn] = await db.select().from(shopConnections).where(eq(shopConnections.shopDomain, shopDomain ?? "")).limit(1);
    if (!conn) throw new Error(`${STORES[store].shopDomainEnv} is not connected to any brand.`);
    const p = await loadPlan(db, conn.tenantId, plan, `${STORES[store].name} plan (fixture)`);
    const a = await loadAdSpend(db, conn.tenantId, spend);
    const c = await loadCalendar(db, conn.tenantId, calendar);
    const n = await loadCallNotes(db, conn.tenantId, noteFiles);
    console.log(`${store}: plan ${p.months} months, ad spend ${a.rows} rows, calendar ${c.events} events, call notes ${n.notes} loaded.`);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
