import type { LanguageModel, UIMessage } from "ai";
import { readAnswer } from "../agent/read-answer";
import { runAgent } from "../agent/run";
import type { Db } from "../db/client";
import { playbookRuns, type PlaybookRunStatus } from "../db/schema";
import { AppError } from "../errors";
import type { Role, TenantContext } from "../tenancy/context";
import { isPlaybookId, parseParams, type PlaybookId } from "./definitions";
import { playbookQuestion } from "./questions";

// A playbook run goes through the same agent loop as the chat, so the number checker runs on its write-up. A write-up whose
// figures the checker could not match, even after its one repair turn, is stored as "blocked".

export interface PlaybookTenant {
  id: string;
  orgId: string;
  shop: NonNullable<TenantContext["shop"]>;
}

export interface PlaybookUser {
  userId: string;
  role: Role; // from the Clerk session
}

export interface PlaybookDeps {
  model?: LanguageModel; // tests inject a mock
  env?: Record<string, string | undefined>;
  now?: Date;
}

export interface PlaybookRunResult {
  outcome: PlaybookRunStatus;
  runId: string;
}

const MAX_BODY_CHARS = 4000;

// Runs one playbook for the signed-in Growth Capital user. The tenant, the store and the role come from the session (the route
// builds `tenant` and `user` from it); a request supplies only the playbook id and its parameters, and both are checked here.
export async function runPlaybook(db: Db, tenant: PlaybookTenant, user: PlaybookUser, id: PlaybookId, rawParams: unknown, deps: PlaybookDeps = {}): Promise<PlaybookRunResult> {
  if (user.role === "client_viewer") throw new AppError("INVALID_INPUT", "Playbooks are for Growth Capital roles only.");
  if (!isPlaybookId(id)) throw new AppError("INVALID_INPUT", "Unknown playbook."); // the route passes a string from the request
  const params = parseParams(id, rawParams);
  const ctx: TenantContext = { tenantId: tenant.id, orgId: tenant.orgId, userId: user.userId, role: user.role, shop: tenant.shop };
  const now = deps.now ?? new Date();

  const message: UIMessage = { id: "playbook", role: "user", parts: [{ type: "text", text: playbookQuestion(id, params, now) }] };
  const { stream, finished } = runAgent(ctx, { messages: [message] }, { db, model: deps.model, env: deps.env, now, source: "playbook" });
  const { text, verification } = await readAnswer(stream);
  const summary = await finished;
  if (summary.status === "error") throw new AppError(summary.errorCode ?? "INTERNAL_ERROR", "The playbook could not be written up.");
  // No verification means the run hit its step limit or wrote nothing: there is no checked write-up to store.
  if (!verification || !text) throw new AppError("INTERNAL_ERROR", "The playbook could not be written up.");

  const status: PlaybookRunStatus = verification.ok ? "ready" : "blocked";
  const [row] = await db
    .insert(playbookRuns)
    .values({
      tenantId: tenant.id,
      playbook: id,
      params: params.month ? { month: params.month } : {},
      status,
      body: text.slice(0, MAX_BODY_CHARS),
      unmatched: verification.unmatched.map((u) => u.text),
      createdBy: user.userId,
    })
    .returning({ id: playbookRuns.id });
  if (!row) throw new AppError("INTERNAL_ERROR", "The playbook could not be saved.");
  return { outcome: status, runId: row.id };
}
