// Loads a generated dataset into a dev store through the seeder app. Slow by design (5 orders a minute) and
// resumable: a journal marks each record in flight before its call and done after it, and an in-flight order is
// looked up by sourceIdentifier before it is created again.
//   npm run seed:load -- --store solenne --dry-run
//   npm run seed:load -- --store solenne --limit 20      (the pilot)
//   npm run seed:load -- --store solenne                 (the full load)
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { Journal, type JournalEntry, type JournalKind } from "./journal.js";
import { createLimiter, type Limiter } from "./limiter.js";
import * as q from "./queries.js";
import { readDataset, selectRecords, type Selection } from "./select.js";
import {
  assertNoUserErrors,
  createAdminClient,
  explainAdminError,
  ShopifyAdminError,
  UserErrorsError,
  type GraphqlClient,
  type UserError,
} from "./shopify-admin.js";
import { STORES } from "./stores.js";
import type { Dataset, Order, StoreKey } from "./types.js";

export const dec = (cents: number): string => `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const money = (cents: number, currency: string) => ({ shopMoney: { amount: dec(cents), currencyCode: currency } });
const orderTotal = (o: Order) => o.lines.reduce((s, l) => s + l.qty * l.unitPrice, 0) - o.discountCents + o.shipping;

// A deterministic UUID (v5-style) from a generator id, so a retried refund or stock call reuses its key.
export function idempotencyKey(store: StoreKey, kind: string, id: string): string {
  const h = createHash("sha1").update(`oasis-pace-seed:${store}:${kind}:${id}`).digest();
  h[6] = (h[6]! & 0x0f) | 0x50;
  h[8] = (h[8]! & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString("hex");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}

export function validateDataset(ds: Dataset, sel: Selection): void {
  const problems: string[] = [];
  const variants = new Set(ds.variants.map((v) => v.genId));
  const customers = new Set(ds.customers.map((c) => c.genId));
  const codes = new Set(ds.discounts.map((d) => d.code));
  const locations = new Set(ds.locations.map((l) => l.genId));
  const slugs = new Map<string, string>();
  for (const p of ds.products) {
    const s = slug(p.title);
    if (slugs.has(s)) problems.push(`products ${slugs.get(s)} and ${p.genId} would share the handle "${s}"`);
    slugs.set(s, p.genId);
  }
  for (const i of ds.inventory) {
    if (!variants.has(i.variantGenId)) problems.push(`inventory points at unknown variant ${i.variantGenId}`);
    if (!locations.has(i.locationGenId)) problems.push(`inventory points at unknown location ${i.locationGenId}`);
  }
  const ordered = new Map<string, Map<string, number>>();
  for (const o of sel.orders) {
    const seen = new Map<string, number>();
    for (const l of o.lines) {
      if (!variants.has(l.variantGenId)) problems.push(`order ${o.genId} has unknown variant ${l.variantGenId}`);
      if (seen.has(l.variantGenId)) problems.push(`order ${o.genId} has variant ${l.variantGenId} on two lines, so a refund couldn't tell them apart`);
      seen.set(l.variantGenId, l.qty);
    }
    ordered.set(o.genId, seen);
    if (!customers.has(o.customerGenId)) problems.push(`order ${o.genId} has unknown customer ${o.customerGenId}`);
    if (o.discountCode && !codes.has(o.discountCode)) problems.push(`order ${o.genId} uses unknown code ${o.discountCode}`);
  }
  for (const r of sel.refunds) {
    const lines = ordered.get(r.orderGenId);
    if (!lines) continue;
    for (const l of r.lines) {
      if ((lines.get(l.variantGenId) ?? 0) < l.qty) problems.push(`refund ${r.genId} refunds more ${l.variantGenId} than order ${r.orderGenId} has`);
    }
  }
  if (problems.length) throw new Error(`Dataset can't be loaded:\n  ${problems.slice(0, 10).join("\n  ")}`);
}

export interface Failure {
  kind: JournalKind;
  genId: string;
  messages: string[];
}

export interface LoadResult {
  created: Partial<Record<JournalKind, number>>;
  skipped: Partial<Record<JournalKind, number>>;
  recovered: Partial<Record<JournalKind, number>>; // found in Shopify after a crash, journaled without a new call
  failures: Failure[];
  aborted: boolean;
}

