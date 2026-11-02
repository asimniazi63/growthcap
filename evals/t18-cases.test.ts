import { describe, expect, it } from "vitest";
import { playbookQuestion } from "../lib/playbooks/definitions";
import { readFixture } from "../scripts/fixtures/load-db";
import { CASES, type EvalEnv } from "./cases";
import { grade, type EvalRun } from "./graders";
import { T18_CASES } from "./t18-cases";
import { shortfall, withCalendarAndNotes } from "./why-cases";

// The playbook case is never run here (it costs money). This checks that it is registered, that it asks the playbook's own
// question for October 2026, that its expected figures are October's from the fixtures, and that a good write-up passes while
// one that misses the budget cut fails.

const env = { store: "solenne", truth: readFixture("solenne").truth } as EvalEnv;
const review = T18_CASES.find((c) => c.id === "playbook-monthly-review-october")!;
const run = (answer: string, month = "2026-10"): EvalRun => ({
  answer,
  toolCalls: [
    { tool: "query_metric", input: { metric: "net_sales" } },
    { tool: "explain_gap", input: { month } },
  ],
  views: [],
  verification: { ok: true, unmatched: [] },
});
const failed = (r: EvalRun) => grade(r, review.expect(env)).filter((k) => !k.ok).map((k) => k.name);

const retention = T18_CASES.find((c) => c.id === "playbook-retention-check")!;
const retentionRun = (answer: string): EvalRun => ({
  answer,
  toolCalls: [
    { tool: "get_cohorts", input: { windowDays: 60 } },
    { tool: "query_metric", input: { metrics: ["returning_customer_rate"] } },
  ],
  views: [],
  verification: { ok: true, unmatched: [] },
});
const retentionFailed = (answer: string) => grade(retentionRun(answer), retention.expect(env)).filter((k) => !k.ok).map((k) => k.name);

describe("the retention check eval case (T18)", () => {
  it("takes the repeat rate worded as a second order, a return or a repeat (found in the 2026-11-02 full run)", () => {
    for (const worded of ["22.2% of new customers placed a second order within 60 days of their first", "22.2% of them came back within 60 days", "The repeat rate is 22.2%", "22.2% ordered again within 60 days"]) {
      expect(retentionFailed(`${worded}, based on 409 customers.`), worded).toEqual([]);
    }
    expect(retentionFailed("Many customers placed a second order, based on 409 customers.")).toEqual(["gives the repeat rate as a percentage"]);
    expect(retentionFailed("The repeat rate is 22.2%.")).toEqual(["says how many customers were counted"]);
  });
});

describe("the playbook eval case (T18)", () => {
  it("is one case with a unique id, registered with the others", () => {
    expect(T18_CASES.map((c) => c.id)).toEqual(["playbook-monthly-review-october", "playbook-retention-check"]);
    expect(CASES).toContain(review);
    expect(CASES.filter((c) => c.id === review.id)).toHaveLength(1);
    expect(review).toMatchObject({ category: "playbook", store: "solenne", now: "2026-11-02T12:00:00-05:00" });
  });

  it("asks the monthly review's own question for 2026-10, with the calendar and call notes loaded", () => {
    expect(review.question).toBe(playbookQuestion("monthly-review", { month: "2026-10" }, new Date(review.now)));
    expect(review.question).toMatch(/2026-10|October 2026/);
    expect(review.setup).toBe(withCalendarAndNotes);
  });

  it("expects October's shortfall and new-customer orders from the fixtures", () => {
    const e = review.expect(env);
    expect(e.numbers).toEqual([
      { label: "the October shortfall to plan", value: shortfall(env, "2026-10"), tolerance: 0.5 },
      { label: "October's new-customer orders", value: env.truth.monthly["2026-10"]!.new_customer_orders, tolerance: 0 },
    ]);
    expect(e.tools).toEqual(["query_metric", "explain_gap"]);
    expect(e.verified).toBe(true);
  });

  it("passes a write-up that names the budget cut and fails one that does not", () => {
    const gap = shortfall(env, "2026-10").toFixed(2);
    const newOrders = env.truth.monthly["2026-10"]!.new_customer_orders;
    const good = `October finished $${gap} short of plan. The main drag was new-customer orders (${newOrders}). The Meta prospecting budget was cut on October 5.`;
    expect(failed(run(good))).toEqual([]);
    expect(failed(run(`October finished $${gap} short of plan, with ${newOrders} new-customer orders, because demand was weak.`))).toEqual(["names the Meta prospecting budget cut"]);
    expect(failed(run(good, "2026-09"))).toEqual(["called explain_gap for 2026-10"]);
  });
});
