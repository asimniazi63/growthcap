import { z } from "zod";
import { json, readJson, withTenant } from "@/lib/api/respond";
import { approveBrief } from "@/lib/briefs/store";
import { getDb } from "@/lib/db/client";
import { AppError } from "@/lib/errors";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };
const decision = z.strictObject({ decision: z.literal("approve") });

// A Growth Capital admin or partner approves a drafted brief. Anyone else gets 403, and a blocked brief is refused.
export const POST = (request: Request, { params }: Params) =>
  withTenant(async (ctx) => {
    const parsed = decision.safeParse(await readJson(request, 1_000));
    if (!parsed.success) throw new AppError("INVALID_INPUT", "decision must be approve.");
    const status = await approveBrief(getDb(), ctx, (await params).id);
    return status ? json({ status }) : json({ error: "NOT_FOUND" }, 404);
  });
