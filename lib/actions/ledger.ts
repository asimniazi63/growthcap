import { createHash } from "node:crypto";
import { and, desc, eq, inArray, lt } from "drizzle-orm";
import { localDate } from "../clock";
import type { Db } from "../db/client";
import { ACTION_KINDS, ACTION_STATUSES, actions, type ActionStatus } from "../db/schema";
import { AppError } from "../errors";
import { isUuid } from "../ids";
import { NotAllowedError } from "../memory/store";
import type { TenantContext } from "../tenancy/context";
import { loadWindow, todayFor } from "../tools/common";
import { getExecutor } from "./registry";
import { isReviewer } from "./reviewer";
import { checkedGraphql, shopGraphqlFor } from "./shopify";
import type { ActionDiff, ActionView, ExecEnv, ProposeInput } from "./types";

// The action ledger: every write the agent proposes, who approved it, and what happened. Nothing reaches Shopify without an
// approval record from a Growth Capital admin or partner, and the payload that runs is the one that was approved.

export { registerExecutor } from "./registry";
export { NotAllowedError };

export const MAX_TITLE = 120;
const MAX_TEXT = 500;
const MAX_ERROR = 500;

// An ActionView plus who decided it and when, for the ledger page. Assignable to ActionView.
export type LedgerView = ActionView & { decidedBy?: string | null; decidedAt?: string | null };

export interface ProposeDeps {
  today?: string; // the store-local date; tests pin it
}

export interface ApproveDeps {
  graphql?: ExecEnv["graphql"]; // tests inject a fake Shopify; otherwise it is bound to the tenant's connected store
  env?: Record<string, string | undefined>; // where REVIEWER_USER_IDS is read from (default process.env)
}

const canDecide = (ctx: TenantContext) => ctx.role === "gc_admin" || ctx.role === "gc_partner";
const requireGc = (ctx: TenantContext) => {
  if (!canDecide(ctx)) throw new NotAllowedError();
};
const notFound = () => new AppError("NO_DATA", "That action wasn't found.");

// JSON with sorted keys and no undefined values, so the same payload always hashes the same.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export const hashPayload = (payload: unknown): string => createHash("sha256").update(canonical(payload)).digest("hex");

type Row = typeof actions.$inferSelect;

function toView(r: Row): LedgerView {
  return {
    id: r.id,
    kind: r.kind,
    status: r.status,
    title: r.title,
    diff: r.diff as ActionDiff,
    hypothesis: r.hypothesis,
    metric: r.metric,
    checkOn: r.checkOn,
    owner: r.owner,
    dryRun: r.dryRun,
    ...(r.result != null ? { result: r.result } : {}),
    error: r.error,
    createdAt: r.createdAt.toISOString(),
    decidedBy: r.decidedBy,
    decidedAt: r.decidedAt?.toISOString() ?? null,
  };
}

async function loadRow(db: Db, ctx: TenantContext, id: string): Promise<Row> {
  if (!isUuid(id)) throw notFound();
  const [row] = await db.select().from(actions).where(and(eq(actions.id, id), eq(actions.tenantId, ctx.tenantId))).limit(1);
  if (!row) throw notFound();
  return row;
}

// One conditional update: it changes the row only if it is still in one of the `from` states, and says whether it did.
async function advance(db: Db, ctx: TenantContext, id: string, from: ActionStatus[], set: Partial<typeof actions.$inferInsert>): Promise<Row | null> {
  const [row] = await db
    .update(actions)
    .set({ ...set, updatedAt: new Date() })
    .where(and(eq(actions.id, id), eq(actions.tenantId, ctx.tenantId), inArray(actions.status, from)))
    .returning();
  return row ?? null;
}

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

function validDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function issues(error: { issues: { path: PropertyKey[]; message: string }[] }): string {
  return error.issues
    .slice(0, 3)
    .map((i) => `${i.path.length > 0 ? i.path.map(String).join(".") : "payload"}: ${i.message}`)
    .join("; ");
}

