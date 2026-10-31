// Compares what the synced Postgres says with truth.json (and the dataset's counts), through the same queryMetric the
// agent uses. Used by `npm run reconcile:truth`, and tested against faithful and deliberately broken data.
import type { Db } from "../../lib/db/client";
import { AppError } from "../../lib/errors";
import { monthEnd, monthStart } from "../../lib/metrics/dates";
import { queryMetric, type QueryMetricInput } from "../../lib/metrics/query";
import { CORE_METRIC_IDS, type MetricId } from "../../lib/metrics/registry";
import { getSyncStatus } from "../../lib/sync/status";
import type { TenantContext } from "../../lib/tenancy/context";
import { STORES } from "../seed/stores.js";
import type { Dataset, StoreKey, Truth } from "../seed/types.js";

export interface IdMap {
  product: (genId: string) => string;
  variant: (genId: string) => string;
}

export interface Difference {
  kind: "monthly" | "storyline" | "count";
  where: string;
  metric: string;
  expected: number;
  actual: number | null; // null: nothing synced to compare
}

export interface Reconciliation {
  store: StoreKey;
  checked: { months: number; monthlyValues: number; storylineChecks: number; counts: number };
  differences: Difference[];
  skipped: { where: string; why: string }[];
}

export interface Explanation {
  store: StoreKey;
  where?: string;
  metric?: string;
  note: string;
}

export interface ReconcileInput {
  db: Db;
  ctx: TenantContext;
  truth: Truth;
  dataset?: Dataset;
  ids?: IdMap;
}

const EXACT = new Set<string>(["gross_sales", "discounts", "refunds", "net_sales", "orders", "units", "new_customer_orders"]);

// Counts and money must match exactly, an average to a hundredth of a cent, a rate to 4 decimal places.
function agrees(metric: string, actual: number, expected: number): boolean {
  if (EXACT.has(metric)) return actual === expected;
  return Math.abs(actual - expected) < (metric === "aov" ? 0.005 : 0.00005);
}

const isCore = (m: string): m is MetricId => (CORE_METRIC_IDS as readonly string[]).includes(m);

function toFilters(f: Record<string, string>, ids: IdMap | undefined): { filters: NonNullable<QueryMetricInput["filters"]> } | { skip: string } {
  const filters: NonNullable<QueryMetricInput["filters"]> = {};
  for (const [key, value] of Object.entries(f)) {
    if (key === "discount_code") filters.discountCodes = [value];
    else if (key === "channel") filters.channels = [value];
    else if (key === "tag") filters.tags = [value];
    else if (key === "exclude_tag") filters.excludeTags = [value];
    else if (key === "customer_type") filters.customerType = value as "new" | "returning";
    else if (key === "product" || key === "variant") {
      if (!ids) return { skip: "needs the seed journal to map P_ and V_ ids to Shopify ids (pass --journal)" };
      if (key === "product") filters.productIds = [ids.product(value)];
      else filters.variantIds = [ids.variant(value)];
    } else return { skip: `a filter (${key}) that queryMetric does not take` };
  }
  return { filters };
}

async function valuesFor(input: ReconcileInput, query: QueryMetricInput): Promise<Partial<Record<MetricId, number>> | null> {
  try {
    return (await queryMetric(input.ctx, query, { db: input.db })).data[0]?.values ?? null;
  } catch (e) {
    if (e instanceof AppError && e.code === "NO_DATA") return null;
    throw e;
  }
}

export async function reconcileStore(input: ReconcileInput): Promise<Reconciliation> {
  const { truth, dataset } = input;
  const rec: Reconciliation = { store: truth.store, checked: { months: 0, monthlyValues: 0, storylineChecks: 0, counts: 0 }, differences: [], skipped: [] };

  for (const [month, expected] of Object.entries(truth.monthly)) {
    rec.checked.months++;
    const got = await valuesFor(input, { metrics: [...CORE_METRIC_IDS], from: monthStart(month), to: monthEnd(month) });
    rec.checked.monthlyValues += CORE_METRIC_IDS.length;
    // A month with nothing synced is one difference, not eleven: the orders are what is missing.
    if (!got) {
      rec.differences.push({ kind: "monthly", where: month, metric: "orders", expected: expected.orders, actual: null });
      continue;
    }
    for (const metric of CORE_METRIC_IDS) {
      const actual = got[metric];
      if (actual === undefined || !agrees(metric, actual, expected[metric])) rec.differences.push({ kind: "monthly", where: month, metric, expected: expected[metric], actual: actual ?? null });
    }
  }

  for (const sl of truth.storylines) {
    for (const c of sl.checks) {
      const where = `${sl.id} ${c.metric} ${JSON.stringify(c.filter)} ${c.period.from}..${c.period.to}`;
      if (!isCore(c.metric)) {
        rec.skipped.push({ where, why: "repeat_rate and zero_sales_days are built in T12" });
        continue;
      }
      const mapped = toFilters(c.filter, input.ids);
      if ("skip" in mapped) {
        rec.skipped.push({ where, why: mapped.skip });
        continue;
      }
      rec.checked.storylineChecks++;
      const got = await valuesFor(input, { metrics: [c.metric], from: c.period.from, to: c.period.to, filters: mapped.filters });
      const actual = got?.[c.metric];
      if (actual === undefined || Math.abs(actual - c.expected) > c.tolerance) {
        rec.differences.push({ kind: "storyline", where, metric: c.metric, expected: c.expected, actual: actual ?? null });
      }
    }
  }

  if (dataset) {
    const status = await getSyncStatus(input.db, input.ctx.tenantId);
    const expected: Record<string, number> = {
      orders: dataset.orders.length,
      refunds: dataset.refunds.length,
      products: dataset.products.length,
      variants: dataset.variants.length,
      customers: new Set(dataset.orders.map((o) => o.customerGenId)).size,
    };
    for (const [name, want] of Object.entries(expected)) {
      rec.checked.counts++;
      const got = status.counts[name as keyof typeof status.counts];
      if (got !== want) rec.differences.push({ kind: "count", where: "synced rows", metric: name, expected: want, actual: got });
    }
  }
  return rec;
}

