import { and, eq, lt } from "drizzle-orm";
import { decryptSecret } from "../crypto/secrets";
import type { Db } from "../db/client";
import { shopConnections, syncRuns } from "../db/schema";
import { shopifyGraphql } from "../shopify/client";
import type { Role } from "../tenancy/context";
import { syncStore, type GraphqlFn, type SyncResult } from "./sync";

// A run that has shown no result for this long is treated as dead (the function was killed), so it can't block syncs.
export const STALE_RUN_MS = 15 * 60 * 1000;

// Reading the store's data is harmless, so GC partners may resync as well as admins. A client viewer may not.
export const canResync = (role: Role): boolean => role === "gc_admin" || role === "gc_partner";

export type BeginResult = { ok: true; runId: string } | { ok: false; reason: "already_running" | "not_connected" };

export interface ExecuteDeps {
  graphql?: GraphqlFn; // tests inject a fake Shopify
}

async function connectedShop(db: Db, tenantId: string) {
  const [conn] = await db
    .select()
    .from(shopConnections)
    .where(and(eq(shopConnections.tenantId, tenantId), eq(shopConnections.status, "connected")))
    .limit(1);
  return conn?.tokenEnc ? conn : null;
}

// Records that a sync is starting, or says why it can't. Two clicks, or a click during the nightly job, start one
// run, not two. (Two simultaneous callers could both pass the check; the second run would repeat the same upserts.)
export async function beginSync(db: Db, tenantId: string, now: Date = new Date()): Promise<BeginResult> {
  if (!(await connectedShop(db, tenantId))) return { ok: false, reason: "not_connected" };

  await db
    .update(syncRuns)
    .set({ status: "failed", finishedAt: now, error: "abandoned: no result after 15 minutes" })
    .where(and(eq(syncRuns.tenantId, tenantId), eq(syncRuns.status, "running"), lt(syncRuns.startedAt, new Date(now.getTime() - STALE_RUN_MS))));
  const [running] = await db.select({ id: syncRuns.id }).from(syncRuns).where(and(eq(syncRuns.tenantId, tenantId), eq(syncRuns.status, "running"))).limit(1);
  if (running) return { ok: false, reason: "already_running" };

  const [run] = await db.insert(syncRuns).values({ tenantId, startedAt: now }).returning({ id: syncRuns.id });
  return { ok: true, runId: run!.id };
}

// Does the work of a run beginSync recorded. Never throws: the outcome, good or bad, is on the sync_runs row.
export async function executeSync(db: Db, tenantId: string, runId: string, deps: ExecuteDeps = {}): Promise<SyncResult | null> {
  try {
    const conn = await connectedShop(db, tenantId);
    if (!conn) {
      await db.update(syncRuns).set({ status: "failed", finishedAt: new Date(), error: "The store is disconnected." }).where(eq(syncRuns.id, runId));
      return null;
    }
    const graphql: GraphqlFn = deps.graphql ?? ((query, variables) => shopifyGraphql({ shopDomain: conn.shopDomain, accessToken: decryptSecret(conn.tokenEnc!) }, query, variables));
    return await syncStore({ db, tenantId, timezone: conn.timezone, graphql, runId });
  } catch (e) {
    // syncStore has already marked the run failed; this covers a failure before it started.
    await db
      .update(syncRuns)
      .set({ status: "failed", finishedAt: new Date(), error: e instanceof Error ? e.message : String(e) })
      .where(and(eq(syncRuns.id, runId), eq(syncRuns.status, "running")));
    return null;
  }
}

// Records the run now and hands the slow part to `schedule` (Next's after(), which runs once the response is sent).
export async function startSync(db: Db, tenantId: string, schedule: (work: () => Promise<void>) => void, deps: ExecuteDeps = {}): Promise<BeginResult> {
  const begun = await beginSync(db, tenantId);
  if (begun.ok) schedule(async () => void (await executeSync(db, tenantId, begun.runId, deps)));
  return begun;
}
