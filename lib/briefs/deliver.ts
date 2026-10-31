import { and, eq } from "drizzle-orm";
import { isReviewer } from "../actions/reviewer";
import type { Db } from "../db/client";
import { briefs, tenants } from "../db/schema";
import { AppError } from "../errors";
import type { TenantContext } from "../tenancy/context";

// The one place a brief leaves the app. Today that is a log line; Slack will be added here, after the approval check, and
// nowhere else. Only an approved brief is delivered, and the body is never logged.
export async function deliverBrief(
  db: Db,
  ctx: Pick<TenantContext, "tenantId" | "userId">,
  brief: { id: string; weekStart: string },
  env: Record<string, string | undefined> = process.env,
): Promise<{ delivered: boolean }> {
  const [row] = await db.select({ status: briefs.status }).from(briefs).where(and(eq(briefs.id, brief.id), eq(briefs.tenantId, ctx.tenantId)));
  if (row?.status !== "approved") throw new AppError("INVALID_INPUT", "Only an approved brief can be delivered.");

  const [tenant] = await db.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, ctx.tenantId));
  const line = JSON.stringify({ brand: tenant?.name ?? ctx.tenantId, tenantId: ctx.tenantId, week: brief.weekStart, briefId: brief.id });
  // A reviewer's approval is a dry run: it shows what would go out and leaves the brief undelivered.
  if (isReviewer(ctx.userId, env)) {
    console.info("[brief] dry run", line);
    return { delivered: false };
  }
  console.info("[brief] delivered", line);
  await db.update(briefs).set({ delivered: true }).where(and(eq(briefs.id, brief.id), eq(briefs.tenantId, ctx.tenantId)));
  return { delivered: true };
}
