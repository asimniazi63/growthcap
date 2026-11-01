// Top-up (T2): loads the orders the seed has not loaded yet, one complete store-local day at a time, so the demo store has
// a recent month for Pace. planTopup is pure; runTopupCli is a thin wrapper around it and the loader, so it keeps the
// loader's journal protocol: a crash or a second run never creates an order twice.
//   npm run seed:topup -- --store solenne|tidepool|all --dry-run
//   npm run seed:topup -- --store solenne|tidepool|all
//   npm run seed:topup -- --store solenne --dry-run --through 2026-11-01      (a preview of what a later run will load)
//
// Complete days only: an order dated later than the moment it is created is stamped with the moment it is created (the last
// four orders of the first load, dated the afternoon of 31 October, all sit at 00:49 to 00:50 that morning). Every order
// loaded here is already in the past, so Shopify keeps its processedAt. That also matches Pace, which counts complete days.
// The fixtures stay pinned to the first load (as-of 2026-10-31): the top-up generates in memory and writes no file. It
// never creates or changes catalog records and never sets stock.
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { generateDataset } from "./generate.js";
import { Journal, type JournalKind } from "./journal.js";
import { createLimiter } from "./limiter.js";
import { loadStore, validateDataset, type LoadResult } from "./load.js";
import { readDataset, type Selection } from "./select.js";
import { createAdminClient, explainAdminError, ShopifyAdminError } from "./shopify-admin.js";
import { SEED, STORES } from "./stores.js";
import { addDays } from "./time.js";
import type { Dataset, StoreKey } from "./types.js";

