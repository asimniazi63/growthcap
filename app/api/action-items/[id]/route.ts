import { z } from "zod";
import { json, readJson, withTenant } from "@/lib/api/respond";
import { markDone } from "@/lib/action-items/store";
import { getDb } from "@/lib/db/client";
import { AppError } from "@/lib/errors";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };
const patch = z.strictObject({ status: z.literal("done") });

// A Growth Capital admin or partner marks one of the brand's open action items done. Another brand's item, a missing item and one
// that is already done all answer 404.
export const PATCH = (request: Request, { params }: Params) =>
  withTenant(async (ctx) => {
    if (!patch.safeParse(await readJson(request, 1_000)).success) throw new AppError("INVALID_INPUT", 'Send { "status": "done" }.');
    return (await markDone(getDb(), ctx, (await params).id)) ? json({ status: "done" }) : json({ error: "NOT_FOUND" }, 404);
  });
