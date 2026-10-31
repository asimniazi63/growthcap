import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { agentRuns, agentSteps, type AgentSource } from "../db/schema";

export interface RunStart {
  tenantId: string;
  userId: string;
  role: string;
  source: AgentSource;
  modelId: string;
}

export interface RunFinish {
  status: "ok" | "error";
  errorCode?: string;
  inputTokens?: number;
  outputTokens?: number;
  costMicros?: number;
  steps?: number;
  repaired?: boolean;
  flaggedNumbers?: number;
}

export interface StepRecord {
  runId: string;
  tenantId: string;
  stepIndex: number;
  tool: string;
  input: unknown; // the model's own arguments; never the tool's result
  ok: boolean;
  errorCode?: string;
  rowCount?: number;
  latencyMs: number;
}

export async function beginRun(db: Db, run: RunStart): Promise<string> {
  const [row] = await db.insert(agentRuns).values(run).returning({ id: agentRuns.id });
  return row!.id;
}

export async function recordStep(db: Db, step: StepRecord): Promise<void> {
  await db.insert(agentSteps).values({ ...step, errorCode: step.errorCode ?? null, rowCount: step.rowCount ?? null });
}

export async function finishRun(db: Db, runId: string, result: RunFinish): Promise<void> {
  await db
    .update(agentRuns)
    .set({
      status: result.status,
      errorCode: result.errorCode ?? null,
      finishedAt: new Date(),
      ...(result.inputTokens !== undefined ? { inputTokens: result.inputTokens } : {}),
      ...(result.outputTokens !== undefined ? { outputTokens: result.outputTokens } : {}),
      ...(result.costMicros !== undefined ? { costMicros: result.costMicros } : {}),
      ...(result.steps !== undefined ? { steps: result.steps } : {}),
      ...(result.repaired !== undefined ? { repaired: result.repaired } : {}),
      ...(result.flaggedNumbers !== undefined ? { flaggedNumbers: result.flaggedNumbers } : {}),
    })
    .where(eq(agentRuns.id, runId));
}