export interface TopupPlan {
  through: string; // the last store-local day this run loads
  dataset: Dataset; // the regenerated dataset, with no stock rows: a top-up never touches stock
  selection: Selection; // only what is new
  days: Record<string, number>; // new orders per store-local day
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// The store-local date of a moment, e.g. "2026-11-01".
export function storeDate(nowMs: number, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(nowMs));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

// What a top-up loads: the orders of `full` that `base` (the first load) does not have, on store-local days up to `through`
// and no later than now, with their new customers and the refunds that are due. Throws when the generator no longer
// reproduces the first load, because then the new orders would not belong to the same store history.
export function planTopup(base: Dataset, full: Dataset, opts: { through: string; nowMs: number }): TopupPlan {
  const fullOrders = new Map(full.orders.map((o) => [o.genId, o]));
  for (const o of base.orders) {
    if (!same(fullOrders.get(o.genId), o)) throw new Error(`The generator no longer reproduces order ${o.genId} from the first load, so a top-up would not match the history in Shopify. Nothing was loaded.`);
  }
  const fullRefunds = new Map(full.refunds.map((r) => [r.genId, r]));
  for (const r of base.refunds) {
    if (!same(fullRefunds.get(r.genId), r)) throw new Error(`The generator no longer reproduces refund ${r.genId} from the first load. Nothing was loaded.`);
  }
  for (const key of ["collections", "products", "variants", "discounts", "locations"] as const) {
    if (!same(base[key], full[key])) throw new Error(`The catalog (${key}) differs from the first load. A top-up never changes the catalog. Nothing was loaded.`);
  }

  const baseOrders = new Set(base.orders.map((o) => o.genId));
  const baseRefunds = new Set(base.refunds.map((r) => r.genId));
  const due = (processedAt: string) => processedAt.slice(0, 10) <= opts.through && Date.parse(processedAt) <= opts.nowMs;
  const orders = full.orders.filter((o) => !baseOrders.has(o.genId) && due(o.processedAt));
  const refunds = full.refunds.filter((r) => !baseRefunds.has(r.genId) && due(r.processedAt));
  const needed = new Set(orders.map((o) => o.customerGenId));
  const selection: Selection = { orders, refunds, customers: full.customers.filter((c) => needed.has(c.genId)) };
  const dataset: Dataset = { ...full, inventory: [] };
  validateDataset(dataset, selection);

  const days: Record<string, number> = {};
  for (const o of orders) days[o.processedAt.slice(0, 10)] = (days[o.processedAt.slice(0, 10)] ?? 0) + 1;
  return { through: opts.through, dataset, selection, days };
}

export function describeTopup(store: StoreKey, base: Dataset, plan: TopupPlan, nowMs: number, preview: boolean): string[] {
  const { selection } = plan;
  const name = STORES[store].name;
  if (selection.orders.length === 0 && selection.refunds.length === 0) {
    return [`${name}: no orders or refunds to load through ${plan.through} (the first load runs through ${base.asOf}).`];
  }
  const cents = selection.orders.reduce((s, o) => s + o.lines.reduce((t, l) => t + l.qty * l.unitPrice, 0), 0);
  const perDay = Object.entries(plan.days).map(([d, n]) => `${d}: ${n}`).join(", ");
  return [
    `${preview ? "PREVIEW (not loadable yet)" : "Plan"} for ${name}: complete days ${addDays(base.asOf, 1)} to ${plan.through}${preview ? "" : `, as of ${new Date(nowMs).toISOString()}`}`,
    `  orders        ${String(selection.orders.length).padStart(4)}  (${perDay || "none"}; gross $${(cents / 100).toFixed(2)}; about ${Math.max(1, Math.ceil(selection.orders.length / 5))} min at 5 per minute)`,
    `  refunds       ${String(selection.refunds.length).padStart(4)}`,
    `  customers     ${String(selection.customers.length).padStart(4)}  (those of these orders; ones already in Shopify are skipped)`,
    `  stock and catalog: untouched`,
  ];
}

// How many records of the first load (catalog and orders) the journal does not have as done. A top-up or extra order
// continues that load, so it must be zero: otherwise the loader would try to create catalog records again.
export function unfinishedRecords(base: Dataset, journal: Journal): number {
  const records: [JournalKind, string][] = [
    ...base.locations.map((l): [JournalKind, string] => ["location", l.genId]),
    ...base.collections.map((c): [JournalKind, string] => ["collection", c.genId]),
    ...base.products.map((p): [JournalKind, string] => ["product", p.genId]),
    ...base.discounts.map((d): [JournalKind, string] => ["discount", d.code]),
    ...base.orders.map((o): [JournalKind, string] => ["order", o.genId]),
  ];
  return records.filter(([kind, id]) => !journal.isDone(kind, id)).length;
}

export interface TopupDeps {
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
  readDataset?: (store: StoreKey) => Dataset;
  generate?: (store: StoreKey, asOf: string) => Dataset;
  nowMs?: number;
  log?: (line: string) => void;
  journalDir?: string;
  sleep?: (ms: number) => Promise<void>;
}

const USAGE = `usage: npm run seed:topup -- --store solenne|tidepool|all [--dry-run] [--through YYYY-MM-DD]
  --dry-run   print what would be loaded; no network calls
  --through   with --dry-run only: preview a later day. A real run always loads complete store-local days up to yesterday.
A real run writes to the store's shop as the seeder app (needs the journal from the first load in .seed-journal/).`;

export async function runTopupCli(argv: string[], deps: TopupDeps = {}): Promise<number> {
  const log = deps.log ?? ((l: string) => console.log(l));
  const env = deps.env ?? process.env;
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: { store: { type: "string" }, "dry-run": { type: "boolean" }, through: { type: "string" }, help: { type: "boolean" } },
      strict: true,
    }));
  } catch (e) {
    log(`${(e as Error).message}\n${USAGE}`);
    return 2;
  }
  if (values.help) {
    log(USAGE);
    return 0;
  }
  const stores: StoreKey[] | null = values.store === "all" ? ["solenne", "tidepool"] : values.store === "solenne" || values.store === "tidepool" ? [values.store] : null;
  if (!stores) {
    log(`--store solenne|tidepool|all is required.\n${USAGE}`);
    return 2;
  }
  const dryRun = values["dry-run"] === true;
  if (values.through !== undefined && (!dryRun || !/^\d{4}-\d{2}-\d{2}$/.test(values.through))) {
    log(`--through YYYY-MM-DD only works with --dry-run: a real run loads complete store-local days only.\n${USAGE}`);
    return 2;
  }

  const nowMs = deps.nowMs ?? Date.now();
  const read = deps.readDataset ?? readDataset;
  const generate = deps.generate ?? ((store: StoreKey, asOf: string) => generateDataset(store, { asOf, seed: SEED, storylines: true }));
  let exit = 0;

  for (const store of stores) {
    const cfg = STORES[store];
    const base = read(store);
    const complete = addDays(storeDate(nowMs, cfg.timezone), -1);
    const through = values.through ?? complete;
    const preview = through > complete;
    if (through <= base.asOf) {
      log(`${cfg.name}: nothing to load. The first load runs through ${base.asOf}; store-local today is ${addDays(complete, 1)}, so complete days run through ${complete}.`);
      continue;
    }
    let plan: TopupPlan;
    try {
      plan = planTopup(base, generate(store, through), { through, nowMs: preview ? Number.POSITIVE_INFINITY : nowMs });
    } catch (e) {
      log((e as Error).message);
      exit = 1;
      continue;
    }
    for (const line of describeTopup(store, base, plan, nowMs, preview)) log(line);
    if (dryRun || (plan.selection.orders.length === 0 && plan.selection.refunds.length === 0)) {
      if (dryRun) log(`Dry run: no network calls were made.`);
      continue;
    }

    const shop = env[cfg.shopDomainEnv];
    const missing = [cfg.shopDomainEnv, "SEEDER_CLIENT_ID", "SEEDER_CLIENT_SECRET"].filter((k) => !env[k]);
    if (missing.length) {
      log(`Missing from .env.local: ${missing.join(", ")}`);
      return 2;
    }
    const journalPath = `${deps.journalDir ?? ".seed-journal"}/${store}.json`;
    if (!existsSync(journalPath)) {
      log(`No journal at ${journalPath}. A top-up continues the first load, so it needs that journal; without it the catalog would be created again. Nothing was loaded.`);
      return 2;
    }
    const journal = Journal.open(journalPath, { store, shop: shop! });
    const notDone = unfinishedRecords(base, journal);
    if (notDone > 0) {
      log(`The journal says ${notDone} records of the first load (catalog or orders) are not in Shopify yet. Finish that load first (npm run seed:load -- --store ${store}). Nothing was loaded.`);
      return 2;
    }

    log(`This writes to ${shop} (${cfg.name}) as the seeder app.`);
    const client = createAdminClient({ shop: shop!, clientId: env.SEEDER_CLIENT_ID!, clientSecret: env.SEEDER_CLIENT_SECRET!, fetch: deps.fetch, sleep: deps.sleep });
    try {
      const result = await loadStore(plan.dataset, plan.selection, { client, journal, orderLimiter: createLimiter({ perMinute: 5, sleep: deps.sleep }), log, sleep: deps.sleep });
      reportResult(result, log);
      if (result.failures.length || result.aborted) exit = 1;
    } catch (e) {
      log(explainAdminError(e));
      if (!(e instanceof ShopifyAdminError)) log("The journal keeps what finished; re-run to continue.");
      exit = 1;
    }
  }
  return exit;
}

function reportResult(result: LoadResult, log: (line: string) => void): void {
  const fmt = (m: Partial<Record<JournalKind, number>>) => Object.entries(m).map(([k, v]) => `${k} ${v}`).join(", ") || "none";
  log(`Created: ${fmt(result.created)}`);
  log(`Recovered after a crash (found in Shopify): ${fmt(result.recovered)}`);
  if (result.failures.length) log(`${result.failures.length} failure(s)${result.aborted ? ", run stopped" : ""}. Re-run to retry; done records are skipped.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.loadEnvFile(".env.local");
  } catch {
    // no .env.local: runTopupCli reports any missing variables by name
  }
  runTopupCli(process.argv.slice(2)).then((code) => process.exit(code));
}
