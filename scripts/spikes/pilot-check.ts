// Reads loaded orders and refunds back through the Admin API (read-only) and compares them with
// fixtures/<store>/dataset.json: processedAt, line prices and quantities, discount total and code, shipping, tags.
//   npm run seed:pilot-check -- --store solenne --limit 20
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { dec } from "../seed/load.js";
import { readDataset, selectRecords, type Selection } from "../seed/select.js";
import { createAdminClient, explainAdminError, type GraphqlClient } from "../seed/shopify-admin.js";
import { STORES } from "../seed/stores.js";
import type { Dataset, StoreKey } from "../seed/types.js";

export interface ShopifyOrder {
  id: string;
  sourceIdentifier: string | null;
  processedAt: string;
  tags: string[];
  test: boolean;
  discountCodes: string[];
  totalDiscounts: number; // cents
  shipping: number; // cents
  lines: { sku: string | null; qty: number; unitPrice: number }[];
  refunds: { processedAt: string; lines: { sku: string | null; qty: number }[] }[];
}

interface Money {
  shopMoney: { amount: string };
}
export interface OrderNode {
  id: string;
  sourceIdentifier: string | null;
  processedAt: string;
  tags: string[];
  test: boolean;
  discountCodes: string[];
  totalDiscountsSet: Money | null;
  totalShippingPriceSet: Money;
  lineItems: { nodes: { quantity: number; sku: string | null; originalUnitPriceSet: Money }[] };
  refunds: { id: string; processedAt: string; refundLineItems: { nodes: { quantity: number; lineItem: { sku: string | null } }[] } }[];
}

const cents = (m: Money | null | undefined) => (m ? Math.round(parseFloat(m.shopMoney.amount) * 100) : 0);

export function toShopifyOrder(n: OrderNode): ShopifyOrder {
  return {
    id: n.id,
    sourceIdentifier: n.sourceIdentifier,
    processedAt: n.processedAt,
    tags: n.tags,
    test: n.test,
    discountCodes: n.discountCodes,
    totalDiscounts: cents(n.totalDiscountsSet),
    shipping: cents(n.totalShippingPriceSet),
    lines: n.lineItems.nodes.map((l) => ({ sku: l.sku, qty: l.quantity, unitPrice: cents(l.originalUnitPriceSet) })),
    refunds: n.refunds.map((r) => ({
      processedAt: r.processedAt,
      lines: r.refundLineItems.nodes.map((l) => ({ sku: l.lineItem.sku, qty: l.quantity })),
    })),
  };
}

export const PILOT_READ = `query PilotRead($after: String) {
  orders(first: 50, after: $after, sortKey: PROCESSED_AT) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id sourceIdentifier processedAt tags test discountCodes
      totalDiscountsSet { shopMoney { amount } }
      totalShippingPriceSet { shopMoney { amount } }
      lineItems(first: 100) { nodes { quantity sku originalUnitPriceSet { shopMoney { amount } } } }
      refunds { id processedAt refundLineItems(first: 50) { nodes { quantity lineItem { sku } } } }
    }
  }
}`;

export async function readOrders(client: GraphqlClient): Promise<ShopifyOrder[]> {
  const all: ShopifyOrder[] = [];
  let after: string | null = null;
  do {
    const page: { orders: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: OrderNode[] } } = await client.graphql(PILOT_READ, { after });
    all.push(...page.orders.nodes.map(toShopifyOrder));
    after = page.orders.pageInfo.hasNextPage ? page.orders.pageInfo.endCursor : null;
  } while (after);
  return all;
}

export interface CheckRow {
  id: string;
  kind: "order" | "refund";
  status: "PASS" | "FAIL";
  problems: string[];
}

export interface Comparison {
  rows: CheckRow[];
  unexpected: string[]; // Shopify orders the dataset doesn't know (no sourceIdentifier, or one that isn't in the dataset)
  counts: { shopifyOrders: number; expectedOrders: number; matchedOrders: number; outsideSelection: number };
  ok: boolean;
}

const iso = (s: string) => new Date(Date.parse(s)).toISOString();
const multiset = (items: string[]) => [...items].sort().join(" | ");
const same = (a: string, b: string) => a === b;