export interface LoadDeps {
  client: GraphqlClient;
  journal: Journal;
  orderLimiter: Limiter;
  log?: (line: string) => void;
  maxFailures?: number;
  // Shopify answers a burst of orders with a userError "Too many attempts. Please try again later."
  // That is a throttle, not bad data: wait and retry the same call instead of counting a failure.
  sleep?: (ms: number) => Promise<void>;
  throttleWaitMs?: number;
  maxThrottleRetries?: number;
}

interface Found {
  id: string;
  data?: unknown;
}
interface VariantIds {
  id: string;
  inventoryItemId: string;
}
interface ProductNode {
  id: string;
  variants: { nodes: { id: string; sku: string; inventoryItem: { id: string } }[] };
}
interface OrderNode {
  id: string;
  lineItems: { nodes: { id: string; variant: { id: string } | null }[] };
}

const CITY: Record<StoreKey, { city: string; zip: string; provinceCode: string }> = {
  solenne: { city: "New York", zip: "10001", provinceCode: "NY" },
  tidepool: { city: "Los Angeles", zip: "90001", provinceCode: "CA" },
};

class Abort extends Error {}

export async function loadStore(ds: Dataset, sel: Selection, deps: LoadDeps): Promise<LoadResult> {
  validateDataset(ds, sel);
  const { client, journal } = deps;
  const log = deps.log ?? (() => {});
  const maxFailures = deps.maxFailures ?? 5;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const throttleWaitMs = deps.throttleWaitMs ?? 60_000;
  const maxThrottleRetries = deps.maxThrottleRetries ?? 5;
  const isThrottle = (e: UserErrorsError) => e.messages.every((m) => /too many attempts|try again later/i.test(m));
  const store = ds.store;
  const currency = STORES[store].currency;
  const result: LoadResult = { created: {}, skipped: {}, recovered: {}, failures: [], aborted: false };
  const bump = (m: Partial<Record<JournalKind, number>>, k: JournalKind) => {
    m[k] = (m[k] ?? 0) + 1;
  };
  const fail = (kind: JournalKind, genId: string, messages: string[], fatal: boolean) => {
    result.failures.push({ kind, genId, messages });
    log(`FAILED ${kind} ${genId}: ${messages.join("; ")}`);
    if (fatal || result.failures.length >= maxFailures) throw new Abort();
  };

  interface Work {
    lookup?: () => Promise<Found | null>;
    adopt?: boolean; // look up even when the journal has no in-flight entry (locations that already exist)
    create: () => Promise<Found>;
  }
  // The one place the journal protocol lives: in flight BEFORE the call, done AFTER it, userErrors never done.
  async function step(kind: JournalKind, genId: string, work: Work, fatal = false): Promise<JournalEntry | undefined> {
    const existing = journal.get(kind, genId);
    if (existing?.status === "done") {
      bump(result.skipped, kind);
      return existing;
    }
    if (work.lookup && (existing?.status === "inflight" || work.adopt)) {
      const found = await work.lookup();
      if (found) {
        journal.markDone(kind, genId, found.id, found.data);
        bump(result.recovered, kind);
        return journal.get(kind, genId);
      }
    }
    journal.markInflight(kind, genId);
    try {
      let made: Found;
      for (let attempt = 0; ; attempt++) {
        try {
          made = await work.create();
          break;
        } catch (e) {
          if (!(e instanceof UserErrorsError) || !isThrottle(e) || attempt >= maxThrottleRetries) throw e;
          log(`${kind} ${genId}: Shopify says "Too many attempts"; waiting ${throttleWaitMs / 1000}s (retry ${attempt + 1} of ${maxThrottleRetries})`);
          await sleep(throttleWaitMs);
        }
      }
      journal.markDone(kind, genId, made.id, made.data);
      bump(result.created, kind);
      return journal.get(kind, genId);
    } catch (e) {
      if (e instanceof UserErrorsError) {
        fail(kind, genId, e.messages, fatal);
        return undefined;
      }
      throw e;
    }
  }

  const doneId = (kind: JournalKind, genId: string) => {
    const e = journal.get(kind, genId);
    return e?.status === "done" ? e.shopifyId : undefined;
  };

  try {
    // 1. Locations. A same-named location that already exists is adopted, not duplicated.
    let existingLocations: Map<string, string> | undefined;
    const locationsByName = async () =>
      (existingLocations ??= new Map(
        (await client.graphql<{ locations: { nodes: { id: string; name: string }[] } }>(q.LOCATIONS_LIST)).locations.nodes.map((l) => [l.name, l.id]),
      ));
    for (const loc of ds.locations) {
      await step(
        "location",
        loc.genId,
        {
          adopt: true,
          lookup: async () => {
            const id = (await locationsByName()).get(loc.name);
            return id ? { id } : null;
          },
          create: async () => {
            const data = await client.graphql<{ locationAdd: { location: { id: string } | null; userErrors: UserError[] } }>(q.LOCATION_ADD, {
              input: { name: loc.name, fulfillsOnlineOrders: true, address: { address1: "1 Example Street", countryCode: "US", ...CITY[store] } },
            });
            assertNoUserErrors("locationAdd", data.locationAdd.userErrors);
            if (!data.locationAdd.location) throw new Error("locationAdd returned no location");
            return { id: data.locationAdd.location.id };
          },
        },
        true,
      );
    }

    // 2. Collections
    for (const col of ds.collections) {
      await step(
        "collection",
        col.genId,
        {
          lookup: async () => {
            const n = (await client.graphql<{ collections: { nodes: { id: string }[] } }>(q.COLLECTION_LOOKUP, { q: `handle:${slug(col.title)}` })).collections.nodes[0];
            return n ? { id: n.id } : null;
          },
          create: async () => {
            const data = await client.graphql<{ collectionCreate: { collection: { id: string } | null; userErrors: UserError[] } }>(q.COLLECTION_CREATE, {
              collection: { title: col.title, handle: slug(col.title) },
            });
            assertNoUserErrors("collectionCreate", data.collectionCreate.userErrors);
            if (!data.collectionCreate.collection) throw new Error("collectionCreate returned no collection");
            return { id: data.collectionCreate.collection.id };
          },
        },
        true,
      );
    }

    // 3. Products and variants, with unit cost. Stock is stocked at 0 here and set at the very end.
    const variantIds = new Map<string, VariantIds>();
    const productResult = (p: { genId: string }, node: ProductNode): Found => {
      const bySku = new Map(ds.variants.filter((v) => v.productGenId === p.genId).map((v) => [v.sku, v.genId]));
      const variants: Record<string, VariantIds> = {};
      for (const n of node.variants.nodes) {
        const genId = bySku.get(n.sku);
        if (!genId) throw new Error(`Shopify returned variant sku ${n.sku} that product ${p.genId} doesn't have`);
        variants[genId] = { id: n.id, inventoryItemId: n.inventoryItem.id };
      }
      return { id: node.id, data: { variants } };
    };
    for (const p of ds.products) {
      const mine = ds.variants.filter((v) => v.productGenId === p.genId);
      const handle = slug(p.title);
      await step(
        "product",
        p.genId,
        {
          lookup: async () => {
            const data = await client.graphql<{ productByIdentifier: ProductNode | null }>(q.PRODUCT_LOOKUP, { handle });
            return data.productByIdentifier ? productResult(p, data.productByIdentifier) : null;
          },
          create: async () => {
            const optionName = mine.length === 1 && mine[0]!.title === "Default Title" ? "Title" : "Variant";
            const collections = p.collectionGenIds.map((id) => doneId("collection", id)).filter((id): id is string => Boolean(id));
            const input = {
              title: p.title,
              handle,
              descriptionHtml: `<p>${escapeHtml(p.description)}</p>`,
              status: "ACTIVE",
              vendor: STORES[store].name,
              collections,
              productOptions: [{ name: optionName, values: mine.map((v) => ({ name: v.title })) }],
              variants: mine.map((v) => ({
                optionValues: [{ optionName, name: v.title }],
                price: dec(v.price),
                sku: v.sku,
                inventoryItem: { sku: v.sku, cost: dec(v.unitCost), tracked: true },
                inventoryQuantities: ds.inventory
                  .filter((i) => i.variantGenId === v.genId)
                  .map((i) => ({ locationId: doneId("location", i.locationGenId)!, name: "available", quantity: 0 })),
              })),
            };
            const data = await client.graphql<{ productSet: { product: ProductNode | null; userErrors: UserError[] } }>(q.PRODUCT_SET, { input });
            assertNoUserErrors("productSet", data.productSet.userErrors);
            if (!data.productSet.product) throw new Error("productSet returned no product");
            return productResult(p, data.productSet.product);
          },
        },
        true,
      );
    }
    for (const p of ds.products) {
      const data = journal.get("product", p.genId)?.data as { variants: Record<string, VariantIds> } | undefined;
      for (const [genId, ids] of Object.entries(data?.variants ?? {})) variantIds.set(genId, ids);
    }
    const genIdByVariantId = new Map([...variantIds].map(([genId, v]) => [v.id, genId]));

    // 4. Discount codes
    for (const d of ds.discounts) {
      await step(
        "discount",
        d.code,
        {
          lookup: async () => {
            const n = (await client.graphql<{ codeDiscountNodeByCode: { id: string } | null }>(q.DISCOUNT_LOOKUP, { code: d.code })).codeDiscountNodeByCode;
            return n ? { id: n.id } : null;
          },
          create: async () => {
            const data = await client.graphql<{ discountCodeBasicCreate: { codeDiscountNode: { id: string } | null; userErrors: UserError[] } }>(q.DISCOUNT_CREATE, {
              basicCodeDiscount: {
                title: d.code,
                code: d.code,
                startsAt: "2025-01-01T00:00:00Z",
                context: { all: "ALL" },
                appliesOncePerCustomer: false,
                combinesWith: { productDiscounts: false, orderDiscounts: false, shippingDiscounts: false },
                customerGets: {
                  value: d.kind === "percent" ? { percentage: d.value / 100 } : { discountAmount: { amount: dec(d.value), appliesOnEachItem: false } },
                  items: { all: true },
                },
              },
            });
            assertNoUserErrors("discountCodeBasicCreate", data.discountCodeBasicCreate.userErrors);
            if (!data.discountCodeBasicCreate.codeDiscountNode) throw new Error("discountCodeBasicCreate returned no discount");
            return { id: data.discountCodeBasicCreate.codeDiscountNode.id };
          },
        },
        true,
      );
    }

    // 5. Customers: an example.com address built from the id, nothing else
    for (const c of sel.customers) {
      const email = `${c.genId.toLowerCase()}@example.com`;
      await step("customer", c.genId, {
        lookup: async () => {
          const n = (await client.graphql<{ customerByIdentifier: { id: string } | null }>(q.CUSTOMER_LOOKUP, { email })).customerByIdentifier;
          return n ? { id: n.id } : null;
        },
        create: async () => {
          const data = await client.graphql<{ customerCreate: { customer: { id: string } | null; userErrors: UserError[] } }>(q.CUSTOMER_CREATE, { input: { email } });
          assertNoUserErrors("customerCreate", data.customerCreate.userErrors);
          if (!data.customerCreate.customer) throw new Error("customerCreate returned no customer");
          return { id: data.customerCreate.customer.id };
        },
      });
    }

    // 6. Orders, in processedAt order
    const orderResult = (node: OrderNode): Found => {
      const lineItems: Record<string, string> = {};
      for (const li of node.lineItems.nodes) {
        const genId = li.variant ? genIdByVariantId.get(li.variant.id) : undefined;
        if (genId) lineItems[genId] = li.id;
      }
      return { id: node.id, data: { lineItems } };
    };
    let n = 0;
    for (const o of sel.orders) {
      n++;
      if (n % 10 === 0 || n === sel.orders.length) log(`orders ${n}/${sel.orders.length}`);
      const customerId = doneId("customer", o.customerGenId);
      if (!journal.isDone("order", o.genId) && !customerId) {
        fail("order", o.genId, [`customer ${o.customerGenId} isn't in Shopify yet`], false);
        continue;
      }
      await step("order", o.genId, {
        lookup: async () => {
          const node = (await client.graphql<{ orders: { nodes: OrderNode[] } }>(q.ORDER_LOOKUP, { q: `source_identifier:${o.genId}` })).orders.nodes[0];
          return node ? orderResult(node) : null;
        },
        create: async () => {
          await deps.orderLimiter.acquire();
          const input = {
            sourceIdentifier: o.genId,
            processedAt: o.processedAt,
            test: false,
            currency,
            tags: o.tags,
            ...(o.note ? { note: o.note } : {}),
            customer: { toAssociate: { id: customerId } },
            lineItems: o.lines.map((l) => ({
              variantId: variantIds.get(l.variantGenId)!.id,
              quantity: l.qty,
              priceSet: money(l.unitPrice, currency),
              requiresShipping: true,
              taxable: false,
            })),
            ...(o.shipping > 0 ? { shippingLines: [{ title: "Standard shipping", code: "STANDARD", priceSet: money(o.shipping, currency) }] } : {}),
            // The exact discount in cents, so Shopify's total matches the dataset to the cent whatever its rounding.
            ...(o.discountCode ? { discountCode: { itemFixedDiscountCode: { code: o.discountCode, amountSet: money(o.discountCents, currency) } } } : {}),
            financialStatus: "PAID",
            transactions: [{ kind: "SALE", status: "SUCCESS", gateway: "manual", test: false, processedAt: o.processedAt, amountSet: money(orderTotal(o), currency) }],
          };
          const data = await client.graphql<{ orderCreate: { order: OrderNode | null; userErrors: UserError[] } }>(q.ORDER_CREATE, {
            order: input,
            options: { inventoryBehaviour: "BYPASS", sendReceipt: false, sendFulfillmentReceipt: false },
          });
          assertNoUserErrors("orderCreate", data.orderCreate.userErrors);
          if (!data.orderCreate.order) throw new Error("orderCreate returned no order and no userErrors");
          return orderResult(data.orderCreate.order);
        },
      });
    }

    // 7. Refunds, dated by their own processedAt
    for (const r of sel.refunds) {
      const orderEntry = journal.get("order", r.orderGenId);
      const orderId = orderEntry?.status === "done" ? orderEntry.shopifyId : undefined;
      if (!journal.isDone("refund", r.genId) && !orderId) {
        fail("refund", r.genId, [`order ${r.orderGenId} isn't in Shopify yet`], false);
        continue;
      }
      const lineItems = (orderEntry?.data as { lineItems: Record<string, string> } | undefined)?.lineItems ?? {};
      await step("refund", r.genId, {
        lookup: async () => {
          const refunds = (await client.graphql<{ order: { refunds: { id: string; processedAt: string }[] } | null }>(q.REFUND_LOOKUP, { id: orderId })).order?.refunds ?? [];
          const hit = refunds.find((x) => Date.parse(x.processedAt) === Date.parse(r.processedAt));
          return hit ? { id: hit.id } : null;
        },
        create: async () => {
          const input = {
            orderId,
            notify: false,
            processedAt: r.processedAt,
            note: r.reason,
            refundLineItems: r.lines.map((l) => {
              const lineItemId = lineItems[l.variantGenId];
              if (!lineItemId) throw new Error(`No Shopify line item for ${l.variantGenId} on order ${r.orderGenId}`);
              return { lineItemId, quantity: l.qty, restockType: "NO_RESTOCK" };
            }),
          };
          const data = await client.graphql<{ refundCreate: { refund: { id: string } | null; userErrors: UserError[] } }>(
            q.refundCreate(idempotencyKey(store, "refund", r.genId)),
            { input },
          );
          assertNoUserErrors("refundCreate", data.refundCreate.userErrors);
          if (!data.refundCreate.refund) throw new Error("refundCreate returned no refund and no userErrors");
          return { id: data.refundCreate.refund.id };
        },
      });
    }

    // 8. Stock, last, in batches. The key comes from the batch's content, so a retry reuses it.
    const rows = ds.inventory.map((i) => ({
      inventoryItemId: variantIds.get(i.variantGenId)?.inventoryItemId,
      locationId: doneId("location", i.locationGenId),
      quantity: i.available,
      changeFromQuantity: null,
    }));
    for (let i = 0; i < rows.length; i += 100) {
      const quantities = rows.slice(i, i + 100);
      const genId = `${i / 100}-${createHash("sha1").update(JSON.stringify(quantities)).digest("hex").slice(0, 12)}`;
      await step("inventory", genId, {
        create: async () => {
          const data = await client.graphql<{ inventorySetQuantities: { inventoryAdjustmentGroup: { id: string } | null; userErrors: UserError[] } }>(
            q.inventorySet(idempotencyKey(store, "inventory", genId)),
            { input: { name: "available", reason: "correction", quantities } },
          );
          assertNoUserErrors("inventorySetQuantities", data.inventorySetQuantities.userErrors);
          return { id: data.inventorySetQuantities.inventoryAdjustmentGroup?.id ?? genId };
        },
      });
    }
  } catch (e) {
    if (e instanceof Abort) result.aborted = true;
    else throw e;
  }
  return result;
}

