// `npm run eval -- [--case <id>]... [--model <id>] [--max-cost <usd>] [--out <file>]`
// --max-cost (or EVAL_MAX_COST_USD) stops starting new cases once the estimated cost reaches the cap, and says so.
// Asks the real model each case's question against the fixture data (an in-memory database, today pinned), grades the
// answer with deterministic checks, and writes docs/evals/latest.md and latest.json when every case was run.
// It makes PAID model calls (a few cents) and prints which model it used. Run it only on purpose.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { UIMessageChunk } from "ai";
import { setTestNow } from "../lib/clock";
import { createTestDb } from "../lib/db/test-db";
import { memories, tenants } from "../lib/db/schema";
import { resolveModel } from "../lib/agent/models";
import { runAgent, type RunSummary } from "../lib/agent/run";
import type { TenantContext } from "../lib/tenancy/context";
import type { ViewPayload } from "../lib/views/types";
import { loadDataset, readFixture } from "../scripts/fixtures/load-db";
import { loadAdSpend, loadPlan, readFixtureFile } from "../scripts/fixtures/load-pace";
import { STORES } from "../scripts/seed/stores.js";
import type { StoreKey } from "../scripts/seed/types.js";
import { CASES, type EvalCase, type EvalEnv } from "./cases";
import { gradeAsync, numbersIn, type Check, type EvalRun } from "./graders";
import { buildScoreboard, writeScoreboard } from "./scoreboard";
import { flushTraces, startTracing } from "../lib/ops/tracing";

const args = (name: string) => process.argv.flatMap((a, i) => (a === `--${name}` && process.argv[i + 1] ? [process.argv[i + 1]!] : []));

