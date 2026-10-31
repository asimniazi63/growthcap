import { z } from "zod";
import { json, readJson, withTenant } from "@/lib/api/respond";
import { getDb } from "@/lib/db/client";
import { AppError } from "@/lib/errors";
import { decideMemory, removeMemory } from "@/lib/memory/store";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };
const decision = z.strictObject({ action: z.enum(["confirm", "dismiss"]) });

// A Growth Capital admin or partner confirms or dismisses a note the agent proposed. Anyone else gets 403.
export const POST = (request: Request, { params }: Params) =>
  withTenant(async (ctx) => {
    const parsed = decision.safeParse(await readJson(request, 1_000));
    if (!parsed.success) throw new AppError("INVALID_INPUT", "action must be confirm or dismiss.");
    const status = await decideMemory(getDb(), ctx, (await params).id, parsed.data.action);
    return status ? json({ status }) : json({ error: "NOT_FOUND" }, 404);
  });

export const DELETE = (_request: Request, { params }: Params) =>
  withTenant(async (ctx) => ((await removeMemory(getDb(), ctx, (await params).id)) ? new Response(null, { status: 204 }) : json({ error: "NOT_FOUND" }, 404)));