export function describePlan(ds: Dataset, sel: Selection): string[] {
  const row = (label: string, n: number, extra = "") => `  ${label.padEnd(14)}${String(n).padStart(5)}${extra}`;
  return [
    row("locations", ds.locations.length),
    row("collections", ds.collections.length),
    row("products", ds.products.length, `  (${ds.variants.length} variants, with unit cost)`),
    row("discounts", ds.discounts.length),
    row("customers", sel.customers.length),
    row("orders", sel.orders.length, `  (about ${Math.ceil(sel.orders.length / 5)} min at 5 per minute)`),
    row("refunds", sel.refunds.length),
    row("stock rows", ds.inventory.length),
  ];
}

export interface CliDeps {
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
  readDataset?: (store: StoreKey) => Dataset;
  log?: (line: string) => void;
  journalDir?: string;
  sleep?: (ms: number) => Promise<void>;
}

const USAGE = `usage: npm run seed:load -- --store solenne|tidepool [--dry-run] [--limit N] [--extra-refunded N]
  --dry-run          print the plan and counts; no network calls
  --limit N          the pilot: the first N orders plus their refunds, plus the first 2 refunded orders from later
  --extra-refunded N how many refunded orders from beyond the limit to add (default 2)
A real load needs --store and writes to that store's shop.`;

