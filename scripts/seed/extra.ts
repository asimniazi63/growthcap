// Extra demo orders: a few hand-picked orders on top of the generated history, so a small store has a recent day to show
// (Tidepool sells about one order every three days, and the generator gave it none on 2026-11-01; Solenne's day is thin). They go through the
// loader, so they get the same request, journal protocol and no-personal-data customers as every seeded order. Each carries
// the tag `demo-extra`, a fixed id (X_...) and is created once: a rerun finds it in the journal and skips it.
//   npm run seed:extra -- --store solenne|tidepool --dry-run
//   npm run seed:extra -- --store solenne|tidepool
//
// An order must be dated in the past: Shopify stamps an order dated later than the moment it is created with that moment.
// So a run refuses while any extra order is still in the future, and says when to run it.
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { Journal } from "./journal.js";
import { createLimiter } from "./limiter.js";
import { loadStore } from "./load.js";
import { readDataset, type Selection } from "./select.js";
import { createAdminClient, explainAdminError, ShopifyAdminError } from "./shopify-admin.js";
import { STORES } from "./stores.js";
import { localIso } from "./time.js";
import type { Customer, Dataset, Order, StoreKey } from "./types.js";
import { unfinishedRecords } from "./topup.js";

interface ExtraSpec {
  genId: string;
  date: string; // store-local
  hh: number;
  mm: number;
  customer: string; // a customer id from the dataset, or a new one (CUST_DEMO...) created for this order
  lines: [variantGenId: string, qty: number][];
  channel: string;
}

// Sunday 2026-11-01. The generated data has no Tidepool order that day, and Solenne's three generated ones leave a thin day.
// Tidepool: products are best sellers outside the swaddle (whose stock risk the audit story is about): V_005 Bamboo Sleep Sack
// 6-12 months $48, V_008 Organic Burp Cloths 5-pack $26, V_012 Hooded Bath Towel $34. X_TP_001 is a new customer, X_TP_002 a
// returning loyalist, X_TP_003 another new customer.
// Solenne: V_001 (SOL-01A) $48, V_011 (SOL-06A) $28, V_019 (SOL-10A) $42 and V_002 (SOL-01B) $72, its best sellers. X_SOL_001
// and X_SOL_003 are new customers, X_SOL_002 a returning loyalist. Eastern time went back an hour at 02:00 that day.
// Every order is above the $50 free-shipping line.
const EXTRAS: Record<StoreKey, ExtraSpec[]> = {
  solenne: [
    { genId: "X_SOL_001", date: "2026-11-01", hh: 11, mm: 5, customer: "CUST_DEMO0001", lines: [["V_001", 1], ["V_011", 1]], channel: "online_store" },
    { genId: "X_SOL_002", date: "2026-11-01", hh: 14, mm: 30, customer: "CUST_84e64712", lines: [["V_019", 2]], channel: "instagram" },
    { genId: "X_SOL_003", date: "2026-11-01", hh: 19, mm: 20, customer: "CUST_DEMO0002", lines: [["V_002", 1]], channel: "email" },
  ],
  tidepool: [
    { genId: "X_TP_001", date: "2026-11-01", hh: 10, mm: 15, customer: "CUST_DEMO0001", lines: [["V_005", 1], ["V_008", 1]], channel: "online_store" },
    { genId: "X_TP_002", date: "2026-11-01", hh: 15, mm: 40, customer: "CUST_c4d1ace7", lines: [["V_012", 2]], channel: "instagram" },
    { genId: "X_TP_003", date: "2026-11-01", hh: 12, mm: 30, customer: "CUST_DEMO0002", lines: [["V_008", 1], ["V_012", 1]], channel: "tiktok" },
  ],
};

export interface ExtraPlan {
  dataset: Dataset; // the first load's dataset plus the new customers, with no stock rows
  selection: Selection;
}

// The extra orders of a store as Dataset records. Throws on anything the loader would reject or that would disturb the
// first load: an unknown variant or customer, a date on or before the dataset's end, a total under the free-shipping line.
export function buildExtras(store: StoreKey, base: Dataset): { orders: Order[]; customers: Customer[] } {
  const timezone = STORES[store].timezone;
  const known = new Set(base.customers.map((c) => c.genId));
  const customers: Customer[] = [];
  const orders: Order[] = [];
  for (const x of EXTRAS[store]) {
    if (x.date <= base.asOf) throw new Error(`${x.genId} is dated ${x.date}, on or before the first load's end (${base.asOf}); it would change history.`);
    if (!known.has(x.customer) && !customers.some((c) => c.genId === x.customer)) {
      if (!x.customer.startsWith("CUST_DEMO")) throw new Error(`${x.genId}: customer ${x.customer} is not in the dataset.`);
      customers.push({ genId: x.customer, persona: "regular" });
    }
    const lines = x.lines.map(([variantGenId, qty]) => {
      const v = base.variants.find((y) => y.genId === variantGenId);
      if (!v) throw new Error(`${x.genId}: variant ${variantGenId} is not in the dataset.`);
      return { variantGenId, qty, unitPrice: v.price };
    });
    const subtotal = lines.reduce((s, l) => s + l.qty * l.unitPrice, 0);
    if (subtotal < 5000) throw new Error(`${x.genId}: $${(subtotal / 100).toFixed(2)} is under the $50 free-shipping line, and extra orders carry no shipping charge.`);
    orders.push({
      genId: x.genId,
      processedAt: localIso(timezone, x.date, x.hh, x.mm, 0),
      customerGenId: x.customer,
      lines,
      shipping: 0,
      discountCents: 0,
      channel: x.channel,
      tags: [`channel:${x.channel}`, "demo-extra"],
    });
  }
  orders.sort((a, b) => Date.parse(a.processedAt) - Date.parse(b.processedAt));
  return { orders, customers };
}

