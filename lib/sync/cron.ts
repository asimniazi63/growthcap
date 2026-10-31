import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { shopConnections, syncRuns } from "../db/schema";
import { beginSync, executeSync } from "./run";
import type { GraphqlFn } from "./sync";

export interface RefreshOutcome {
  tenantId: string;
  shopDomain: string;
  outcome: "synced" | "failed" | "skipped_running";
}

export interface RefreshDeps {
  graphqlFor?: (shopDomain: string) => GraphqlFn | undefined; // tests inject a fake Shopify per shop
}

// The nightly job: re-runs the paged sync for every connected store, one after another. Fine at demo scale; the
// production plan replaces it with an incremental sync. A failure in one store doesn't stop the rest.
export async function refreshAll(db: Db, deps: RefreshDeps = {}): Promise<RefreshOutcome[]> {
  const conns = await db.select().from(shopConnections).where(eq(shopConnections.status, "connected"));
  const out: RefreshOutcome[] = [];
  for (const conn of conns) {
    const base = { tenantId: conn.tenantId, shopDomain: conn.shopDomain };
    const begun = await beginSync(db, conn.tenantId);
    if (!begun.ok) {
      if (begun.reason === "already_running") out.push({ ...base, outcome: "skipped_running" });
      continue; // not connected any more: nothing to refresh
    }
    await executeSync(db, conn.tenantId, begun.runId, { graphql: deps.graphqlFor?.(conn.shopDomain) });
    const [run] = await db.select({ status: syncRuns.status }).from(syncRuns).where(eq(syncRuns.id, begun.runId));
    out.push({ ...base, outcome: run?.status === "succeeded" ? "synced" : "failed" });
  }
  return out;
}