// Redacts anything that looks like a Shopify token. The error text is stored and shown, so it must never hold one.
function safeError(e: unknown): string {
  const text = e instanceof Error ? e.message : String(e);
  return text.replace(/shp[a-z]{1,3}_[A-Za-z0-9]+/g, "[redacted]").replace(/\s+/g, " ").trim().slice(0, MAX_ERROR) || "The change failed.";
}

// Stores a proposal and returns what the approval card shows. The diff is built here from the validated payload, never taken
// from the model. Growth Capital admin or partner only.
export async function proposeAction(db: Db, ctx: TenantContext, input: ProposeInput, deps: ProposeDeps = {}): Promise<LedgerView> {
  requireGc(ctx);
  if (!ACTION_KINDS.includes(input.kind)) throw new AppError("INVALID_INPUT", "That kind of change isn't supported.");
  const executor = await getExecutor(input.kind);

  const parsed = executor.schema.safeParse(input.payload);
  if (!parsed.success) throw new AppError("INVALID_INPUT", `That change isn't valid. ${issues(parsed.error)}`);

  const title = oneLine(input.title).slice(0, MAX_TITLE);
  const hypothesis = oneLine(input.hypothesis).slice(0, MAX_TEXT);
  const metric = oneLine(input.metric).slice(0, MAX_TITLE);
  if (!title || !hypothesis || !metric) throw new AppError("INVALID_INPUT", "An action needs a title, a hypothesis and a metric.");

  const today = deps.today ?? (ctx.shop ? todayFor(ctx.shop.timezone, await loadWindow(db, ctx.tenantId)) : localDate(Date.now(), "UTC"));
  if (!validDate(input.checkOn)) throw new AppError("INVALID_INPUT", "checkOn must be a date written YYYY-MM-DD.");
  if (input.checkOn < today) throw new AppError("INVALID_INPUT", `checkOn must be ${today} or later.`);

  const payload = parsed.data;
  const payloadHash = hashPayload(payload);
  const [same] = await db
    .select()
    .from(actions)
    .where(and(eq(actions.tenantId, ctx.tenantId), eq(actions.kind, input.kind), eq(actions.payloadHash, payloadHash), eq(actions.status, "proposed")))
    .limit(1);
  if (same) return toView(same); // the model asked twice; one card is enough

  const diff = await executor.diff(payload, ctx, db);
  const [row] = await db
    .insert(actions)
    .values({ tenantId: ctx.tenantId, kind: input.kind, title, payload, payloadHash, diff, hypothesis, metric, checkOn: input.checkOn, owner: ctx.userId })
    .returning();
  return toView(row!);
}

// A write that was killed mid-flight (the function timed out) would stay "running" for ever, and nothing else moves it.
// Anything approved or running for more than ten minutes is closed as failed, so the ledger tells the truth and the
// change can be asked for again. Whether Shopify applied it is then for a person to check.
const STUCK_AFTER_MS = 10 * 60_000;
async function closeStuck(db: Db, tenantId: string): Promise<void> {
  await db
    .update(actions)
    .set({ status: "failed", error: "This did not finish and was closed after 10 minutes. Check in Shopify whether it was applied before asking again.", updatedAt: new Date() })
    .where(and(eq(actions.tenantId, tenantId), inArray(actions.status, ["approved", "running"]), lt(actions.updatedAt, new Date(Date.now() - STUCK_AFTER_MS))));
}

// The ledger is the agency's working record (what it proposed, why, and who approved it), so only Growth Capital roles read it.
export async function listActions(db: Db, ctx: TenantContext, opts: { status?: string } = {}): Promise<LedgerView[]> {
  requireGc(ctx);
  await closeStuck(db, ctx.tenantId);
  let status: ActionStatus | undefined;
  if (opts.status !== undefined) {
    status = ACTION_STATUSES.find((s) => s === opts.status);
    if (!status) throw new AppError("INVALID_INPUT", `status must be one of ${ACTION_STATUSES.join(", ")}.`);
  }
  const rows = await db
    .select()
    .from(actions)
    .where(and(eq(actions.tenantId, ctx.tenantId), ...(status ? [eq(actions.status, status)] : [])))
    .orderBy(desc(actions.createdAt), desc(actions.id))
    .limit(200);
  return rows.map(toView);
}

