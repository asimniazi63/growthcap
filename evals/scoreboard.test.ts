import { describe, expect, it } from "vitest";
import { buildScoreboard, scoreboardMarkdown } from "./scoreboard";

const meta = { commit: "abc1234", model: "claude-sonnet-4-6", ranAt: "2026-11-01T00:00:00.000Z", planned: 4, stoppedByCostCap: false, maxCostUsd: null };

describe("buildScoreboard", () => {
  it("scores accuracy, cost and latency per category and overall", () => {
    const b = buildScoreboard(
      [
        { id: "a", category: "plan", passed: true, costUsd: 0.1, latencyMs: 4000 },
        { id: "b", category: "plan", passed: false, costUsd: 0.2, latencyMs: 8000 },
        { id: "c", category: "lookup", passed: true, costUsd: 0.05, latencyMs: 2000 },
      ],
      meta,
    );
    expect(b.ran).toBe(3);
    expect(b.overall).toMatchObject({ cases: 3, passed: 2 });
    expect(b.overall.accuracy).toBeCloseTo(2 / 3, 6);
    expect(b.overall.costUsd).toBeCloseTo(0.35, 6);
    expect(b.categories.map((c) => c.category)).toEqual(["lookup", "plan"]);
    const plan = b.categories.find((c) => c.category === "plan")!;
    expect(plan).toMatchObject({ cases: 2, passed: 1, accuracy: 0.5, avgLatencyMs: 6000, p95LatencyMs: 8000 });
  });

  it("says so when the cost cap stopped the run, and handles no latency", () => {
    const b = buildScoreboard([{ id: "a", category: "plan", passed: true, costUsd: 1 }], { ...meta, stoppedByCostCap: true, maxCostUsd: 1 });
    expect(b.overall.avgLatencyMs).toBeNull();
    const md = scoreboardMarkdown(b);
    expect(md).toContain("Stopped early by the cost cap ($1.00): 1 of 4 cases ran.");
    expect(md).toContain("n/a");
  });
});
