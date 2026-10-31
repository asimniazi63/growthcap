import { and, eq, gte, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { agentRuns } from "../db/schema";
import { AppError } from "../errors";

const DEFAULT_CAP_USD = 5;
const WARN_AT = 0.8;

type Env = Record<string, string | undefined>;

export interface BudgetDeps {
  db?: Db;
  now?: Date;
  env?: Env;
}

// Each brand has a model spend cap per UTC day. TENANT_DAILY_BUDGET_USD sets it for every brand (per-brand caps are
// a later step); a missing or nonsensical value means the default, never "no cap".
export function capUsdFrom(env: Env = process.env): number {
  const n = Number(env.TENANT_DAILY_BUDGET_USD);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_CAP_USD;
}

export function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export interface BudgetStatus {
  spentUsd: number;
  capUsd: number;
  warn: boolean; // 80% or more of the cap
  exceeded: boolean;
}

// Spend counts chat runs only: eval runs are ours, not the brand's.
export async function budgetStatus(tenantId: string, deps: BudgetDeps = {}): Promise<BudgetStatus> {
  const db = deps.db ?? (await import("../db/client")).getDb();
  const since = startOfUtcDay(deps.now ?? new Date());
  const [row] = await db
    .select({ micros: sql<string>`coalesce(sum(${agentRuns.costMicros}), 0)` })
    .from(agentRuns)
    .where(and(eq(agentRuns.tenantId, tenantId), eq(agentRuns.source, "chat"), gte(agentRuns.startedAt, since)));
  const spentUsd = Number(row?.micros ?? 0) / 1e6;
  const capUsd = capUsdFrom(deps.env);
  return { spentUsd, capUsd, warn: spentUsd >= capUsd * WARN_AT, exceeded: spentUsd >= capUsd };
}

export async function assertBudget(tenantId: string, deps: BudgetDeps = {}): Promise<void> {
  const status = await budgetStatus(tenantId, deps);
  if (status.exceeded) throw new AppError("BUDGET_EXCEEDED", "This brand's AI budget is used up until midnight UTC.");
}
