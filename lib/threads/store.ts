import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import type { ModelMessage } from "ai";
import type { Db } from "../db/client";
import { isUuid } from "../ids";
import { threadMessages, threads } from "../db/schema";

// Saved conversations. The model's history is kept exactly as the provider returned it and replayed as stored, never
// rebuilt from what the browser shows: a rebuilt history drops reasoning blocks and their signatures, and changes the
// prompt prefix that caching relies on. Every call is scoped to a brand and a person.

export const REPLAY_TURNS = 10; // how many recent turns the model sees; the cut is between turns only
const TITLE_CHARS = 60;

export const threadTitle = (text: string): string => {
  const one = text.replace(/\s+/g, " ").trim() || "New chat";
  return one.length > TITLE_CHARS ? `${one.slice(0, TITLE_CHARS - 1)}…` : one;
};

export interface StoredThread {
  id: string;
  title: string;
  ui: unknown[]; // the display copy the server built
  history: ModelMessage[]; // the last REPLAY_TURNS turns, in order
}

export async function createThread(db: Db, input: { id?: string; tenantId: string; userId: string; title: string }): Promise<string> {
  const [row] = await db
    .insert(threads)
    .values({ ...(input.id ? { id: input.id } : {}), tenantId: input.tenantId, userId: input.userId, title: threadTitle(input.title) })
    .returning({ id: threads.id });
  return row!.id;
}

const mine = (tenantId: string, userId: string, id: string) => and(eq(threads.id, id), eq(threads.tenantId, tenantId), eq(threads.userId, userId));

// `history: false` skips the model's messages, for the places that only show the conversation.
export async function loadThread(db: Db, tenantId: string, userId: string, id: string, options: { history?: boolean } = {}): Promise<StoredThread | null> {
  if (!isUuid(id)) return null;
  const [thread] = await db.select().from(threads).where(mine(tenantId, userId, id)).limit(1);
  if (!thread) return null;
  if (options.history === false) return { id: thread.id, title: thread.title, ui: thread.ui, history: [] };
  const [latest] = await db.select({ turn: sql<number>`coalesce(max(${threadMessages.turn}), -1)::int` }).from(threadMessages).where(eq(threadMessages.threadId, id));
  const rows = await db
    .select({ message: threadMessages.message })
    .from(threadMessages)
    .where(and(eq(threadMessages.threadId, id), sql`${threadMessages.turn} > ${(latest?.turn ?? -1) - REPLAY_TURNS}`))
    .orderBy(threadMessages.seq);
  return { id: thread.id, title: thread.title, ui: thread.ui, history: rows.map((r) => r.message as ModelMessage) };
}

// Adds one finished turn: the messages the model exchanged (as the provider returned them) and the new display copy.
export async function appendTurn(db: Db, input: { tenantId: string; userId: string; threadId: string; ui: unknown[]; delta: ModelMessage[] }): Promise<void> {
  if (!isUuid(input.threadId)) throw new Error("No such thread");
  await db.transaction(async (tx) => {
    // The row lock makes two turns on one thread (two tabs, a retry racing a slow answer) take their turn numbers one at a time.
    const [thread] = await tx.select({ id: threads.id }).from(threads).where(mine(input.tenantId, input.userId, input.threadId)).limit(1).for("update");
    if (!thread) throw new Error("No such thread");
    const [last] = await tx
      .select({ seq: sql<number>`coalesce(max(${threadMessages.seq}), -1)::int`, turn: sql<number>`coalesce(max(${threadMessages.turn}), -1)::int` })
      .from(threadMessages)
      .where(eq(threadMessages.threadId, input.threadId));
    if (input.delta.length > 0) {
      await tx.insert(threadMessages).values(input.delta.map((message, i) => ({ threadId: input.threadId, tenantId: input.tenantId, seq: (last?.seq ?? -1) + 1 + i, turn: (last?.turn ?? -1) + 1, message })));
    }
    await tx.update(threads).set({ ui: input.ui, updatedAt: new Date() }).where(eq(threads.id, input.threadId));
  });
}

export async function listThreads(db: Db, tenantId: string, userId: string, limit = 30): Promise<{ id: string; title: string; updatedAt: Date }[]> {
  return db
    .select({ id: threads.id, title: threads.title, updatedAt: threads.updatedAt })
    .from(threads)
    .where(and(eq(threads.tenantId, tenantId), eq(threads.userId, userId)))
    .orderBy(desc(threads.updatedAt))
    .limit(limit);
}

export async function deleteThread(db: Db, tenantId: string, userId: string, id: string): Promise<boolean> {
  if (!isUuid(id)) return false;
  return db.transaction(async (tx) => {
    const [thread] = await tx.select({ id: threads.id }).from(threads).where(mine(tenantId, userId, id)).limit(1);
    if (!thread) return false;
    await tx.delete(threadMessages).where(eq(threadMessages.threadId, id));
    await tx.delete(threads).where(eq(threads.id, id));
    return true;
  });
}

// The thread a request continues. An id that isn't this person's saved thread (one that was never saved because its first
// answer failed, one that was deleted, or someone else's) starts a new thread with a fresh id, which the stream tells the
// browser, so a failed first question never leaves the conversation stuck.
export async function openOrStart(
  db: Db,
  input: { tenantId: string; userId: string; threadId?: string; firstQuestion: string },
): Promise<{ id: string; title: string; history: ModelMessage[]; ui: unknown[]; isNew: boolean }> {
  if (input.threadId) {
    const stored = await loadThread(db, input.tenantId, input.userId, input.threadId);
    if (stored) return { ...stored, isNew: false };
  }
  return { id: randomUUID(), title: threadTitle(input.firstQuestion), history: [], ui: [], isNew: true };
}
