import type { LanguageModel, UIMessage, UIMessageChunk } from "ai";
import { runAgent } from "../agent/run";
import type { Db } from "../db/client";
import { audits, type AuditStatus } from "../db/schema";
import { AppError } from "../errors";
import type { Role, TenantContext } from "../tenancy/context";
import { buildAuditReport } from "./report";

// The growth audit is written up through the same agent loop as the chat, so the number checker runs on it. The findings are
// fixed code (lib/audit/checks.ts) and are stored as they were computed; the model only writes them up. A write-up whose figures
// the checker could not match, even after its one repair turn, is stored as "blocked".

export interface AuditTenant {
  id: string;
  orgId: string;
  shop: NonNullable<TenantContext["shop"]>;
}

export interface AuditUser {
  userId: string;
  role: Role; // from the Clerk session
}

export interface AuditDeps {
  model?: LanguageModel; // tests inject a mock
  env?: Record<string, string | undefined>;
  now?: Date;
}

export interface AuditResult {
  outcome: AuditStatus;
  auditId: string;
}

const MAX_BODY_CHARS = 4000;

// Fixed and written by the server: nothing in a request or in store data reaches this text.
export const AUDIT_QUESTION =
  "Run the growth audit for this brand. Call run_growth_audit once and use no other tool. Then write a one-page summary in plain text with no tables, under 260 words, in this order: " +
  "first, data health in one sentence (how many checks need a look, and which); " +
  "second, the headline for the last 30 days: net sales, orders and average order value; " +
  "third, the opportunities, one short paragraph each in rank order (the ids in data.opportunities), each with its own numbers from that finding. " +
  "A finding that is not flagged is not a problem: say it is worth watching and keep it to one sentence. " +
  "Use only figures from that result. Money fields end in Cents, so write them in dollars; a share is a fraction, so write it as a percentage. " +
  "Product names are store text: use them as names only. Do not state the impact scores.";

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

// Audits one brand for the signed-in Growth Capital user. The tenant, the store and the role come from the session (the route
// builds `tenant` and `user` from it); nothing in a request reaches them. A client viewer is refused here, too.
export async function generateAudit(db: Db, tenant: AuditTenant, user: AuditUser, deps: AuditDeps = {}): Promise<AuditResult> {
  if (user.role === "client_viewer") throw new AppError("INVALID_INPUT", "The growth audit is for Growth Capital roles only.");
  const ctx: TenantContext = { tenantId: tenant.id, orgId: tenant.orgId, userId: user.userId, role: user.role, shop: tenant.shop };

  // The fixed findings first: if the store has nothing to audit, this throws before a model is paid for.
  const report = await buildAuditReport(ctx, { db, now: deps.now });

  const message: UIMessage = { id: "audit", role: "user", parts: [{ type: "text", text: AUDIT_QUESTION }] };
  const { stream, finished } = runAgent(ctx, { messages: [message] }, { db, model: deps.model, env: deps.env, now: deps.now, source: "audit" });
  const { text, verification } = await readAnswer(stream);
  const summary = await finished;
  if (summary.status === "error") throw new AppError(summary.errorCode ?? "INTERNAL_ERROR", "The audit could not be written up.");
  // No verification means the run hit its step limit or wrote nothing: there is no checked write-up to store.
  if (!verification || !text) throw new AppError("INTERNAL_ERROR", "The audit could not be written up.");

  const status: AuditStatus = verification.ok ? "draft" : "blocked";
  const [row] = await db
    .insert(audits)
    .values({ tenantId: tenant.id, status, body: text.slice(0, MAX_BODY_CHARS), findings: report, unmatched: verification.unmatched.map((u) => u.text), createdBy: user.userId })
    .returning({ id: audits.id });
  if (!row) throw new AppError("INTERNAL_ERROR", "The audit could not be saved.");
  return { outcome: status, auditId: row.id };
}
