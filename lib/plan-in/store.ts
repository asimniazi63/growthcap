import { and, desc, eq, inArray } from "drizzle-orm";
import { extractText, getDocumentProxy } from "unpdf";
import type { Db } from "../db/client";
import { DOCUMENT_KINDS, documents, planTargets, plans, tenants, type DocumentKind, type DocumentStatus } from "../db/schema";
import { assertBudget } from "../agent/budget";
import { AppError } from "../errors";
import { isUuid } from "../ids";
import { NotAllowedError } from "../memory/store";
import { loadPlan } from "../pace/gap";
import type { PlanMetric } from "../pace/metrics";
import type { TenantContext } from "../tenancy/context";
import { MAX_PAGES, MAX_TEXT_CHARS, proposalSchema, readPages, readPlanSheet, type Proposal, type ReaderDeps } from "./read";

// SOWs and plan sheets a Growth Capital admin or partner uploads to set a brand's targets. Only the text is kept (per page),
// then what was read from it; a person confirms the targets before they become the brand's active plan. Everything is scoped
// to the brand, and a decision (confirm or discard) is final.

export const MAX_BYTES = 4 * 1024 * 1024;
const MAX_LABEL_CHARS = 120;
const CHUNK = 500;
const MAX_CSV_ROWS = 2000;

export const canManagePlan = (ctx: TenantContext) => ctx.role === "gc_admin" || ctx.role === "gc_partner";
export function assertCanManagePlan(ctx: TenantContext): void {
  if (!canManagePlan(ctx)) throw new NotAllowedError();
}

const startsWithPdfMagic = (bytes: Uint8Array) => bytes.length >= 5 && String.fromCharCode(...bytes.subarray(0, 5)) === "%PDF-";

// The file's name only (never a path), on one line, at most 120 characters.
function cleanLabel(label: string): string {
  const base = (label.split(/[\\/]/).pop() ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (!base) throw new AppError("INVALID_INPUT", "The file needs a name.");
  return base.slice(0, MAX_LABEL_CHARS);
}

// The text of each page. Throws INVALID_INPUT for a PDF that can't be read or has no text (a scan).
export async function pdfPages(bytes: Uint8Array): Promise<string[]> {
  let pages: string[];
  try {
    const pdf = await getDocumentProxy(new Uint8Array(bytes)); // a copy: the reader takes ownership of the buffer it is given
    // The page count is known before any text is extracted, so a PDF with tens of thousands of pages is refused cheaply.
    if (pdf.numPages > MAX_PAGES) throw new AppError("INVALID_INPUT", `A PDF can have at most ${MAX_PAGES} pages.`);
    pages = (await extractText(pdf, { mergePages: false })).text;
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError("INVALID_INPUT", "That PDF could not be read. Is it damaged or password protected?");
  }
  pages = pages.map((p) => p.replace(/\u0000/g, "").trim());
  if (pages.length > MAX_PAGES) throw new AppError("INVALID_INPUT", `A PDF can have at most ${MAX_PAGES} pages.`);
  const chars = pages.reduce((n, p) => n + p.length, 0);
  if (chars === 0) throw new AppError("INVALID_INPUT", "That PDF has no text to read (is it a scan?).");
  if (chars > MAX_TEXT_CHARS) throw new AppError("INVALID_INPUT", "That PDF has too much text to read.");
  return pages;
}

function csvText(bytes: Uint8Array): string {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new AppError("INVALID_INPUT", "A plan sheet must be a UTF-8 text CSV file.");
  }
  if (text.includes("\u0000") || text.trim() === "") throw new AppError("INVALID_INPUT", "A plan sheet must be a text CSV file with rows.");
  if (text.split("\n").length > MAX_CSV_ROWS) throw new AppError("INVALID_INPUT", `A plan sheet can have at most ${MAX_CSV_ROWS} rows.`);
  return text;
}

export interface DocumentSummary {
  id: string;
  kind: DocumentKind;
  label: string;
  byteSize: number;
  status: DocumentStatus;
  pageCount: number;
  targetCount: number | null; // null until it has been read
  unappliedCount: number;
  planId: string | null;
  createdAt: string;
  decidedAt: string | null;
}

export interface Change {
  month: string;
  metric: PlanMetric;
  current: number | null; // null: the active plan has no target here
  proposed: number;
  sentence: string;
  page: number;
}

