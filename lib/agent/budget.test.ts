import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../db/client";
import { agentRuns, agentSteps, tenants } from "../db/schema";
import { createTestDb } from "../db/test-db";
import { beginRun, finishRun, recordStep } from "./audit";
import { assertBudget, budgetStatus, capUsdFrom, startOfUtcDay } from "./budget";

let db: Db;
let a: string;
let b: string;
const NOW = new Date("2026-11-01T15:30:00Z");

beforeEach(async () => {
  db = await createTestDb();
  const rows = await db
    .insert(tenants)
    .values([
      { orgId: "org_a", name: "A" },
      { orgId: "org_b", name: "B" },
    ])
    .returning();
  a = rows[0]!.id;
  b = rows[1]!.id;
});

async function spend(tenantId: string, usd: number, over: { source?: "chat" | "eval"; at?: Date } = {}) {
  const [run] = await db
    .insert(agentRuns)
    .values({ tenantId, userId: "u", role: "gc_admin", source: over.source ?? "chat", modelId: "devstral-2", status: "ok", costMicros: Math.round(usd * 1e6), startedAt: over.at ?? NOW })
    .returning();
  return run!;
}

describe("capUsdFrom", () => {
  it("reads TENANT_DAILY_BUDGET_USD and defaults to 5 when it is missing or not a positive number", () => {
    expect(capUsdFrom({ TENANT_DAILY_BUDGET_USD: "12.5" })).toBe(12.5);
    for (const bad of [undefined, "", "abc", "0", "-3", "NaN"]) expect(capUsdFrom({ TENANT_DAILY_BUDGET_USD: bad }), String(bad)).toBe(5);
  });
});

describe("startOfUtcDay", () => {
  it("is midnight UTC of the same day", () => {
    expect(startOfUtcDay(NOW).toISOString()).toBe("2026-11-01T00:00:00.000Z");
  });
});

describe("assertBudget", () => {
  const env = { TENANT_DAILY_BUDGET_USD: "5" };

  it("passes while spend is under the cap", async () => {
    await spend(a, 4.99);
    await expect(assertBudget(a, { db, now: NOW, env })).resolves.toBeUndefined();
  });

  it("throws BUDGET_EXCEEDED at or above the cap", async () => {
    await spend(a, 3);
    await spend(a, 2);
    await expect(assertBudget(a, { db, now: NOW, env })).rejects.toMatchObject({ code: "BUDGET_EXCEEDED" });
  });

  it("does not count eval runs", async () => {
    await spend(a, 50, { source: "eval" });
    await expect(assertBudget(a, { db, now: NOW, env })).resolves.toBeUndefined();
  });

  it("does not count another brand's spend", async () => {
    await spend(b, 50);
    await expect(assertBudget(a, { db, now: NOW, env })).resolves.toBeUndefined();
  });

  it("starts afresh at midnight UTC", async () => {
    await spend(a, 50, { at: new Date("2026-10-31T23:59:59Z") });
    await expect(assertBudget(a, { db, now: NOW, env })).resolves.toBeUndefined();
    await spend(a, 50, { at: new Date("2026-11-01T00:00:00Z") });
    await expect(assertBudget(a, { db, now: NOW, env })).rejects.toMatchObject({ code: "BUDGET_EXCEEDED" });
  });
});

describe("budgetStatus", () => {
  it("warns from 80% of the cap", async () => {
    const env = { TENANT_DAILY_BUDGET_USD: "10" };
    await spend(a, 7.9);
    expect(await budgetStatus(a, { db, now: NOW, env })).toMatchObject({ spentUsd: 7.9, capUsd: 10, warn: false, exceeded: false });
    await spend(a, 0.1);
    expect(await budgetStatus(a, { db, now: NOW, env })).toMatchObject({ spentUsd: 8, warn: true, exceeded: false });
    await spend(a, 2);
    expect(await budgetStatus(a, { db, now: NOW, env })).toMatchObject({ exceeded: true });
  });
});

describe("the audit log", () => {
  it("records a run and its steps, with the tenant on every row", async () => {
    const runId = await beginRun(db, { tenantId: a, userId: "user_1", role: "gc_partner", source: "chat", modelId: "devstral-2" });
    await recordStep(db, { runId, tenantId: a, stepIndex: 0, tool: "query_metric", input: { metrics: ["orders"] }, ok: true, rowCount: 1, latencyMs: 42 });
    await recordStep(db, { runId, tenantId: a, stepIndex: 1, tool: "get_orders", input: { limit: 5 }, ok: false, errorCode: "NO_DATA", latencyMs: 7 });
    await finishRun(db, runId, { status: "ok", inputTokens: 1200, outputTokens: 300, costMicros: 1080, steps: 2, repaired: true, flaggedNumbers: 1 });

    const [run] = await db.select().from(agentRuns);
    expect(run).toMatchObject({ id: runId, tenantId: a, userId: "user_1", source: "chat", status: "ok", inputTokens: 1200, outputTokens: 300, costMicros: 1080, steps: 2, repaired: true, flaggedNumbers: 1 });
    expect(run!.finishedAt).not.toBeNull();
    const steps = await db.select().from(agentSteps);
    expect(steps.map((s) => [s.tool, s.ok, s.errorCode, s.rowCount])).toEqual([["query_metric", true, null, 1], ["get_orders", false, "NO_DATA", null]]);
    expect(steps.every((s) => s.tenantId === a)).toBe(true);
  });

  it("marks a run that failed, with its error code", async () => {
    const runId = await beginRun(db, { tenantId: a, userId: "u", role: "gc_admin", source: "chat", modelId: "devstral-2" });
    await finishRun(db, runId, { status: "error", errorCode: "MODEL_TIMEOUT" });
    expect((await db.select().from(agentRuns))[0]).toMatchObject({ status: "error", errorCode: "MODEL_TIMEOUT" });
  });
});
