import { z } from "zod";
import { approveAction, getAction, rejectAction } from "@/lib/actions/ledger";
import { json, readJson, withTenant } from "@/lib/api/respond";
import { getDb } from "@/lib/db/client";
import { AppError } from "@/lib/errors";

export const runtime = "nodejs";
export const maxDuration = 60; // an approval waits for Shopify

type Params = { params: Promise<{ id: string }> };
const decision = z.strictObject({ decision: z.enum(["approve", "reject"]) });

export const GET = (_request: Request, { params }: Params) => withTenant(async (ctx) => json({ action: await getAction(getDb(), ctx, (await params).id) }));

// A Growth Capital admin or partner approves or rejects a proposed change. Anyone else gets 403; another brand's id gets 404.
export const POST = (request: Request, { params }: Params) =>
  withTenant(async (ctx) => {
    const parsed = decision.safeParse(await readJson(request, 1_000));
    if (!parsed.success) throw new AppError("INVALID_INPUT", "decision must be approve or reject.");
    const { id } = await params;
    const action = parsed.data.decision === "approve" ? await approveAction(getDb(), ctx, id) : await rejectAction(getDb(), ctx, id);
    return json({ action });
  });
