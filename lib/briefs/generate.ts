import type { LanguageModel, UIMessage, UIMessageChunk } from "ai";
import { and, eq } from "drizzle-orm";
import { runAgent } from "../agent/run";
import type { Db } from "../db/client";
import { briefs, type BriefStatus } from "../db/schema";
import { AppError } from "../errors";
import { weekStart as mondayOnOrBefore } from "../metrics/dates";
import { formatRange } from "../pace/format";
import type { TenantContext } from "../tenancy/context";

// The Monday brief is drafted through the same agent loop as the chat, so the number checker runs on it. A brief whose
// figures the checker could not match even after its one repair turn is stored as "blocked" and can't be approved.

export interface BriefTenant {
  id: string;
  orgId: string;
  name: string;
  shop: NonNullable<TenantContext["shop"]>;
}

export interface BriefDeps {
  model?: LanguageModel; // tests inject a mock
  env?: Record<string, string | undefined>;
  now?: Date;
}

export interface BriefResult {
  outcome: "draft" | "blocked" | "exists";
  briefId: string | null;
}

const MAX_BODY_CHARS = 4000;

// The Monday on or before the date the job ran (UTC).
export const mondayOf = (now: Date): string => mondayOnOrBefore(now.toISOString().slice(0, 10));

// Fixed and written by the server: nothing in a request or in store data reaches this text.
export function briefQuestion(weekStart: string): string {
  return `Write this brand's Monday brief for the week starting ${formatRange(weekStart, weekStart)}. Use exactly two query_metric calls and no other tool. First: metrics net_sales, orders, aov and new_customer_orders with period this_month (the net_sales row carries gapToPlan: target, planned so far, actual, gap and projected). Second: the same four metrics with period last_7_days and compareTo previous_period. Then write three short parts in plain text, no tables, under 120 words in all: where the month stands against plan, with the month-end projection called an estimate; the biggest change against the week before; one thing to watch. Use only figures from those two results, and write money in dollars (money fields are in cents).`;
}

interface Verification {
  ok: boolean;
  unmatched: { text: string }[];
}

// The final answer is the text of the last step that wrote any, which is what the checker checked; the last verification is
// the checker's result after the repair turn, if there was one.
async function readAnswer(stream: ReadableStream<UIMessageChunk>): Promise<{ text: string; verification: Verification | null }> {
  const steps: string[] = [];
  let verification: Verification | null = null;
  const reader = stream.getReader();
  for (;;) {
    const { done, value: chunk } = await reader.read();
    if (done) break;
    if (chunk.type === "start-step") steps.push("");
    else if (chunk.type === "text-delta") {
      if (steps.length === 0) steps.push("");
      steps[steps.length - 1] += chunk.delta;
    } else if (chunk.type === "data-verification") verification = (chunk as unknown as { data: Verification }).data;
  }
  return { text: steps.filter((s) => s.trim()).at(-1)?.trim() ?? "", verification };
}

// Drafts one brand's brief for the week. The cron has no signed-in user: its authority is the CRON_SECRET check on the route,
// so the context is built here from the tenant row and its shop, never from anything in a request.
export async function generateBrief(db: Db, tenant: BriefTenant, weekStart: string, deps: BriefDeps = {}): Promise<BriefResult> {
  const [existing] = await db.select({ id: briefs.id }).from(briefs).where(and(eq(briefs.tenantId, tenant.id), eq(briefs.weekStart, weekStart)));
  if (existing) return { outcome: "exists", briefId: existing.id };

  // An unattended run with the least-privileged role: client viewers read the approved brief, so it may use only what they can
  // see, and it is offered no write tool, no memory tool and no call notes. Its authority is the CRON_SECRET check on the route.
  const ctx: TenantContext = { tenantId: tenant.id, orgId: tenant.orgId, userId: "cron", role: "client_viewer", shop: tenant.shop };
  const message: UIMessage = { id: "brief", role: "user", parts: [{ type: "text", text: briefQuestion(weekStart) }] };
  const { stream, finished } = runAgent(ctx, { messages: [message] }, { db, model: deps.model, env: deps.env, now: deps.now, source: "brief" });
  const { text, verification } = await readAnswer(stream);
  const summary = await finished;
  if (summary.status === "error") throw new AppError(summary.errorCode ?? "INTERNAL_ERROR", "The brief could not be drafted.");
  // No verification means the run hit its step limit or wrote nothing: there is no checked brief to store, so a later run tries again.
  if (!verification || !text) throw new AppError("INTERNAL_ERROR", "The brief could not be drafted.");

  const status: BriefStatus = verification.ok ? "draft" : "blocked";
  const [row] = await db
    .insert(briefs)
    .values({ tenantId: tenant.id, weekStart, status, body: text.slice(0, MAX_BODY_CHARS), unmatched: verification.unmatched.map((u) => u.text) })
    .onConflictDoNothing({ target: [briefs.tenantId, briefs.weekStart] })
    .returning({ id: briefs.id });
  return row ? { outcome: status, briefId: row.id } : { outcome: "exists", briefId: null };
}
