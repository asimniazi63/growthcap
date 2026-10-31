import { and, count, desc, eq, isNull, max, min } from "drizzle-orm";
import type { Db } from "../db/client";
import { customers, orders, products, refunds, syncRuns, variants } from "../db/schema";

export interface SyncStatus {
  counts: { orders: number; refunds: number; products: number; variants: number; customers: number };
  firstOrderDate: string | null;
  lastOrderDate: string | null;
  asOf: string | null; // when a row was last written, by a sync or a webhook
  running: boolean;
  lastRun: { status: "running" | "succeeded" | "failed"; startedAt: string; finishedAt: string | null; error: string | null } | null;
}

// What /connect shows: what is synced and how fresh it is. Tenant-scoped like everything else.
export async function getSyncStatus(db: Db, tenantId: string): Promise<SyncStatus> {
  const n = async (table: typeof orders | typeof refunds | typeof products | typeof variants | typeof customers) =>
    (await db.select({ n: count() }).from(table).where(eq(table.tenantId, tenantId)))[0]!.n;
  const [w] = await db
    .select({ first: min(orders.localDate), last: max(orders.localDate), at: max(orders.syncedAt) })
    .from(orders)
    .where(and(eq(orders.tenantId, tenantId), isNull(orders.cancelledAt)));
  const [run] = await db.select().from(syncRuns).where(eq(syncRuns.tenantId, tenantId)).orderBy(desc(syncRuns.startedAt)).limit(1);
  const [running] = await db.select({ id: syncRuns.id }).from(syncRuns).where(and(eq(syncRuns.tenantId, tenantId), eq(syncRuns.status, "running"))).limit(1);

  return {
    counts: { orders: await n(orders), refunds: await n(refunds), products: await n(products), variants: await n(variants), customers: await n(customers) },
    firstOrderDate: w?.first ?? null,
    lastOrderDate: w?.last ?? null,
    asOf: w?.at ? new Date(w.at).toISOString() : null,
    running: Boolean(running),
    lastRun: run ? { status: run.status, startedAt: run.startedAt.toISOString(), finishedAt: run.finishedAt?.toISOString() ?? null, error: run.error } : null,
  };
}