const num = (n: number | null) => (n === null ? "no synced orders" : String(Math.round(n * 1e6) / 1e6));

export function renderStoreSection(rec: Reconciliation, explanations: Explanation[], checkedOn: string): string {
  const explain = (d: Difference) =>
    explanations.find((e) => e.store === rec.store && (e.where === undefined || e.where === d.where) && (e.metric === undefined || e.metric === d.metric))?.note;
  const unexplained = rec.differences.filter((d) => !explain(d)).length;
  const c = rec.checked;
  const lines = [
    `## ${STORES[rec.store].name}`,
    "",
    `Checked on ${checkedOn}: ${c.months} months x 11 metrics (${c.monthlyValues} values), ${c.storylineChecks} storyline checks, ${c.counts} row counts.`,
    "",
  ];
  if (rec.differences.length === 0) lines.push("**No differences.** Every value matches `truth.json` and the dataset.");
  else {
    lines.push(`**${rec.differences.length} differences, ${unexplained} unexplained.**`, "", "| Where | Metric | truth.json | Synced | Explanation |", "|---|---|---|---|---|");
    for (const d of rec.differences) lines.push(`| ${d.where} | ${d.metric} | ${num(d.expected)} | ${num(d.actual)} | ${explain(d) ?? "UNEXPLAINED"} |`);
  }
  if (rec.skipped.length > 0) {
    lines.push("", `Not checked (${rec.skipped.length}):`, "");
    for (const s of rec.skipped) lines.push(`- ${s.where}: ${s.why}`);
  }
  return lines.join("\n");
}

export const unexplainedCount = (rec: Reconciliation, explanations: Explanation[]): number =>
  rec.differences.filter((d) => !explanations.some((e) => e.store === rec.store && (e.where === undefined || e.where === d.where) && (e.metric === undefined || e.metric === d.metric))).length;

// docs/evals/reconciliation.md holds one block per store; running one store replaces only its block.
export function upsertSection(doc: string | null, store: StoreKey, section: string): string {
  const open = `<!-- reconcile:${store} -->`;
  const close = `<!-- /reconcile:${store} -->`;
  const block = `${open}\n${section}\n${close}`;
  const base = doc ?? "# Reconciliation against truth.json\n\nWritten by `npm run reconcile:truth -- --store <store>`. Each run replaces its own store's section.\n";
  const start = base.indexOf(open);
  const end = base.indexOf(close);
  if (start >= 0 && end > start) return base.slice(0, start) + block + base.slice(end + close.length);
  return `${base.trimEnd()}\n\n${block}\n`;
}

interface JournalLike {
  entries: Record<string, { status: string; shopifyId?: string; data?: unknown }>;
}

// The loader's journal knows which Shopify id each generator id got. Reconciling the live stores needs it for the
// storyline checks that name a product or a variant.
export function idMapFromJournal(journal: JournalLike): IdMap {
  const variants = new Map<string, string>();
  for (const [key, entry] of Object.entries(journal.entries)) {
    if (!key.startsWith("product:") || entry.status !== "done") continue;
    const data = entry.data as { variants?: Record<string, { id: string }> } | undefined;
    for (const [gen, v] of Object.entries(data?.variants ?? {})) variants.set(gen, v.id);
  }
  return {
    product: (genId) => {
      const e = journal.entries[`product:${genId}`];
      if (e?.status !== "done" || !e.shopifyId) throw new Error(`No Shopify id for ${genId} in the journal`);
      return e.shopifyId;
    },
    variant: (genId) => {
      const id = variants.get(genId);
      if (!id) throw new Error(`No Shopify id for ${genId} in the journal`);
      return id;
    },
  };
}
