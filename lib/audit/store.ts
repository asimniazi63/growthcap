import { and, desc, eq, gte } from "drizzle-orm";
import type { Db } from "../db/client";
import { audits, type AuditStatus } from "../db/schema";
import type { TenantContext } from "../tenancy/context";
import type { AuditReport } from "./report";

export const canAudit = (ctx: Pick<TenantContext, "role">): boolean => ctx.role === "gc_admin" || ctx.role === "gc_partner";

// One run per brand per 10 minutes, so a double click does not pay for two audits.
export const AUDIT_COOLDOWN_MS = 10 * 60 * 1000;

export interface AuditItemView {
  id: string;
  status: AuditStatus;
  body: string;
  report: AuditReport | null; // null if the stored findings are not in the shape this version writes
  unmatched: string[];
  createdAt: Date;
}

const isReport = (v: unknown): v is AuditReport =>
  !!v && typeof v === "object" && (v as { version?: unknown }).version === 1 && Array.isArray((v as { findings?: unknown }).findings) && Array.isArray((v as { health?: unknown }).health);

// The newest audit of this brand. The tenant is the session's, and a client viewer gets nothing.
export async function latestAudit(db: Db, ctx: Pick<TenantContext, "tenantId" | "role">): Promise<AuditItemView | null> {
  if (!canAudit(ctx)) return null;
  const [row] = await db.select().from(audits).where(eq(audits.tenantId, ctx.tenantId)).orderBy(desc(audits.createdAt)).limit(1);
  if (!row) return null;
  return { id: row.id, status: row.status, body: row.body, report: isReport(row.findings) ? row.findings : null, unmatched: row.unmatched, createdAt: row.createdAt };
}

// True when this brand's audit ran within the cooldown.
export async function ranRecently(db: Db, tenantId: string, now = new Date()): Promise<boolean> {
  const since = new Date(now.getTime() - AUDIT_COOLDOWN_MS);
  const [row] = await db.select({ id: audits.id }).from(audits).where(and(eq(audits.tenantId, tenantId), gte(audits.createdAt, since))).limit(1);
  return !!row;
}
