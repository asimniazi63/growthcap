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

// Every write is an upsert on (tenant, id). Nothing here deletes: when Shopify stops returning an order (the 60-day
// window), the copy we hold stays. The same function serves the paged sync and the orders/create webhook, so a
// duplicate delivery or a resync can only repeat the same writes.
export async function upsertOrder(db: Db, mapped: ReturnType<typeof mapOrder>): Promise<void> {
  await db.transaction(async (tx) => {
    if (mapped.customer) {
      await tx
        .insert(customers)
        .values(mapped.customer)
        .onConflictDoUpdate({ target: [customers.tenantId, customers.id], set: { firstSeenAt: sql`least(${customers.firstSeenAt}, excluded."first_seen_at")` } });
    }
    await tx
      .insert(orders)
      .values(mapped.order)
      .onConflictDoUpdate({ target: [orders.tenantId, orders.id], set: overwrite(orders, ["tenantId", "id"]) });
    if (mapped.lines.length > 0) {
      await tx
        .insert(orderLines)
        .values(mapped.lines)
        .onConflictDoUpdate({ target: [orderLines.tenantId, orderLines.id], set: overwrite(orderLines, ["tenantId", "id"]) });
    }
    for (const r of mapped.refunds) {
      await tx
        .insert(refunds)
        .values(r.refund)
        .onConflictDoUpdate({ target: [refunds.tenantId, refunds.id], set: overwrite(refunds, ["tenantId", "id"]) });
      if (r.lines.length > 0) {
        await tx
          .insert(refundLines)
          .values(r.lines)
          .onConflictDoUpdate({ target: [refundLines.tenantId, refundLines.id], set: overwrite(refundLines, ["tenantId", "id"]) });
      }
    }
  });
}

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
export async function syncStore({ db, tenantId, timezone, graphql }: SyncInput): Promise<SyncResult> {
  const [run] = await db.insert(syncRuns).values({ tenantId }).returning({ id: syncRuns.id });
  const runId = run!.id;
  const counts = { products: 0, orders: 0 };
  try {
    for await (const nodes of pages<ProductNode>(graphql, SYNC_PRODUCTS, "products")) {
      for (const node of nodes) await upsertProduct(db, mapProduct(tenantId, node));
      counts.products += nodes.length;
    }
    for await (const nodes of pages<OrderNode>(graphql, SYNC_ORDERS, "orders")) {
      for (const node of nodes) await upsertOrder(db, mapOrder(tenantId, timezone, node));
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
