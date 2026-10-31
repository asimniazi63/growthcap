import { createUIMessageStreamResponse, type UIMessage } from "ai";
import { after } from "next/server";
import { z } from "zod";
import { runAgent } from "@/lib/agent/run";
import { detach } from "@/lib/api/stream";
import { getDb } from "@/lib/db/client";
import { flushTraces } from "@/lib/ops/tracing";
import { appendTurn, createThread, openOrStart } from "@/lib/threads/store";
import { getTenantContext } from "@/lib/tenancy/context";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_BODY_BYTES = 500_000;
const MAX_SAVED_MESSAGES = 60; // the display copy keeps the most recent messages

// Only the shape is checked here. For a saved thread the model's history comes from the database and only the newest
// question is taken from the body; runAgent keeps just the text of that one message.
const body = z.object({
  messages: z
    .array(z.object({ id: z.string().max(100), role: z.enum(["user", "assistant", "system"]), parts: z.array(z.looseObject({ type: z.string() })).max(60) }))
    .min(1)
    .max(100),
  modelId: z.string().max(60).optional(),
  threadId: z.uuid().optional(),
});

const textOf = (m: { parts: { type: string; text?: unknown }[] } | undefined) => (m?.parts ?? []).map((p) => (p.type === "text" && typeof p.text === "string" ? p.text : "")).join("");

// The tenant comes from the Clerk session and nowhere else: nothing in the request body can name a brand or a store.
export async function POST(request: Request) {
  let ctx;
  try {
    ctx = await getTenantContext();
  } catch {
    return new Response("FORBIDDEN", { status: 403 });
  }

  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return new Response("INVALID_INPUT", { status: 413 });
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return new Response("INVALID_INPUT", { status: 400 });

  const db = getDb();
  const messages = parsed.data.messages as unknown as UIMessage[];
  // An id that isn't this person's saved thread starts a new one (see openOrStart), so a failed first question can't strand the chat.
  const open = await openOrStart(db, { tenantId: ctx.tenantId, userId: ctx.userId, threadId: parsed.data.threadId, firstQuestion: textOf(messages.at(-1)) });
  const thread = { id: open.id, title: open.title, history: open.history, ui: open.ui as UIMessage[] };

  const { stream } = runAgent(
    ctx,
    { messages, modelId: parsed.data.modelId, thread },
    {
      db,
      // A new thread is written only once its first answer succeeded, so a failed first question leaves nothing behind.
      onTurn: async (turn) => {
        if (open.isNew) await createThread(db, { id: thread.id, tenantId: ctx.tenantId, userId: ctx.userId, title: turn.title });
        await appendTurn(db, { tenantId: ctx.tenantId, userId: ctx.userId, threadId: thread.id, ui: turn.ui.slice(-MAX_SAVED_MESSAGES), delta: turn.delta });
      },
    },
  );
  // The server reads its own copy to the end, so a closed tab doesn't lose a turn that was already paid for.
  const { client, finished } = detach(stream);
  after(finished);
  after(finished.then(() => flushTraces(), () => flushTraces())); // sends the Langfuse spans once the turn is over; does nothing when tracing is off
  return createUIMessageStreamResponse({ stream: client });
}
