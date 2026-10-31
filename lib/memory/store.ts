import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { isUuid } from "../ids";
import { memories, type MemoryStatus } from "../db/schema";
import { AppError } from "../errors";
import type { TenantContext } from "../tenancy/context";

// Facts and preferences about a brand ("exclude wholesale from average order value"). The agent can only propose one; it
// is used in answers after a Growth Capital admin or partner confirms it, and the confirmed text is shown to them as
// written. Everything is scoped to the brand.

export const MAX_CONFIRMED = 20;
export const MAX_PROPOSED = 10;
export const MAX_CHARS = 280;

export class NotAllowedError extends Error {
  constructor() {
    super("Only a Growth Capital admin or partner can do this.");
    this.name = "NotAllowedError";
  }
}

const canManage = (ctx: TenantContext) => ctx.role === "gc_admin" || ctx.role === "gc_partner";

export function cleanMemory(text: string): string {
  const one = text.replace(/\s+/g, " ").trim();
  if (!one) throw new AppError("INVALID_INPUT", "A note can't be empty.");
  if (one.length > MAX_CHARS) throw new AppError("INVALID_INPUT", `A note can be at most ${MAX_CHARS} characters.`);
  if (/https?:\/\/|gid:\/\//i.test(one)) throw new AppError("INVALID_INPUT", "A note can't hold a link or a Shopify id.");
  return one;
}

export interface Memory {
  id: string;
  text: string;
  status: MemoryStatus;
}

export async function proposeMemory(db: Db, ctx: TenantContext, text: string): Promise<Memory> {
  const clean = cleanMemory(text);
  const open = await db
    .select({ id: memories.id, text: memories.text, status: memories.status })
    .from(memories)
    .where(and(eq(memories.tenantId, ctx.tenantId), inArray(memories.status, ["proposed", "confirmed"])));
  const same = open.find((m) => m.text.toLowerCase() === clean.toLowerCase());
  if (same) return same;
  if (open.filter((m) => m.status === "proposed").length >= MAX_PROPOSED) throw new AppError("INVALID_INPUT", "There are already notes waiting for a decision. Confirm or dismiss them first.");
  const [row] = await db.insert(memories).values({ tenantId: ctx.tenantId, text: clean, proposedBy: ctx.userId }).returning({ id: memories.id, text: memories.text, status: memories.status });
  return row!;
}

// Confirms or dismisses a note that is waiting. Null when there is no such waiting note in this brand.
export async function decideMemory(db: Db, ctx: TenantContext, id: string, action: "confirm" | "dismiss"): Promise<"confirmed" | "dismissed" | null> {
  if (!canManage(ctx)) throw new NotAllowedError();
  if (!isUuid(id)) return null;
  const status = action === "confirm" ? "confirmed" : "dismissed";
  return db.transaction(async (tx) => {
    if (action === "confirm") {
      const [n] = await tx.select({ n: sql<number>`count(*)::int` }).from(memories).where(and(eq(memories.tenantId, ctx.tenantId), eq(memories.status, "confirmed")));
      if ((n?.n ?? 0) >= MAX_CONFIRMED) throw new AppError("INVALID_INPUT", `There are already ${MAX_CONFIRMED} confirmed notes. Remove one first.`);
    }
    const done = await tx
      .update(memories)
      .set({ status, decidedBy: ctx.userId, decidedAt: new Date() })
      .where(and(eq(memories.id, id), eq(memories.tenantId, ctx.tenantId), eq(memories.status, "proposed")))
      .returning({ id: memories.id });
    return done.length > 0 ? status : null;
  });
}

export async function removeMemory(db: Db, ctx: TenantContext, id: string): Promise<boolean> {
  if (!canManage(ctx)) throw new NotAllowedError();
  if (!isUuid(id)) return false;
  const gone = await db.delete(memories).where(and(eq(memories.id, id), eq(memories.tenantId, ctx.tenantId))).returning({ id: memories.id });
  return gone.length > 0;
}

export async function confirmedNotes(db: Db, tenantId: string): Promise<string[]> {
  const rows = await db.select({ text: memories.text }).from(memories).where(and(eq(memories.tenantId, tenantId), eq(memories.status, "confirmed"))).orderBy(asc(memories.createdAt), asc(memories.id)).limit(MAX_CONFIRMED);
  return rows.map((r) => r.text);
}

export async function listMemories(db: Db, tenantId: string): Promise<(Memory & { createdAt: Date })[]> {
  return db
    .select({ id: memories.id, text: memories.text, status: memories.status, createdAt: memories.createdAt })
    .from(memories)
    .where(and(eq(memories.tenantId, tenantId), inArray(memories.status, ["proposed", "confirmed"])))
    .orderBy(sql`${memories.status} = 'confirmed' desc`, asc(memories.createdAt), asc(memories.id));
}
