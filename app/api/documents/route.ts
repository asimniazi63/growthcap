import { json, withTenant } from "@/lib/api/respond";
import { getDb } from "@/lib/db/client";
import { AppError } from "@/lib/errors";
import { readLimitedForm } from "@/lib/plan-in/body";
import { readerDeps } from "@/lib/plan-in/model";
import { MAX_BYTES, assertCanManagePlan, listDocuments, readDocument, uploadDocument } from "@/lib/plan-in/store";

export const runtime = "nodejs";
export const maxDuration = 120; // a SOW or an invoice is read in two model calls

// A Growth Capital admin or partner uploads a SOW or a supplier invoice (PDF) or a plan sheet (CSV). The file is checked, its text kept (not the
// file), and the targets read from it for review. If reading fails the document stays uploaded and can be read again.
export const POST = (request: Request) =>
  withTenant(async (ctx) => {
    assertCanManagePlan(ctx); // before the body is read
    const form = await readLimitedForm(request, MAX_BYTES);
    const file = form.get("file");
    const kind = form.get("kind");
    if (!(file instanceof File) || typeof kind !== "string") throw new AppError("INVALID_INPUT", "Send a file and its kind (sow, invoice or plan_sheet).");
    const db = getDb();
    const doc = await uploadDocument(db, ctx, { kind, label: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
    try {
      return json({ document: await readDocument(db, ctx, doc.id, kind === "sow" || kind === "invoice" ? readerDeps() : undefined) }, 201);
    } catch (e) {
      // The upload is kept so the person can read it again from the list; say which document it is.
      const message = e instanceof AppError ? e.message : "Reading the document failed. Try again.";
      return json({ error: e instanceof AppError ? e.code : "INTERNAL_ERROR", message, document: doc }, 502);
    }
  });

export const GET = () => withTenant(async (ctx) => json({ documents: await listDocuments(getDb(), ctx) }));
