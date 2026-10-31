import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

// The eval scoreboard: accuracy, cost and latency per category and overall. Written to docs/evals/scoreboard.md and
// scoreboard.json by `npm run eval`, and appended to the job summary in CI.

export interface ScoreInput {
  id: string;
  category: string;
  passed: boolean;
  costUsd: number;
  latencyMs?: number;
}

export interface ScoreRow {
  category: string;
  cases: number;
  passed: number;
  accuracy: number; // 0..1
  costUsd: number;
  avgLatencyMs: number | null;
  p95LatencyMs: number | null;
}

export interface Scoreboard {
  commit: string;
  model: string;
  ranAt: string;
  planned: number; // cases in the set
  ran: number; // cases actually run (fewer when the cost cap stopped the run)
  stoppedByCostCap: boolean;
  maxCostUsd: number | null;
  overall: ScoreRow;
  categories: ScoreRow[];
}

const percentile = (sorted: number[], p: number): number | null => (sorted.length === 0 ? null : sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)]!);

function row(category: string, rs: ScoreInput[]): ScoreRow {
  const lat = rs.flatMap((r) => (r.latencyMs === undefined ? [] : [r.latencyMs])).sort((a, b) => a - b);
  const passed = rs.filter((r) => r.passed).length;
  return {
    category,
    cases: rs.length,
    passed,
    accuracy: rs.length === 0 ? 0 : passed / rs.length,
    costUsd: rs.reduce((s, r) => s + r.costUsd, 0),
    avgLatencyMs: lat.length === 0 ? null : lat.reduce((s, x) => s + x, 0) / lat.length,
    p95LatencyMs: percentile(lat, 0.95),
  };
}

export function buildScoreboard(results: ScoreInput[], meta: { commit: string; model: string; ranAt: string; planned: number; stoppedByCostCap: boolean; maxCostUsd: number | null }): Scoreboard {
  const cats = [...new Set(results.map((r) => r.category))].sort();
  return {
    ...meta,
    ran: results.length,
    overall: row("overall", results),
    categories: cats.map((c) => row(c, results.filter((r) => r.category === c))),
  };
}

const secs = (ms: number | null) => (ms === null ? "n/a" : `${(ms / 1000).toFixed(1)}s`);
const pct = (x: number) => `${(x * 100).toFixed(0)}%`;

export function scoreboardMarkdown(b: Scoreboard): string {
  const line = (r: ScoreRow) => `| ${r.category} | ${r.passed}/${r.cases} | ${pct(r.accuracy)} | $${r.costUsd.toFixed(4)} | ${secs(r.avgLatencyMs)} | ${secs(r.p95LatencyMs)} |`;
  return [
    "# Eval scoreboard",
    "",
    `Commit \`${b.commit}\`, model \`${b.model}\`, run ${b.ranAt}. Cost is at the registry's estimated prices. Latency is the wall time of a case, including its control run when it has one.`,
    ...(b.stoppedByCostCap ? ["", `**Stopped early by the cost cap ($${b.maxCostUsd?.toFixed(2)}): ${b.ran} of ${b.planned} cases ran.** The cases that did not run are not counted as failures.`] : []),
    "",
    "| Category | Passed | Accuracy | Cost | Avg latency | p95 latency |",
    "|---|---|---|---|---|---|",
    ...b.categories.map(line),
    line({ ...b.overall, category: "**overall**" }),
    "",
  ].join("\n");
}

export function writeScoreboard(b: Scoreboard, dir = "docs/evals"): void {
  mkdirSync(dirname(`${dir}/scoreboard.md`), { recursive: true });
  writeFileSync(`${dir}/scoreboard.md`, scoreboardMarkdown(b));
  writeFileSync(`${dir}/scoreboard.json`, `${JSON.stringify(b, null, 2)}\n`);
}
