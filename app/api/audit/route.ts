import { json, withTenant } from "@/lib/api/respond";
import { generateAudit } from "@/lib/audit/generate";
import { canAudit, ranRecently } from "@/lib/audit/store";
import { getDb } from "@/lib/db/client";
import { AppError } from "@/lib/errors";

export const runtime = "nodejs";
export const maxDuration = 120; // the fixed checks, then one agent run and at most one repair turn

// Brands whose audit is running in this instance, so a double click can't start a second one before the first is saved.
// The 10-minute check against the audits table covers the rest.
const running = new Set<string>();

// A Growth Capital admin or partner runs the growth audit for the signed-in brand. The brand, the person and the role come from
// the Clerk session; the request has no body that names any of them. A paid call, so at most one run per brand per 10 minutes.
export const POST = () =>
  withTenant(async (ctx) => {
    if (!canAudit(ctx)) return json({ error: "FORBIDDEN" }, 403);
    if (!ctx.shop || ctx.shop.status !== "connected") throw new AppError("STORE_DISCONNECTED", "The store is not connected, so it can't be audited. Reconnect it and try again.");
    const db = getDb();
    if (running.has(ctx.tenantId) || (await ranRecently(db, ctx.tenantId))) return json({ error: "TOO_MANY_REQUESTS", message: "This brand's audit ran a few minutes ago. Try again in 10 minutes." }, 429);
    running.add(ctx.tenantId);
    try {
      const result = await generateAudit(db, { id: ctx.tenantId, orgId: ctx.orgId, shop: ctx.shop }, { userId: ctx.userId, role: ctx.role });
      return json({ status: result.outcome, id: result.auditId });
    } finally {
      running.delete(ctx.tenantId);
    }
  });
