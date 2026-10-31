import { and, asc, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { actionItems, documents, type ActionItemStatus } from "../db/schema";
import { isUuid } from "../ids";
import { assertCanManageNotes } from "../call-notes/access";
import type { TenantContext } from "../tenancy/context";

// Follow-ups that a Growth Capital admin or partner confirmed from a call note. Every query is filtered by the session's brand,
// and a client viewer gets nothing. `title`, `owner` and `quote` come from note text, so they are only ever shown as text.

export const MAX_ITEMS_SHOWN = 100;

export interface ActionItemRow {
  id: string;
  title: string;
  owner: string;
  dueOn: string | null;
  status: ActionItemStatus;
  quote: string;
  source: string | null; // the call note's title, when it still exists
  createdAt: string;
  doneAt: string | null;
}

// Today in the store's time zone as YYYY-MM-DD (UTC when there is no store).
export function todayFor(ctx: Pick<TenantContext, "shop">, now: Date = new Date()): string {
  const tz = ctx.shop?.timezone ?? "UTC";
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

export const isOverdue = (item: Pick<ActionItemRow, "dueOn" | "status">, today: string) => item.status === "open" && item.dueOn !== null && item.dueOn < today;

// Items with a due date come first, soonest first; items with none come last, oldest first.
async function load(db: Db, ctx: TenantContext, status: ActionItemStatus | undefined): Promise<ActionItemRow[]> {
  assertCanManageNotes(ctx);
  const rows = await db
    .select({
      id: actionItems.id,
      title: actionItems.title,
      owner: actionItems.owner,
      dueOn: actionItems.dueOn,
      status: actionItems.status,
      quote: actionItems.quote,
      source: documents.label,
      createdAt: actionItems.createdAt,
      doneAt: actionItems.doneAt,
    })
    .from(actionItems)
    .leftJoin(documents, and(eq(documents.id, actionItems.sourceDocumentId), eq(documents.tenantId, actionItems.tenantId)))
    .where(and(eq(actionItems.tenantId, ctx.tenantId), status ? eq(actionItems.status, status) : undefined))
    .orderBy(sql`${actionItems.dueOn} asc nulls last`, asc(actionItems.createdAt), asc(actionItems.id))
    .limit(MAX_ITEMS_SHOWN);
  return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString(), doneAt: r.doneAt ? r.doneAt.toISOString() : null }));
}

export const listOpenItems = (db: Db, ctx: TenantContext): Promise<ActionItemRow[]> => load(db, ctx, "open");
export const listItems = (db: Db, ctx: TenantContext, status?: ActionItemStatus): Promise<ActionItemRow[]> => load(db, ctx, status);

// True when an open item of this brand is now done; false when there is no such item or it was already done.
export async function markDone(db: Db, ctx: TenantContext, id: string): Promise<boolean> {
  assertCanManageNotes(ctx);
  if (!isUuid(id)) return false;
  const done = await db
    .update(actionItems)
    .set({ status: "done", doneAt: new Date() })
    .where(and(eq(actionItems.id, id), eq(actionItems.tenantId, ctx.tenantId), eq(actionItems.status, "open")))
    .returning({ id: actionItems.id });
  return done.length > 0;
}