export function planExtra(store: StoreKey, base: Dataset): ExtraPlan {
  const { orders, customers } = buildExtras(store, base);
  const needed = new Set(orders.map((o) => o.customerGenId));
  const dataset: Dataset = { ...base, customers: [...base.customers, ...customers], inventory: [] };
  return { dataset, selection: { orders, refunds: [], customers: dataset.customers.filter((c) => needed.has(c.genId)) } };
}

export const total = (o: Order) => o.lines.reduce((s, l) => s + l.qty * l.unitPrice, 0);

export interface ExtraDeps {
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
  readDataset?: (store: StoreKey) => Dataset;
  nowMs?: number;
  log?: (line: string) => void;
  journalDir?: string;
  sleep?: (ms: number) => Promise<void>;
}

const USAGE = `usage: npm run seed:extra -- --store solenne|tidepool [--dry-run]
  --dry-run   print the orders; no network calls
A real run writes to the store's shop as the seeder app and needs the journal from the first load in .seed-journal/.`;

export async function runExtraCli(argv: string[], deps: ExtraDeps = {}): Promise<number> {
  const log = deps.log ?? ((l: string) => console.log(l));
  const env = deps.env ?? process.env;
  let values;
  try {
    ({ values } = parseArgs({ args: argv, options: { store: { type: "string" }, "dry-run": { type: "boolean" }, help: { type: "boolean" } }, strict: true }));
  } catch (e) {
    log(`${(e as Error).message}\n${USAGE}`);
    return 2;
  }
  if (values.help) {
    log(USAGE);
    return 0;
  }
  const store = values.store;
  if (store !== "solenne" && store !== "tidepool") {
    log(`--store solenne or --store tidepool is required.\n${USAGE}`);
    return 2;
  }
  const cfg = STORES[store];
  if (EXTRAS[store].length === 0) {
    log(`${cfg.name} has no extra orders defined.`);
    return 0;
  }

  const base = (deps.readDataset ?? readDataset)(store);
  const nowMs = deps.nowMs ?? Date.now();
  let plan: ExtraPlan;
  try {
    plan = planExtra(store, base);
  } catch (e) {
    log((e as Error).message);
    return 1;
  }

  log(`${values["dry-run"] ? "DRY RUN" : "Plan"} for ${cfg.name}: ${plan.selection.orders.length} extra orders, tagged demo-extra`);
  for (const o of plan.selection.orders) {
    const lines = o.lines.map((l) => `${l.qty} x ${base.variants.find((v) => v.genId === l.variantGenId)?.sku}`).join(", ");
    const future = Date.parse(o.processedAt) > nowMs;
    log(`  ${o.genId}  ${o.processedAt}  $${(total(o) / 100).toFixed(2)}  ${lines}  (${o.customerGenId}, ${o.channel})${future ? "  [still in the future]" : ""}`);
  }
  const waiting = plan.selection.orders.filter((o) => Date.parse(o.processedAt) > nowMs);
  if (values["dry-run"]) {
    log("Dry run: no network calls were made.");
    return 0;
  }
  if (waiting.length) {
    log(`${waiting.map((o) => o.genId).join(", ")} ${waiting.length === 1 ? "is" : "are"} dated in the future, and Shopify would stamp ${waiting.length === 1 ? "it" : "them"} with the moment of creation. Run again after ${new Date(Math.max(...waiting.map((o) => Date.parse(o.processedAt)))).toISOString()}. Nothing was created.`);
    return 2;
  }

  const shop = env[cfg.shopDomainEnv];
  const missing = [cfg.shopDomainEnv, "SEEDER_CLIENT_ID", "SEEDER_CLIENT_SECRET"].filter((k) => !env[k]);
  if (missing.length) {
    log(`Missing from .env.local: ${missing.join(", ")}`);
    return 2;
  }
  const journalPath = `${deps.journalDir ?? ".seed-journal"}/${store}.json`;
  if (!existsSync(journalPath)) {
    log(`No journal at ${journalPath}. Extra orders continue the first load, so they need that journal; without it the catalog would be created again. Nothing was created.`);
    return 2;
  }
  const journal = Journal.open(journalPath, { store, shop: shop! });
  const notDone = unfinishedRecords(base, journal);
  if (notDone > 0) {
    log(`The journal says ${notDone} records of the first load (catalog or orders) are not in Shopify yet. Finish that load first (npm run seed:load -- --store ${store}). Nothing was created.`);
    return 2;
  }

  log(`This writes to ${shop} (${cfg.name}) as the seeder app.`);
  const client = createAdminClient({ shop: shop!, clientId: env.SEEDER_CLIENT_ID!, clientSecret: env.SEEDER_CLIENT_SECRET!, fetch: deps.fetch, sleep: deps.sleep });
  try {
    const result = await loadStore(plan.dataset, plan.selection, { client, journal, orderLimiter: createLimiter({ perMinute: 5, sleep: deps.sleep }), log, sleep: deps.sleep });
    log(`Created: orders ${result.created.order ?? 0}, customers ${result.created.customer ?? 0}`);
    log(`Already created, skipped: orders ${result.skipped.order ?? 0}`);
    if (result.failures.length) log(`${result.failures.length} failure(s)${result.aborted ? ", run stopped" : ""}. Re-run to retry.`);
    return result.failures.length || result.aborted ? 1 : 0;
  } catch (e) {
    log(explainAdminError(e));
    if (!(e instanceof ShopifyAdminError)) log("The journal keeps what finished; re-run to continue.");
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.loadEnvFile(".env.local");
  } catch {
    // no .env.local: runExtraCli reports any missing variables by name
  }
  runExtraCli(process.argv.slice(2)).then((code) => process.exit(code));
}
