import { json, withTenant } from "@/lib/api/respond";
import { getDb } from "@/lib/db/client";
import { deleteThread, loadThread } from "@/lib/threads/store";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

// The saved conversation as it was shown: the display copy the server built. The model's own history is never sent out.
export const GET = (_request: Request, { params }: Params) =>
  withTenant(async (ctx) => {
    const thread = await loadThread(getDb(), ctx.tenantId, ctx.userId, (await params).id, { history: false });
    return thread ? json({ id: thread.id, title: thread.title, messages: thread.ui }) : json({ error: "NOT_FOUND" }, 404);
  });

export const DELETE = (_request: Request, { params }: Params) =>
  withTenant(async (ctx) => ((await deleteThread(getDb(), ctx.tenantId, ctx.userId, (await params).id)) ? new Response(null, { status: 204 }) : json({ error: "NOT_FOUND" }, 404)));