export async function getAction(db: Db, ctx: TenantContext, id: string): Promise<LedgerView> {
  requireGc(ctx);
  await closeStuck(db, ctx.tenantId);
  return toView(await loadRow(db, ctx, id));
}

// Approves a proposal and carries it out. A second approval (a double click, a retry) finds the row already decided and
// returns it unchanged. A reviewer login is recorded as a dry run: the exact mutations are saved, Shopify is never called.
export async function approveAction(db: Db, ctx: TenantContext, id: string, deps: ApproveDeps = {}): Promise<LedgerView> {
  requireGc(ctx);
  const row = await loadRow(db, ctx, id);
  if (row.status !== "proposed") return toView(row);

  // The payload is checked again against its schema and the hash taken when it was proposed: what runs is what was shown.
  const executor = await getExecutor(row.kind);
  const parsed = executor.schema.safeParse(row.payload);
  if (!parsed.success || hashPayload(parsed.data) !== row.payloadHash) {
    throw new AppError("INVALID_INPUT", "This action's details changed after it was proposed, so it can't be approved. Ask for it again.");
  }
  const payload = parsed.data;

  const approved = await advance(db, ctx, id, ["proposed"], { status: "approved", decidedBy: ctx.userId, decidedAt: new Date() });
  if (!approved) return toView(await loadRow(db, ctx, id)); // someone else decided it first; do nothing

  try {
    if (isReviewer(ctx.userId, deps.env)) {
      const done = await advance(db, ctx, id, ["approved"], { status: "done", dryRun: true, result: { dryRun: true, mutations: executor.mutations(payload) } });
      return toView(done ?? (await loadRow(db, ctx, id)));
    }
    const started = await advance(db, ctx, id, ["approved"], { status: "running" });
    if (!started) return toView(await loadRow(db, ctx, id));
    const graphql = checkedGraphql(deps.graphql ?? (await shopGraphqlFor(db, ctx)));
    const result = await executor.run(payload, { db, ctx, graphql });
    // An executor can finish without writing (Shopify gated the theme write): that is a failure to record, not a success.
    const notWritten = (result as { written?: unknown } | null)?.written === false ? (result as { reason?: string; finishByHand?: string }) : null;
    if (notWritten) {
      const failed = await advance(db, ctx, id, ["running"], { status: "failed", result: toJson(result), error: `${notWritten.reason ?? "Nothing was written."} To finish it, run in the project folder: npm run landing:push -- ${id}`.slice(0, 600) });
      return toView(failed ?? (await loadRow(db, ctx, id)));
    }
    const done = await advance(db, ctx, id, ["running"], { status: "done", result: toJson(result) });
    return toView(done ?? (await loadRow(db, ctx, id)));
  } catch (e) {
    console.error(`[actions] ${row.kind} ${id} failed:`, safeError(e));
    const failed = await advance(db, ctx, id, ["approved", "running"], { status: "failed", error: safeError(e) });
    return toView(failed ?? (await loadRow(db, ctx, id)));
  }
}

export async function rejectAction(db: Db, ctx: TenantContext, id: string): Promise<LedgerView> {
  requireGc(ctx);
  const row = await loadRow(db, ctx, id);
  const rejected = await advance(db, ctx, row.id, ["proposed"], { status: "rejected", decidedBy: ctx.userId, decidedAt: new Date() });
  return toView(rejected ?? (await loadRow(db, ctx, id))); // already decided: nothing changes
}

// The result is stored as JSON. A value that can't be turned into JSON is replaced by a note, not allowed to fail a write
// that already happened.
function toJson(result: unknown): unknown {
  if (result === undefined) return null;
  try {
    return JSON.parse(JSON.stringify(result));
  } catch {
    return { note: "The result could not be saved." };
  }
}
