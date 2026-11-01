import { and, desc, eq, gte } from "drizzle-orm";
import type { Db } from "../db/client";
import { playbookRuns, type PlaybookRunStatus } from "../db/schema";
import type { TenantContext } from "../tenancy/context";
import { isPlaybookId, type PlaybookId, type PlaybookParams } from "./definitions";

export const canRunPlaybooks = (ctx: Pick<TenantContext, "role">): boolean => ctx.role === "gc_admin" || ctx.role === "gc_partner";

// One run per brand per playbook per 10 minutes, so a double click does not pay for two.
export const PLAYBOOK_COOLDOWN_MS = 10 * 60 * 1000;

const MAX_LIST = 100;

// createdBy is left out on purpose: the page shows what ran, not who ran it.
export interface PlaybookRunView {
  id: string;
  playbook: PlaybookId;
  params: PlaybookParams;
  status: PlaybookRunStatus;
  body: string;
  unmatched: string[];
  createdAt: Date;
}

// Only a well-formed month is passed on, whatever the stored row holds.
const paramsOf = (raw: unknown): PlaybookParams => {
  const month = (raw as { month?: unknown } | null)?.month;
  return typeof month === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? { month } : {};
};

// This brand's runs, newest first. The tenant is the session's, and a client viewer gets nothing. A row whose playbook this
// version no longer knows is skipped.
export async function listRuns(db: Db, ctx: Pick<TenantContext, "tenantId" | "role">, limit = 20): Promise<PlaybookRunView[]> {
  if (!canRunPlaybooks(ctx)) return [];
  const n = Math.max(1, Math.min(Math.floor(limit) || 1, MAX_LIST));
  const rows = await db.select().from(playbookRuns).where(eq(playbookRuns.tenantId, ctx.tenantId)).orderBy(desc(playbookRuns.createdAt)).limit(n);
  return rows.flatMap((r) =>
    isPlaybookId(r.playbook) ? [{ id: r.id, playbook: r.playbook, params: paramsOf(r.params), status: r.status, body: r.body, unmatched: r.unmatched, createdAt: r.createdAt }] : [],
  );
}

// True when this playbook ran for this brand within the cooldown.
export async function ranRecently(db: Db, tenantId: string, playbook: PlaybookId, now = new Date()): Promise<boolean> {
  const since = new Date(now.getTime() - PLAYBOOK_COOLDOWN_MS);
  const [row] = await db
    .select({ id: playbookRuns.id })
    .from(playbookRuns)
    .where(and(eq(playbookRuns.tenantId, tenantId), eq(playbookRuns.playbook, playbook), gte(playbookRuns.createdAt, since)))
    .limit(1);
  return !!row;
}
