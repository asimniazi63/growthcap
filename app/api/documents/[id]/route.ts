import { z } from "zod";
import { json, readJson, withTenant } from "@/lib/api/respond";
import { getDb } from "@/lib/db/client";
import { AppError } from "@/lib/errors";
import { readerDeps } from "@/lib/plan-in/model";
import { confirmDocument, confirmInvoice, discardDocument, getDocument, readDocument } from "@/lib/plan-in/store";

export const runtime = "nodejs";
export const maxDuration = 120;

type Params = { params: Promise<{ id: string }> };
const decision = z.strictObject({ action: z.enum(["confirm", "discard", "read"]) });

// The document with its targets shown as changes against the brand's active plan.
export const GET = (_request: Request, { params }: Params) =>
  withTenant(async (ctx) => {
    const doc = await getDocument(getDb(), ctx, (await params).id);
    return doc ? json({ document: doc }) : json({ error: "NOT_FOUND" }, 404);
  });

// A Growth Capital admin or partner confirms (a SOW's or plan sheet's targets become the brand's active plan; an invoice becomes
// a proposed cost update that waits for approval in the ledger, and nothing is written to Shopify), discards, or reads again.
// A document that was already decided answers 404 and nothing changes.
export const POST = (request: Request, { params }: Params) =>
  withTenant(async (ctx) => {
    const parsed = decision.safeParse(await readJson(request, 1_000));
    if (!parsed.success) throw new AppError("INVALID_INPUT", "action must be confirm, discard or read.");
    const db = getDb();
    const id = (await params).id;
    switch (parsed.data.action) {
      case "confirm": {
        const existing = await getDocument(db, ctx, id);
        if (existing?.kind === "invoice") {
          const proposed = await confirmInvoice(db, ctx, id);
          return proposed ? json({ status: "confirmed", actionId: proposed.actionId, lines: proposed.lines }) : json({ error: "NOT_FOUND" }, 404);
        }
        const done = await confirmDocument(db, ctx, id);
        return done ? json({ status: "confirmed", planId: done.planId }) : json({ error: "NOT_FOUND" }, 404);
      }
      case "discard":
        return (await discardDocument(db, ctx, id)) ? json({ status: "discarded" }) : json({ error: "NOT_FOUND" }, 404);
      case "read": {
        const existing = await getDocument(db, ctx, id);
        const doc = existing ? await readDocument(db, ctx, id, existing.kind === "sow" || existing.kind === "invoice" ? readerDeps() : undefined) : null;
        return doc ? json({ document: doc }) : json({ error: "NOT_FOUND" }, 404);
      }
    }
  });
