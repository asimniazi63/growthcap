import { createUIMessageStreamResponse, type UIMessage } from "ai";
import { z } from "zod";
import { runAgent } from "@/lib/agent/run";
import { getTenantContext } from "@/lib/tenancy/context";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_BODY_BYTES = 500_000;

// Only the shape is checked here; runAgent keeps the text of user and assistant messages and drops the rest.
const body = z.object({
  messages: z
    .array(z.object({ id: z.string().max(100), role: z.enum(["user", "assistant", "system"]), parts: z.array(z.looseObject({ type: z.string() })).max(60) }))
    .min(1)
    .max(100),
  modelId: z.string().max(60).optional(),
});

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

  const { stream } = runAgent(ctx, { messages: parsed.data.messages as unknown as UIMessage[], modelId: parsed.data.modelId });
  return createUIMessageStreamResponse({ stream });
}
