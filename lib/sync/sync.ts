import { getTableColumns, sql } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import type { Db } from "../db/client";
import { customers, inventoryLevels, orderLines, orders, products, refundLines, refunds, syncRuns, variants } from "../db/schema";
import { mapOrder, mapProduct, type OrderNode, type ProductNode } from "./map";
import { SYNC_ORDERS, SYNC_PRODUCTS } from "./queries";

// The sync talks to Shopify through this, so tests can fake it. Production binds it to shopifyGraphql and the
// tenant's decrypted token.
export type GraphqlFn = <T>(query: string, variables?: Record<string, unknown>) => Promise<T>;

export interface SyncInput {
  db: Db;
  tenantId: string; // from the Clerk session, a webhook's verified shop, or the cron job: never from the model
  timezone: string;
  graphql: GraphqlFn;
  runId?: string; // a run that beginSync already recorded; without one, syncStore records its own
}

export interface SyncResult {
  runId: string;
  counts: Record<string, number>;
}

// ON CONFLICT ... DO UPDATE SET every column except the key from the incoming row.
function overwrite(table: PgTable, keep: string[]) {
  return Object.fromEntries(
    Object.entries(getTableColumns(table))
      .filter(([key]) => !keep.includes(key))
      .map(([key, col]) => [key, sql.raw(`excluded."${col.name}"`)]),
  );
}

type MappedOrder = ReturnType<typeof mapOrder>;

// Postgres allows 65,535 parameters per statement; rows go in chunks well under that.
function* chunks<T>(rows: T[], size = 500): Generator<T[]> {
  for (let i = 0; i < rows.length; i += size) yield rows.slice(i, i + size);
}

// Every write is an upsert on (tenant, id). Nothing here deletes: when Shopify stops returning an order (the 60-day
// window), the copy we hold stays. The sync writes a page of orders in one transaction, and the orders/create webhook
// writes one, through this same function, so a duplicate or concurrent delivery or a resync repeats the same writes.
export async function upsertOrders(db: Db, batch: MappedOrder[]): Promise<void> {
  if (batch.length === 0) return;
  await db.transaction(async (tx) => {
    // One statement can't touch the same row twice, so a customer who appears in several orders is merged first,
    // keeping their earliest order.
    const customerRows = new Map<string, NonNullable<MappedOrder["customer"]>>();
    for (const m of batch) {
      if (!m.customer) continue;
      const seen = customerRows.get(m.customer.id);
      if (!seen || m.customer.firstSeenAt < seen.firstSeenAt) customerRows.set(m.customer.id, m.customer);
    }
    for (const rows of chunks([...customerRows.values()])) {
      await tx
        .insert(customers)
        .values(rows)
        .onConflictDoUpdate({ target: [customers.tenantId, customers.id], set: { firstSeenAt: sql`least(${customers.firstSeenAt}, excluded."first_seen_at")` } });
    }
    for (const rows of chunks(batch.map((m) => m.order))) {
      await tx.insert(orders).values(rows).onConflictDoUpdate({ target: [orders.tenantId, orders.id], set: overwrite(orders, ["tenantId", "id"]) });
    }
    for (const rows of chunks(batch.flatMap((m) => m.lines))) {
      await tx.insert(orderLines).values(rows).onConflictDoUpdate({ target: [orderLines.tenantId, orderLines.id], set: overwrite(orderLines, ["tenantId", "id"]) });
    }
    for (const rows of chunks(batch.flatMap((m) => m.refunds.map((r) => r.refund)))) {
      await tx.insert(refunds).values(rows).onConflictDoUpdate({ target: [refunds.tenantId, refunds.id], set: overwrite(refunds, ["tenantId", "id"]) });
    }
    for (const rows of chunks(batch.flatMap((m) => m.refunds.flatMap((r) => r.lines)))) {
      await tx.insert(refundLines).values(rows).onConflictDoUpdate({ target: [refundLines.tenantId, refundLines.id], set: overwrite(refundLines, ["tenantId", "id"]) });
    }
  });
}

export const upsertOrder = (db: Db, mapped: MappedOrder): Promise<void> => upsertOrders(db, [mapped]);

async function upsertProduct(db: Db, mapped: ReturnType<typeof mapProduct>): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .insert(products)
      .values(mapped.product)
      .onConflictDoUpdate({ target: [products.tenantId, products.id], set: { ...overwrite(products, ["tenantId", "id"]), syncedAt: sql`now()` } });
    if (mapped.variants.length > 0) {
      await tx
        .insert(variants)
        .values(mapped.variants)
        .onConflictDoUpdate({ target: [variants.tenantId, variants.id], set: { ...overwrite(variants, ["tenantId", "id"]), syncedAt: sql`now()` } });
    }
    if (mapped.levels.length > 0) {
      await tx
        .insert(inventoryLevels)
        .values(mapped.levels)
        .onConflictDoUpdate({
          target: [inventoryLevels.tenantId, inventoryLevels.variantId, inventoryLevels.locationId],
          set: { ...overwrite(inventoryLevels, ["tenantId", "variantId", "locationId"]), syncedAt: sql`now()` },
        });
    }
  });
}

interface Page<T> {
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
  nodes: T[];
}

async function* pages<T>(graphql: GraphqlFn, query: string, field: "products" | "orders"): AsyncGenerator<T[]> {
  let after: string | null = null;
  for (;;) {
    const data: Record<string, Page<T>> = await graphql(query, { after });
    const page = data[field]!;
    yield page.nodes;
    if (!page.pageInfo.hasNextPage) return;
    after = page.pageInfo.endCursor;
  }
}

// Reads the whole store through ordinary paged queries (not a bulk operation) and upserts it page by page.
export async function syncStore({ db, tenantId, timezone, graphql, runId: given }: SyncInput): Promise<SyncResult> {
  const runId = given ?? (await db.insert(syncRuns).values({ tenantId }).returning({ id: syncRuns.id }))[0]!.id;
  const counts = { products: 0, orders: 0 };
  try {
    for await (const nodes of pages<ProductNode>(graphql, SYNC_PRODUCTS, "products")) {
      for (const node of nodes) await upsertProduct(db, mapProduct(tenantId, node));
      counts.products += nodes.length;
    }
    for await (const nodes of pages<OrderNode>(graphql, SYNC_ORDERS, "orders")) {
      await upsertOrders(db, nodes.map((node) => mapOrder(tenantId, timezone, node)));
      counts.orders += nodes.length;
    }
    await db.update(syncRuns).set({ status: "succeeded", finishedAt: new Date(), counts }).where(sql`${syncRuns.id} = ${runId}`);
    return { runId, counts };
  } catch (e) {
    await db
      .update(syncRuns)
      .set({ status: "failed", finishedAt: new Date(), counts, error: e instanceof Error ? e.message : String(e) })
      .where(sql`${syncRuns.id} = ${runId}`);
    throw e;
  }
}
