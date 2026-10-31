import { z } from "zod";
import { json, readJson, withTenant } from "@/lib/api/respond";
import { confirmCallNote, discardCallNote, getCallNoteReview, selectionSchema } from "@/lib/call-notes/store";
import { getDb } from "@/lib/db/client";
import { AppError } from "@/lib/errors";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

// Confirm names the parts of the stored proposal to apply by position; it never carries a value, a tenant or a user.
const decision = z.discriminatedUnion("action", [z.strictObject({ action: z.literal("discard") }), selectionSchema.extend({ action: z.literal("confirm") })]);

// The call note with its proposal shown against the brand's active plan.
export const GET = (_request: Request, { params }: Params) =>
  withTenant(async (ctx) => {
    const review = await getCallNoteReview(getDb(), ctx, (await params).id);
    return review ? json({ review }) : json({ error: "NOT_FOUND" }, 404);
  });

// A Growth Capital admin or partner confirms the chosen parts, or discards the note. A note that was already decided answers 404
// and nothing changes.
export const POST = (request: Request, { params }: Params) =>
  withTenant(async (ctx) => {
    const parsed = decision.safeParse(await readJson(request, 10_000));
    if (!parsed.success) throw new AppError("INVALID_INPUT", "Send an action (confirm or discard) and, to confirm, the positions to apply.");
    const db = getDb();
    const id = (await params).id;
    if (parsed.data.action === "discard") return (await discardCallNote(db, ctx, id)) ? json({ status: "discarded" }) : json({ error: "NOT_FOUND" }, 404);
    const done = await confirmCallNote(db, ctx, id, { planChanges: parsed.data.planChanges, actionItems: parsed.data.actionItems });
    return done ? json({ status: "confirmed", ...done }) : json({ error: "NOT_FOUND" }, 404);
  });
