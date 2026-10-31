import { and, count, desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client";
import { actionItems, callNotes, documents, planTargets, plans, tenants } from "../db/schema";
import { assertBudget } from "../agent/budget";
import { AppError } from "../errors";
import { isUuid } from "../ids";
import { isValidDate } from "../metrics/dates";
import { loadPlan, type PlanTargets } from "../pace/gap";
import type { PlanMetric } from "../pace/metrics";
import type { ReaderDeps } from "../plan-in/read";
import type { TenantContext } from "../tenancy/context";
import { assertCanManageNotes } from "./access";
import { MAX_NOTE_CHARS, noteProposalSchema, readCallNote, type NoteProposal, type ProposedActionItem, type ProposedPlanChange } from "./read";

// Call notes a Growth Capital admin or partner pastes in. The text is kept, a reader proposes plan changes and action items
// from it, and nothing is applied until the person confirms. Everything is scoped to the brand from the session, and a
// decision (confirm or discard) is final.

export const MAX_TITLE_CHARS = 120;
export const MAX_WAITING = 10; // notes read and waiting for a decision, per brand: each read is a paid model call
const CHUNK = 500;

export const callNoteInput = z.strictObject({
  title: z.string().trim().min(1).max(MAX_TITLE_CHARS),
  heldOn: z.string().refine(isValidDate, "heldOn must be a real date written YYYY-MM-DD"),
  text: z.string().min(1).max(MAX_NOTE_CHARS * 2), // checked again after cleaning, below
});

const oneLine = (s: string) => s.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();

// The note as it is kept: no control characters or NULs, line breaks normalised, at most 8,000 characters.
export function cleanNoteText(raw: string): string {
  const text = raw
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .trim();
  if (text.length < 20) throw new AppError("INVALID_INPUT", "The call note is too short to read. Paste the whole note.");
  if (text.length > MAX_NOTE_CHARS) throw new AppError("INVALID_INPUT", `A call note can be at most ${MAX_NOTE_CHARS.toLocaleString("en-US")} characters.`);
  return text;
}

export interface PlanChangeView {
  index: number; // position in the stored proposal: the only thing a confirm names
  month: string;
  metric: PlanMetric;
  current: number | null; // null: the active plan has no target here
  proposed: number;
  quote: string;
}

export interface ActionItemView extends ProposedActionItem {
  index: number;
}

export interface CallNoteReview {
  id: string;
  title: string;
  heldOn: string;
  status: "uploaded" | "read" | "confirmed" | "discarded";
  createdAt: string;
  planChanges: PlanChangeView[];
  actionItems: ActionItemView[];
  unapplied: NoteProposal["unapplied"];
  unverified: NoteProposal["unverified"];
  currentPlan: { id: string; label: string } | null;
}

type Row = typeof documents.$inferSelect;

function parseProposal(raw: unknown): NoteProposal | null {
  const parsed = noteProposalSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

function reviewOf(row: Row, plan: { id: string; label: string; targets: PlanTargets } | null): CallNoteReview | null {
  const proposal = parseProposal(row.proposal);
  if (!proposal) return null;
  return {
    id: row.id,
    title: row.label,
    heldOn: proposal.heldOn,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    planChanges: proposal.planChanges.map((c, index) => ({ index, month: c.month, metric: c.metric, current: plan?.targets.get(c.month)?.[c.metric] ?? null, proposed: c.value, quote: c.quote })),
    actionItems: proposal.actionItems.map((a, index) => ({ index, ...a })),
    unapplied: proposal.unapplied,
    unverified: proposal.unverified,
    currentPlan: plan ? { id: plan.id, label: plan.label } : null,
  };
}

async function ownNote(db: Db, ctx: TenantContext, id: string): Promise<Row | null> {
  if (!isUuid(id)) return null;
  const [row] = await db
    .select()
    .from(documents)
    .where(and(eq(documents.id, id), eq(documents.tenantId, ctx.tenantId), eq(documents.kind, "call_note")))
    .limit(1);
  return row ?? null;
}

// Stores the note and reads it. If the read fails the note is discarded (nothing was proposed) and the error goes back, so the
// person can send it again.
export async function submitCallNote(db: Db, ctx: TenantContext, raw: unknown, deps: ReaderDeps): Promise<CallNoteReview> {
  assertCanManageNotes(ctx);
  const parsed = callNoteInput.safeParse(raw);
  if (!parsed.success) throw new AppError("INVALID_INPUT", parsed.error.issues.map((i) => i.message).join("; ").slice(0, 300));
  const title = oneLine(parsed.data.title);
  if (!title) throw new AppError("INVALID_INPUT", "The call note needs a title.");
  const text = cleanNoteText(parsed.data.text);

  const [waiting] = await db
    .select({ n: count() })
    .from(documents)
    .where(and(eq(documents.tenantId, ctx.tenantId), eq(documents.kind, "call_note"), eq(documents.status, "read")));
  if ((waiting?.n ?? 0) >= MAX_WAITING) throw new AppError("INVALID_INPUT", `${MAX_WAITING} call notes are already waiting for review. Confirm or discard one first.`);
  await assertBudget(ctx.tenantId, { db, env: process.env });

  const [doc] = await db
    .insert(documents)
    .values({ tenantId: ctx.tenantId, kind: "call_note", label: title, byteSize: Buffer.byteLength(text, "utf8"), pages: [text], uploadedBy: ctx.userId })
    .returning();
  let proposal: NoteProposal;
  try {
    proposal = await readCallNote(text, parsed.data.heldOn, deps);
  } catch (e) {
    await db
      .update(documents)
      .set({ status: "discarded", decidedBy: ctx.userId, decidedAt: new Date() })
      .where(and(eq(documents.id, doc!.id), eq(documents.tenantId, ctx.tenantId)));
    throw e;
  }
  await db
    .update(documents)
    .set({ proposal, status: "read" })
    .where(and(eq(documents.id, doc!.id), eq(documents.tenantId, ctx.tenantId), eq(documents.status, "uploaded")));
  const review = await getCallNoteReview(db, ctx, doc!.id);
  if (!review) throw new AppError("INTERNAL_ERROR", "The call note was read but could not be shown.");
  return review;
}

// One note with its proposal shown against the brand's active plan. Null when there is no such call note.
export async function getCallNoteReview(db: Db, ctx: TenantContext, id: string): Promise<CallNoteReview | null> {
  assertCanManageNotes(ctx);
  const row = await ownNote(db, ctx, id);
  if (!row) return null;
  return reviewOf(row, row.status === "read" ? await loadPlan(db, ctx.tenantId) : null);
}

// The notes waiting for a decision, newest first.
export async function listWaitingCallNotes(db: Db, ctx: TenantContext): Promise<CallNoteReview[]> {
  assertCanManageNotes(ctx);
  const rows = await db
    .select()
    .from(documents)
    .where(and(eq(documents.tenantId, ctx.tenantId), eq(documents.kind, "call_note"), eq(documents.status, "read")))
    .orderBy(desc(documents.createdAt), desc(documents.id))
    .limit(MAX_WAITING);
  if (rows.length === 0) return [];
  const plan = await loadPlan(db, ctx.tenantId);
  return rows.map((r) => reviewOf(r, plan)).filter((r): r is CallNoteReview => r !== null);
}

export const selectionSchema = z.strictObject({
  planChanges: z.array(z.number().int().min(0)).max(100),
  actionItems: z.array(z.number().int().min(0)).max(100),
});
export type Selection = z.infer<typeof selectionSchema>;

export interface ConfirmResult {
  planId: string | null; // the new active plan, or null when no target changed
  planChanges: number;
  actionItems: number;
}

// Applies the chosen parts of the proposal, all or nothing: the note is saved for the Why feature, the chosen plan changes become
// a new active plan (the current plan's targets with those laid over them; the old plan stays, inactive), and the chosen action
// items are stored as open. Null when there is no such note or it was already decided (so a second confirm does nothing).
export async function confirmCallNote(db: Db, ctx: TenantContext, id: string, selection: Selection): Promise<ConfirmResult | null> {
  assertCanManageNotes(ctx);
  if (!isUuid(id)) return null;
  return db.transaction(async (tx) => {
    // One plan swap at a time for the brand: the one-active-plan index would turn a race into an error.
    await tx.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, ctx.tenantId)).for("update");
    const [doc] = await tx
      .update(documents)
      .set({ status: "confirmed", decidedBy: ctx.userId, decidedAt: new Date() })
      .where(and(eq(documents.id, id), eq(documents.tenantId, ctx.tenantId), eq(documents.kind, "call_note"), eq(documents.status, "read")))
      .returning({ label: documents.label, pages: documents.pages, proposal: documents.proposal });
    if (!doc) return null;
    const proposal = parseProposal(doc.proposal);
    if (!proposal) throw new AppError("INVALID_INPUT", "That call note has nothing to confirm.");

    const pick = <T>(all: T[], indexes: number[], what: string): T[] => {
      const unique = [...new Set(indexes)];
      if (unique.some((i) => i >= all.length)) throw new AppError("INVALID_INPUT", `That ${what} is not in the proposal.`);
      return unique.sort((a, b) => a - b).map((i) => all[i]!);
    };
    const chosenChanges: ProposedPlanChange[] = pick(proposal.planChanges, selection.planChanges, "plan change");
    const chosenItems: ProposedActionItem[] = pick(proposal.actionItems, selection.actionItems, "action item");

    // The note itself, so the Why feature and get_notes can read it.
    await tx.insert(callNotes).values({ tenantId: ctx.tenantId, heldOn: proposal.heldOn, title: doc.label, body: doc.pages.join("\n\n") });

    let planId: string | null = null;
    let applied = 0;
    if (chosenChanges.length > 0) {
      const merged = new Map<string, { month: string; metric: string; value: number }>();
      const [old] = await tx.select({ id: plans.id }).from(plans).where(and(eq(plans.tenantId, ctx.tenantId), eq(plans.active, true))).limit(1);
      if (old) {
        const rows = await tx
          .select({ month: planTargets.month, metric: planTargets.metric, value: planTargets.value })
          .from(planTargets)
          .where(and(eq(planTargets.tenantId, ctx.tenantId), eq(planTargets.planId, old.id)));
        for (const r of rows) merged.set(`${r.month}|${r.metric}`, r);
      }
      // A target that already has this value is not a change.
      const changed = chosenChanges.filter((t) => merged.get(`${t.month}|${t.metric}`)?.value !== t.value);
      if (changed.length > 0) {
        for (const t of changed) merged.set(`${t.month}|${t.metric}`, { month: t.month, metric: t.metric, value: t.value });
        await tx.update(plans).set({ active: false }).where(and(eq(plans.tenantId, ctx.tenantId), eq(plans.active, true)));
        const label = `Call note ${proposal.heldOn}: ${doc.label}`.slice(0, 120);
        const [plan] = await tx.insert(plans).values({ tenantId: ctx.tenantId, label, source: "upload", active: true }).returning({ id: plans.id });
        const rows = [...merged.values()].map((t) => ({ tenantId: ctx.tenantId, planId: plan!.id, month: t.month, metric: t.metric, value: t.value }));
        for (let i = 0; i < rows.length; i += CHUNK) await tx.insert(planTargets).values(rows.slice(i, i + CHUNK));
        await tx.update(documents).set({ planId: plan!.id }).where(and(eq(documents.id, id), eq(documents.tenantId, ctx.tenantId)));
        planId = plan!.id;
        applied = changed.length;
      }
    }

    if (chosenItems.length > 0) {
      await tx.insert(actionItems).values(
        chosenItems.map((a) => ({ tenantId: ctx.tenantId, title: a.title, owner: a.owner, dueOn: a.dueOn, status: "open" as const, sourceDocumentId: id, quote: a.quote, createdBy: ctx.userId })),
      );
    }
    return { planId, planChanges: applied, actionItems: chosenItems.length };
  });
}

// True when a waiting note was discarded; false when there is no such note or it was already decided. Nothing is applied and
// the note is not kept for the Why feature.
export async function discardCallNote(db: Db, ctx: TenantContext, id: string): Promise<boolean> {
  assertCanManageNotes(ctx);
  if (!isUuid(id)) return false;
  const done = await db
    .update(documents)
    .set({ status: "discarded", decidedBy: ctx.userId, decidedAt: new Date() })
    .where(and(eq(documents.id, id), eq(documents.tenantId, ctx.tenantId), eq(documents.kind, "call_note"), eq(documents.status, "read")))
    .returning({ id: documents.id });
  return done.length > 0;
}