export interface DocumentDetail extends DocumentSummary {
  proposal: Proposal | null;
  changes: Change[];
  currentPlan: { id: string; label: string } | null;
}

type Row = typeof documents.$inferSelect;

function parseProposal(raw: unknown): Proposal | null {
  const parsed = proposalSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

function summarize(row: Pick<Row, "id" | "kind" | "label" | "byteSize" | "status" | "pages" | "proposal" | "planId" | "createdAt" | "decidedAt">): DocumentSummary {
  const proposal = parseProposal(row.proposal);
  return {
    id: row.id,
    kind: row.kind,
    label: row.label,
    byteSize: row.byteSize,
    status: row.status,
    pageCount: row.pages.length,
    targetCount: proposal ? proposal.targets.length : null,
    unappliedCount: proposal ? proposal.unapplied.length : 0,
    planId: row.planId,
    createdAt: row.createdAt.toISOString(),
    decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
  };
}

// The text is checked for what it really is (the PDF header, valid UTF-8), not by the file name alone.
export async function uploadDocument(db: Db, ctx: TenantContext, input: { kind: string; label: string; bytes: Uint8Array }): Promise<DocumentSummary> {
  assertCanManagePlan(ctx);
  const kind = DOCUMENT_KINDS.find((k) => k === input.kind);
  if (!kind) throw new AppError("INVALID_INPUT", "kind must be sow or plan_sheet.");
  const { bytes } = input;
  if (bytes.length === 0) throw new AppError("INVALID_INPUT", "That file is empty.");
  if (bytes.length > MAX_BYTES) throw new AppError("INVALID_INPUT", `A file can be at most ${MAX_BYTES / 1024 / 1024} MB.`);
  const label = cleanLabel(input.label);

  let pages: string[];
  if (kind === "sow") {
    if (!/\.pdf$/i.test(label) || !startsWithPdfMagic(bytes)) throw new AppError("INVALID_INPUT", "A SOW must be a PDF file.");
    pages = await pdfPages(bytes);
  } else {
    if (!/\.csv$/i.test(label) || startsWithPdfMagic(bytes)) throw new AppError("INVALID_INPUT", "A plan sheet must be a CSV file.");
    pages = [csvText(bytes)];
  }

  const [row] = await db.insert(documents).values({ tenantId: ctx.tenantId, kind, label, byteSize: bytes.length, pages, uploadedBy: ctx.userId }).returning();
  return summarize(row!);
}

async function ownDocument(db: Db, ctx: TenantContext, id: string): Promise<Row | null> {
  if (!isUuid(id)) return null;
  const [row] = await db.select().from(documents).where(and(eq(documents.id, id), eq(documents.tenantId, ctx.tenantId))).limit(1);
  return row ?? null;
}

// Runs the reader and keeps the proposal. A SOW needs the model; a plan sheet doesn't. Null when there is no such document.
export async function readDocument(db: Db, ctx: TenantContext, id: string, deps?: ReaderDeps): Promise<DocumentDetail | null> {
  assertCanManagePlan(ctx);
  const doc = await ownDocument(db, ctx, id);
  if (!doc) return null;
  // Only a document that has not been read can be read: a re-read would replace the proposal a person is reviewing, and each
  // read is a paid model call. (A read that failed leaves the status at "uploaded", so it can be tried again.)
  if (doc.status !== "uploaded") throw new AppError("INVALID_INPUT", doc.status === "read" ? "That document has already been read. Upload it again to read it again." : "That document has already been decided.");
  if (doc.kind !== "plan_sheet") await assertBudget(ctx.tenantId, { db, env: process.env });
  let proposal: Proposal;
  if (doc.kind === "plan_sheet") proposal = readPlanSheet(doc.pages.join("\n"));
  else if (!deps) throw new AppError("INTERNAL_ERROR", "No model is set up to read this document.");
  else proposal = await readPages(doc.pages, deps);

  const done = await db
    .update(documents)
    .set({ proposal, status: "read" })
    .where(and(eq(documents.id, doc.id), eq(documents.tenantId, ctx.tenantId), eq(documents.status, "uploaded")))
    .returning({ id: documents.id });
  if (done.length === 0) throw new AppError("INVALID_INPUT", "That document has already been read or decided.");
  return getDocument(db, ctx, id);
}

export async function listDocuments(db: Db, ctx: TenantContext): Promise<DocumentSummary[]> {
  assertCanManagePlan(ctx);
  const rows = await db.select().from(documents).where(eq(documents.tenantId, ctx.tenantId)).orderBy(desc(documents.createdAt), desc(documents.id)).limit(50);
  return rows.map(summarize);
}

// The proposal as changes against the brand's active plan. Once a document is decided there is nothing left to compare with.
export async function getDocument(db: Db, ctx: TenantContext, id: string): Promise<DocumentDetail | null> {
  assertCanManagePlan(ctx);
  const doc = await ownDocument(db, ctx, id);
  if (!doc) return null;
  const proposal = parseProposal(doc.proposal);
  const open = doc.status === "read";
  const active = open ? await loadPlan(db, ctx.tenantId) : null;
  const changes: Change[] = (proposal?.targets ?? []).map((t) => ({
    month: t.month,
    metric: t.metric,
    current: active?.targets.get(t.month)?.[t.metric] ?? null,
    proposed: t.value,
    sentence: t.sentence,
    page: t.page,
  }));
  return { ...summarize(doc), proposal, changes, currentPlan: active ? { id: active.id, label: active.label } : null };
}

// Makes the proposal the brand's active plan: the current plan's targets with the proposed ones laid over them. The old plan
// stays, inactive. Null when there is no such document or it was already decided (so a second confirm does nothing).
export async function confirmDocument(db: Db, ctx: TenantContext, id: string): Promise<{ planId: string } | null> {
  assertCanManagePlan(ctx);
  if (!isUuid(id)) return null;
  return db.transaction(async (tx) => {
    // One plan swap at a time for the brand: the one-active-plan index would turn a race into an error.
    await tx.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, ctx.tenantId)).for("update");
    const [doc] = await tx
      .update(documents)
      .set({ status: "confirmed", decidedBy: ctx.userId, decidedAt: new Date() })
      .where(and(eq(documents.id, id), eq(documents.tenantId, ctx.tenantId), eq(documents.status, "read")))
      .returning({ label: documents.label, proposal: documents.proposal });
    if (!doc) return null;
    const proposal = parseProposal(doc.proposal);
    if (!proposal || proposal.targets.length === 0) throw new AppError("INVALID_INPUT", "There are no targets to apply from this document.");

    const merged = new Map<string, { month: string; metric: string; value: number }>();
    const [old] = await tx.select({ id: plans.id }).from(plans).where(and(eq(plans.tenantId, ctx.tenantId), eq(plans.active, true))).limit(1);
    if (old) {
      const rows = await tx.select({ month: planTargets.month, metric: planTargets.metric, value: planTargets.value }).from(planTargets).where(and(eq(planTargets.tenantId, ctx.tenantId), eq(planTargets.planId, old.id)));
      for (const r of rows) merged.set(`${r.month}|${r.metric}`, r);
    }
    for (const t of proposal.targets) merged.set(`${t.month}|${t.metric}`, { month: t.month, metric: t.metric, value: t.value });

    await tx.update(plans).set({ active: false }).where(and(eq(plans.tenantId, ctx.tenantId), eq(plans.active, true)));
    const [plan] = await tx.insert(plans).values({ tenantId: ctx.tenantId, label: doc.label, source: "upload", active: true }).returning({ id: plans.id });
    const rows = [...merged.values()].map((t) => ({ tenantId: ctx.tenantId, planId: plan!.id, month: t.month, metric: t.metric, value: t.value }));
    for (let i = 0; i < rows.length; i += CHUNK) await tx.insert(planTargets).values(rows.slice(i, i + CHUNK));
    await tx.update(documents).set({ planId: plan!.id }).where(and(eq(documents.id, id), eq(documents.tenantId, ctx.tenantId)));
    return { planId: plan!.id };
  });
}

// True when a waiting document was discarded; false when there is no such document or it was already decided.
export async function discardDocument(db: Db, ctx: TenantContext, id: string): Promise<boolean> {
  assertCanManagePlan(ctx);
  if (!isUuid(id)) return false;
  const done = await db
    .update(documents)
    .set({ status: "discarded", decidedBy: ctx.userId, decidedAt: new Date() })
    .where(and(eq(documents.id, id), eq(documents.tenantId, ctx.tenantId), inArray(documents.status, ["uploaded", "read"])))
    .returning({ id: documents.id });
  return done.length > 0;
}