export async function runCli(argv: string[], deps: CliDeps = {}): Promise<number> {
  const log = deps.log ?? ((l: string) => console.log(l));
  const env = deps.env ?? process.env;
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: { store: { type: "string" }, "dry-run": { type: "boolean" }, limit: { type: "string" }, "extra-refunded": { type: "string" }, help: { type: "boolean" } },
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
  const store = values.store;
  if (store !== "solenne" && store !== "tidepool") {
    log(`--store solenne|tidepool is required.\n${USAGE}`);
    return 2;
  }
  const num = (name: string, v: string | undefined) => (v === undefined ? undefined : /^\d+$/.test(v) ? Number(v) : NaN);
  const limit = num("limit", values.limit);
  const extraRefunded = num("extra-refunded", values["extra-refunded"]);
  if (Number.isNaN(limit) || Number.isNaN(extraRefunded)) {
    log(`--limit and --extra-refunded take whole numbers.\n${USAGE}`);
    return 2;
  }

  const ds = (deps.readDataset ?? readDataset)(store);
  const sel = selectRecords(ds, { limit, extraRefunded });
  validateDataset(ds, sel);
  const cfg = STORES[store];
  const shop = env[cfg.shopDomainEnv];
  log(`${values["dry-run"] ? "DRY RUN" : "Plan"} for ${cfg.name}${limit !== undefined ? ` (pilot: first ${limit} orders + ${extraRefunded ?? 2} refunded)` : " (full load)"}`);
  for (const line of describePlan(ds, sel)) log(line);
  if (values["dry-run"]) {
    log(`Dry run: no network calls were made. Shop: ${shop ?? `(${cfg.shopDomainEnv} not set)`}.`);
    return 0;
  }

  const missing = [cfg.shopDomainEnv, "SEEDER_CLIENT_ID", "SEEDER_CLIENT_SECRET"].filter((k) => !env[k]);
  if (missing.length) {
    log(`Missing from .env.local: ${missing.join(", ")}`);
    return 2;
  }
  log(`This writes to ${shop} (${cfg.name}) as the seeder app.`);
  const client = createAdminClient({ shop: shop!, clientId: env.SEEDER_CLIENT_ID!, clientSecret: env.SEEDER_CLIENT_SECRET!, fetch: deps.fetch, sleep: deps.sleep });
  const journal = Journal.open(`${deps.journalDir ?? ".seed-journal"}/${store}.json`, { store, shop: shop! });
  try {
    const result = await loadStore(ds, sel, { client, journal, orderLimiter: createLimiter({ perMinute: 5, sleep: deps.sleep }), log });
    const fmt = (m: Partial<Record<JournalKind, number>>) => Object.entries(m).map(([k, v]) => `${k} ${v}`).join(", ") || "none";
    log(`Created: ${fmt(result.created)}`);
    log(`Skipped (already done): ${fmt(result.skipped)}`);
    log(`Recovered after a crash (found in Shopify): ${fmt(result.recovered)}`);
    if (result.failures.length) log(`${result.failures.length} failure(s)${result.aborted ? ", run stopped" : ""}. Re-run to retry; done records are skipped.`);
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
    // no .env.local: runCli reports any missing variables by name
  }
  runCli(process.argv.slice(2)).then((code) => process.exit(code));
}
