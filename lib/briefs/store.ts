import { and, desc, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { briefs, type BriefStatus } from "../db/schema";
import { AppError } from "../errors";
import { isUuid } from "../ids";
import { NotAllowedError } from "../memory/store";
import type { TenantContext } from "../tenancy/context";
import { isReviewer } from "../actions/reviewer";
import { deliverBrief } from "./deliver";

export interface BriefItem {
  id: string;
  weekStart: string;
  status: BriefStatus;
  body: string;
  unmatched: string[];
  approvedBy: string | null;
  approvedAt: Date | null;
  delivered: boolean;
}

const canApprove = (ctx: TenantContext) => ctx.role === "gc_admin" || ctx.role === "gc_partner";

// This brand's briefs, newest week first. Drafts and blocked ones are Growth Capital's working copies, so a client viewer
// sees only the approved ones.
export async function listBriefs(db: Db, ctx: TenantContext, limit = 12): Promise<BriefItem[]> {
  const mine = eq(briefs.tenantId, ctx.tenantId);
  const rows = await db
    .select({ id: briefs.id, weekStart: briefs.weekStart, status: briefs.status, body: briefs.body, unmatched: briefs.unmatched, approvedBy: briefs.approvedBy, approvedAt: briefs.approvedAt, delivered: briefs.delivered })
    .from(briefs)
    .where(canApprove(ctx) ? mine : and(mine, eq(briefs.status, "approved")))
    .orderBy(desc(briefs.weekStart))
    .limit(limit);
  return rows;
}

// A Growth Capital admin or partner approves a draft, which hands it to delivery. A blocked brief (it holds a figure the
// number checker could not match) can't be approved. Approving again does nothing: the update is conditional on "draft", so
// only the call that wins it delivers. Null when there is no such brief in this brand.
export async function approveBrief(db: Db, ctx: TenantContext, id: string, env: Record<string, string | undefined> = process.env): Promise<"approved" | "already_approved" | null> {
  if (!canApprove(ctx)) throw new NotAllowedError();
  if (!isUuid(id)) return null;
  const [row] = await db.select({ status: briefs.status, weekStart: briefs.weekStart }).from(briefs).where(and(eq(briefs.id, id), eq(briefs.tenantId, ctx.tenantId)));
  if (!row) return null;
  if (row.status === "blocked") throw new AppError("INVALID_INPUT", "This brief has a figure the number checker could not match, so it can't be approved.");
  if (isReviewer(ctx.userId, env)) {
    // A reviewer login's approval is a dry run: it is logged, and the brief stays a draft for the real approver.
    console.info("[brief] dry run", JSON.stringify({ tenantId: ctx.tenantId, week: row.weekStart, briefId: id }));
    return "approved";
  }

  const [done] = await db
    .update(briefs)
    .set({ status: "approved", approvedBy: ctx.userId, approvedAt: new Date() })
    .where(and(eq(briefs.id, id), eq(briefs.tenantId, ctx.tenantId), eq(briefs.status, "draft")))
    .returning({ id: briefs.id, weekStart: briefs.weekStart });
  if (!done) return "already_approved";
  try {
    await deliverBrief(db, ctx, done, env);
  } catch (e) {
    // The approval stands and `delivered` stays false, so an undelivered brief can be found and retried.
    console.error("[brief] delivery failed:", e instanceof AppError ? e.code : e instanceof Error ? e.name : "unknown");
  }
  return "approved";
}