export function compare(ds: Dataset, sel: Selection, shopify: ShopifyOrder[]): Comparison {
  const skuOf = new Map(ds.variants.map((v) => [v.genId, v.sku]));
  const knownIds = new Set(ds.orders.map((o) => o.genId));
  const selectedIds = new Set(sel.orders.map((o) => o.genId));
  const bySource = new Map<string, ShopifyOrder[]>();
  const unexpected: string[] = [];
  let outsideSelection = 0;
  for (const o of shopify) {
    if (!o.sourceIdentifier || !knownIds.has(o.sourceIdentifier)) {
      unexpected.push(o.sourceIdentifier ?? `${o.id} (no sourceIdentifier)`);
      continue;
    }
    if (!selectedIds.has(o.sourceIdentifier)) {
      outsideSelection++;
      continue;
    }
    bySource.set(o.sourceIdentifier, [...(bySource.get(o.sourceIdentifier) ?? []), o]);
  }

  const rows: CheckRow[] = [];
  const row = (id: string, kind: CheckRow["kind"], problems: string[]) => rows.push({ id, kind, status: problems.length ? "FAIL" : "PASS", problems });
  let matched = 0;
  for (const o of sel.orders) {
    const found = bySource.get(o.genId) ?? [];
    if (found.length === 0) {
      row(o.genId, "order", ["not found in Shopify"]);
      continue;
    }
    if (found.length > 1) {
      row(o.genId, "order", [`${found.length} orders with this sourceIdentifier (a duplicate)`]);
      continue;
    }
    const s = found[0]!;
    const problems: string[] = [];
    if (iso(s.processedAt) !== iso(o.processedAt)) problems.push(`processedAt: expected ${iso(o.processedAt)}, got ${iso(s.processedAt)}`);
    if (s.test) problems.push("is a test order (test orders are left out of analytics)");
    const want = multiset(o.lines.map((l) => `${skuOf.get(l.variantGenId)}x${l.qty}@${l.unitPrice}`));
    const got = multiset(s.lines.map((l) => `${l.sku}x${l.qty}@${l.unitPrice}`));
    if (!same(want, got)) problems.push(`lines: expected ${want}, got ${got}`);
    if (s.totalDiscounts !== o.discountCents) problems.push(`discount total: expected ${dec(o.discountCents)}, got ${dec(s.totalDiscounts)}`);
    const wantCode = o.discountCode ?? "";
    const gotCode = [...s.discountCodes].sort().join(",");
    if (wantCode !== gotCode) problems.push(`discount code: expected "${wantCode}", got "${gotCode}"`);
    if (s.shipping !== o.shipping) problems.push(`shipping: expected ${dec(o.shipping)}, got ${dec(s.shipping)}`);
    if (multiset(o.tags) !== multiset(s.tags)) problems.push(`tags: expected ${o.tags.join(",")}, got ${s.tags.join(",")}`);
    const wantRefunds = sel.refunds.filter((r) => r.orderGenId === o.genId);
    if (s.refunds.length !== wantRefunds.length) problems.push(`${s.refunds.length} refund(s), dataset has ${wantRefunds.length}`);
    row(o.genId, "order", problems);
    if (problems.length === 0) matched++;

    for (const r of wantRefunds) {
      const hit = s.refunds.find((x) => iso(x.processedAt) === iso(r.processedAt));
      if (!hit) {
        row(r.genId, "refund", [s.refunds.length ? `no refund dated ${iso(r.processedAt)} (Shopify has ${s.refunds.map((x) => iso(x.processedAt)).join(", ")})` : "not found in Shopify"]);
        continue;
      }
      const wantLines = multiset(r.lines.map((l) => `${skuOf.get(l.variantGenId)}x${l.qty}`));
      const gotLines = multiset(hit.lines.map((l) => `${l.sku}x${l.qty}`));
      row(r.genId, "refund", same(wantLines, gotLines) ? [] : [`lines: expected ${wantLines}, got ${gotLines}`]);
    }
  }
  const ok = rows.every((r) => r.status === "PASS") && unexpected.length === 0;
  return {
    rows,
    unexpected,
    counts: { shopifyOrders: shopify.length, expectedOrders: sel.orders.length, matchedOrders: matched, outsideSelection },
    ok,
  };
}

export interface PilotDeps {
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
  readDataset?: (store: StoreKey) => Dataset;
  log?: (line: string) => void;
}

export async function runPilotCheck(argv: string[], deps: PilotDeps = {}): Promise<number> {
  const log = deps.log ?? ((l: string) => console.log(l));
  const env = deps.env ?? process.env;
  let values;
  try {
    ({ values } = parseArgs({ args: argv, options: { store: { type: "string" }, limit: { type: "string" }, "extra-refunded": { type: "string" } }, strict: true }));
  } catch (e) {
    log(`${(e as Error).message}\nusage: npm run seed:pilot-check -- --store solenne|tidepool [--limit N] [--extra-refunded N]`);
    return 2;
  }
  const store = values.store;
  if (store !== "solenne" && store !== "tidepool") {
    log("--store solenne|tidepool is required.");
    return 2;
  }
  const cfg = STORES[store];
  const missing = [cfg.shopDomainEnv, "SEEDER_CLIENT_ID", "SEEDER_CLIENT_SECRET"].filter((k) => !env[k]);
  if (missing.length) {
    log(`Missing from .env.local: ${missing.join(", ")}`);
    return 2;
  }
  const ds = (deps.readDataset ?? readDataset)(store);
  const sel = selectRecords(ds, {
    limit: values.limit === undefined ? undefined : Number(values.limit),
    extraRefunded: values["extra-refunded"] === undefined ? undefined : Number(values["extra-refunded"]),
  });
  log(`Reading ${cfg.name} (${env[cfg.shopDomainEnv]}) through the Admin API, read-only.`);
  const client = createAdminClient({ shop: env[cfg.shopDomainEnv]!, clientId: env.SEEDER_CLIENT_ID!, clientSecret: env.SEEDER_CLIENT_SECRET!, fetch: deps.fetch });
  let shopify: ShopifyOrder[];
  try {
    shopify = await readOrders(client);
  } catch (e) {
    log(`READ FAILED. ${explainAdminError(e)}`);
    return 1;
  }
  log("The read worked: the app can see orders.");
  const c = compare(ds, sel, shopify);
  for (const r of c.rows) log(`${r.status}  ${r.id.padEnd(9)} ${r.problems.join("; ")}`.trimEnd());
  for (const u of c.unexpected) log(`FAIL  ${u}  (in Shopify but not in the dataset)`);
  log(`Orders in Shopify: ${c.counts.shopifyOrders}; expected for this run: ${c.counts.expectedOrders}; matched: ${c.counts.matchedOrders}` +
    (c.counts.outsideSelection ? `; ${c.counts.outsideSelection} more from the dataset outside this selection (not checked)` : ""));
  log(`Refunds checked: ${c.rows.filter((r) => r.kind === "refund").length}`);
  log(c.ok ? "PASS: Shopify holds what the dataset says." : "FAIL: see the rows above.");
  return c.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.loadEnvFile(".env.local");
  } catch {
    // runCli-style: missing variables are reported by name below
  }
  runPilotCheck(process.argv.slice(2)).then((code) => process.exit(code));
}
