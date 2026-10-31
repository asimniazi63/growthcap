import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { shopConnections, tenants } from "../db/schema";
import { AppError } from "../errors";
import { generateBrief, mondayOf, type BriefDeps } from "./generate";

export interface BriefCounts {
  drafted: number;
  blocked: number;
  skipped: number; // a brief for the week already existed
  failed: number;
}

// The weekly job: one brief per brand with a connected store, one after another. A brand that fails is counted and logged by
// its code only, and the rest still run. Fine for a few brands; many would need one invocation per brand.
export async function generateAllBriefs(db: Db, deps: BriefDeps = {}): Promise<BriefCounts> {
  const week = mondayOf(deps.now ?? new Date());
  const rows = await db
    .select({ id: tenants.id, orgId: tenants.orgId, name: tenants.name, domain: shopConnections.shopDomain, timezone: shopConnections.timezone, currency: shopConnections.currency })
    .from(shopConnections)
    .innerJoin(tenants, eq(tenants.id, shopConnections.tenantId))
    .where(eq(shopConnections.status, "connected"));

  const counts: BriefCounts = { drafted: 0, blocked: 0, skipped: 0, failed: 0 };
  for (const r of rows) {
    try {
      const shop = { domain: r.domain, timezone: r.timezone, currency: r.currency, status: "connected" as const };
      const res = await generateBrief(db, { id: r.id, orgId: r.orgId, name: r.name, shop }, week, deps);
      if (res.outcome === "draft") counts.drafted++;
      else if (res.outcome === "blocked") counts.blocked++;
      else counts.skipped++;
    } catch (e) {
      counts.failed++;
      console.error(`[brief] ${r.id} failed:`, e instanceof AppError ? e.code : e instanceof Error ? e.name : "unknown");
    }
  }
  return counts;
}