async function ask(env: EvalEnv, question: string, modelId: string | undefined): Promise<{ run: EvalRun; summary: RunSummary }> {
  const { stream, finished } = runAgent(env.ctx, { messages: [{ id: "m1", role: "user", parts: [{ type: "text", text: question }] }], modelId }, { db: env.db, source: "eval", env: process.env });
  const chunks: UIMessageChunk[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const summary = await finished;

  const blocks: string[] = [];
  for (const c of chunks) {
    if (c.type === "text-start") blocks.push("");
    else if (c.type === "text-delta" && blocks.length > 0) blocks[blocks.length - 1] += c.delta;
  }
  const data = <T>(type: string) => chunks.filter((c) => c.type === type).map((c) => (c as unknown as { data: T }).data);
  const verification = data<{ ok: boolean; unmatched: { text: string }[] }>("data-verification").at(-1) ?? null;
  const error = (chunks.find((c) => c.type === "error") as { errorText?: string } | undefined)?.errorText;
  return {
    run: {
      answer: blocks.at(-1) ?? "",
      toolCalls: chunks.filter((c) => c.type === "tool-input-available").map((c) => ({ tool: (c as { toolName: string }).toolName, input: (c as { input: unknown }).input })),
      views: data<ViewPayload>("data-view"),
      verification,
      ...(error ? { error } : {}),
    },
    summary,
  };
}

interface CaseResult {
  id: string;
  category: string;
  passed: boolean;
  checks: Check[];
  answer: string;
  control?: { answer: string; numbers: number[] };
  costUsd: number;
  latencyMs: number;
  tokens: { input: number; output: number };
}

async function runCase(c: EvalCase, env: EvalEnv, modelId: string | undefined): Promise<CaseResult> {
  setTestNow(c.now);
  await env.db.delete(memories);
  const started = Date.now();
  let cost = 0;
  const tokens = { input: 0, output: 0 };
  const count = (s: RunSummary) => {
    cost += s.costMicros / 1e6;
    tokens.input += s.inputTokens;
    tokens.output += s.outputTokens;
  };

  let control: CaseResult["control"];
  if (c.control) {
    const base = await ask(env, c.question, modelId);
    count(base.summary);
    control = { answer: base.run.answer, numbers: [...new Set(numbersIn(base.run.answer))] };
  }
  await c.setup?.(env);
  const { run, summary } = await ask(env, c.question, modelId);
  count(summary);
  await env.db.delete(memories);

  const checks = await gradeAsync(run, c.expect(env));
  return { id: c.id, category: c.category, passed: checks.every((k) => k.ok), checks, answer: run.answer, ...(control ? { control } : {}), costUsd: cost, latencyMs: Date.now() - started, tokens };
}

function markdown(results: CaseResult[], meta: { commit: string; model: string; ranAt: string }): string {
  const total = results.reduce((s, r) => s + r.costUsd, 0);
  const lines = [
    "# Eval results",
    "",
    `Commit \`${meta.commit}\`, model \`${meta.model}\`, run ${meta.ranAt}. The clock is pinned per case and the data is the fixture data (an in-memory database), so a run does not depend on the day it is made or on the live store. Expected numbers are read from the dataset and the fixture files, not from the code under test. Cost is at estimated prices: $${total.toFixed(4)}.`,
    "",
    `**${results.filter((r) => r.passed).length} of ${results.length} cases passed.**`,
    "",
    "| Case | Category | Result | Checks | Cost |",
    "|---|---|---|---|---|",
    ...results.map((r) => `| ${r.id} | ${r.category} | ${r.passed ? "pass" : "FAIL"} | ${r.checks.filter((k) => k.ok).length}/${r.checks.length} | $${r.costUsd.toFixed(4)} |`),
    "",
  ];
  for (const r of results) {
    lines.push(`## ${r.id}`, "", ...r.checks.map((k) => `- ${k.ok ? "pass" : "FAIL"}: ${k.name}${k.ok || !k.detail ? "" : ` (${k.detail})`}`));
    if (r.control) lines.push("", `Without the setup the answer stated: ${r.control.numbers.slice(0, 8).join(", ") || "no numbers"}.`);
    lines.push("", `Answer: ${r.answer.replace(/\s+/g, " ").trim()}`, "");
  }
  return lines.join("\n");
}

async function main(): Promise<void> {
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  if (!process.env.AWS_BEARER_TOKEN_BEDROCK && !(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY)) {
    throw new Error("AWS_BEARER_TOKEN_BEDROCK (or AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY) is not set (put it in .env.local). The evals call the real model.");
  }
  const ids = args("case");
  const selected = ids.length > 0 ? CASES.filter((c) => ids.includes(c.id)) : CASES;
  if (selected.length === 0) throw new Error(`No such case. Cases: ${CASES.map((c) => c.id).join(", ")}`);
  const modelId = args("model")[0];
  const capText = args("max-cost")[0] ?? process.env.EVAL_MAX_COST_USD?.trim();
  const maxCost = capText ? Number(capText) : null;
  if (maxCost !== null && (!Number.isFinite(maxCost) || maxCost <= 0)) throw new Error(`--max-cost must be a positive number of US dollars, got ${JSON.stringify(capText)}.`);
  startTracing(); // no-op unless the LANGFUSE_* variables are set; the traces are tagged route "eval"
  const spec = resolveModel(modelId, "chat", process.env);
  console.log(`Model: ${spec.id}. ${selected.length} case${selected.length === 1 ? "" : "s"}. These are paid model calls.`);

  const db = await createTestDb();
  const envs = new Map<StoreKey, EvalEnv>();
  for (const store of new Set(selected.map((c) => c.store))) {
    const [tenant] = await db.insert(tenants).values({ orgId: `org_${store}`, name: STORES[store].name }).returning();
    const fx = readFixture(store);
    await loadDataset(db, tenant!.id, store, fx.dataset);
    await loadAdSpend(db, tenant!.id, readFixtureFile(store, "ad-spend.csv"));
    await loadPlan(db, tenant!.id, readFixtureFile(store, "plan.csv"), `${STORES[store].name} plan (fixture)`);
    const ctx: TenantContext = { tenantId: tenant!.id, orgId: `org_${store}`, userId: "eval", role: "gc_admin", shop: { domain: `${store}.myshopify.com`, timezone: STORES[store].timezone, currency: "USD", status: "connected" } };
    envs.set(store, { store, db, ctx, dataset: fx.dataset, truth: fx.truth });
  }

  const results: CaseResult[] = [];
  let stoppedByCostCap = false;
  for (const c of selected) {
    const spentSoFar = results.reduce((sum, r) => sum + r.costUsd, 0);
    if (maxCost !== null && spentSoFar >= maxCost) {
      stoppedByCostCap = true;
      console.log(`Cost cap reached ($${spentSoFar.toFixed(4)} of $${maxCost.toFixed(2)}): not starting ${c.id} or the ${selected.length - results.length - 1} after it.`);
      break;
    }
    process.stdout.write(`${c.id} ... `);
    const r = await runCase(c, envs.get(c.store)!, modelId);
    results.push(r);
    console.log(`${r.passed ? "pass" : "FAIL"} (${r.checks.filter((k) => k.ok).length}/${r.checks.length}, $${r.costUsd.toFixed(4)})`);
    for (const k of r.checks.filter((x) => !x.ok)) console.log(`    FAIL: ${k.name}${k.detail ? ` - ${k.detail}` : ""}`);
  }
  setTestNow(null);

  const total = results.reduce((s, r) => s + r.costUsd, 0);
  console.log(`\n${results.filter((r) => r.passed).length}/${results.length} passed. Model ${spec.id}. Estimated cost $${total.toFixed(4)}.`);
  const out = args("out")[0];
  const meta0 = { ranAt: new Date().toISOString(), planned: selected.length, stoppedByCostCap, maxCostUsd: maxCost };
  if (out) {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, `${JSON.stringify({ model: spec.id, ranAt: new Date().toISOString(), singleAgent: process.env.AGENT_SINGLE_AGENT === "true", totalCostUsd: total, cases: results }, null, 2)}\n`);
    console.log(`Wrote ${out}`);
  }
  let commit = "unknown";
  try {
    commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    /* not a git checkout */
  }
  const meta = { commit, model: spec.id, ranAt: meta0.ranAt };
  // The scoreboard is written for any run that finished at least one case (a capped run says so in it). latest.md and
  // latest.json stay what they were: the record of a full run of every case.
  if (results.length > 0 && !args("case").length) writeScoreboard(buildScoreboard(results, { ...meta, ...meta0 }));
  if (selected.length === CASES.length && results.length === CASES.length) {
    mkdirSync("docs/evals", { recursive: true });
    writeFileSync("docs/evals/latest.md", markdown(results, meta));
    writeFileSync("docs/evals/latest.json", `${JSON.stringify({ ...meta, totalCostUsd: total, cases: results }, null, 2)}\n`);
    console.log("Wrote docs/evals/latest.md, latest.json and scoreboard.md/json");
  } else if (results.length > 0 && !args("case").length) {
    console.log("Wrote docs/evals/scoreboard.md and scoreboard.json (a partial run: latest.md and latest.json are unchanged)");
  }
  await flushTraces();
  process.exit(results.length > 0 && results.every((r) => r.passed) ? 0 : 1);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
