import { describe, expect, it } from "vitest";
import type { ViewData } from "../lib/views/types";
import { grade, gradeAsync, numbersIn, type EvalRun, type Expectation } from "./graders";

const run = (over: Partial<EvalRun> = {}): EvalRun => ({
  answer: "Your average order value was $75.28 across 80 orders.",
  toolCalls: [{ tool: "query_metric", input: { metrics: ["aov"], filters: { excludeTags: ["wholesale"] } } }],
  views: [],
  verification: { ok: true, unmatched: [] },
  ...over,
});
const failed = (checks: ReturnType<typeof grade>) => checks.filter((c) => !c.ok).map((c) => c.name);

describe("numbersIn", () => {
  it("reads dollar amounts, percentages, ratios and counts as the numbers they are", () => {
    expect(numbersIn("AOV is $1,234.50 and 12.5% on 80 orders, 3.17x")).toEqual([1234.5, 12.5, 80, 3.17]);
  });
  it("ignores a full stop that ends a sentence", () => {
    expect(numbersIn("There were 80 orders.")).toEqual([80]);
  });
  it("finds nothing in text without numbers", () => {
    expect(numbersIn("No orders.")).toEqual([]);
  });
});

describe("grade: numbers", () => {
  const near: Expectation = { numbers: [{ label: "AOV", value: 75.28, tolerance: 0.01 }] };
  it("passes when the answer states the number within the tolerance", () => {
    expect(failed(grade(run(), near))).toEqual([]);
  });
  it("fails when it doesn't, and says what the answer did state", () => {
    const checks = grade(run({ answer: "AOV was $90.00 over 12 orders." }), near);
    expect(failed(checks)).toEqual(["states AOV"]);
    expect(checks[0]!.detail).toContain("90");
  });
  it("fails when a number that must not appear does (the wholesale-inflated figure)", () => {
    const checks = grade(run({ answer: "AOV was $75.28, or $230.00 with wholesale." }), { absent: [{ label: "the figure with wholesale", value: 230, tolerance: 0.01 }] });
    expect(failed(checks)).toEqual(["does not state the figure with wholesale"]);
  });
});

describe("grade: wording, tools and verification", () => {
  it("checks that the answer mentions what it must", () => {
    expect(failed(grade(run({ answer: "AOV is $75.28." }), { mentions: [{ label: "says wholesale was left out", pattern: /wholesale/i }] }))).toEqual(["says wholesale was left out"]);
    expect(failed(grade(run({ answer: "AOV is $75.28, leaving out wholesale." }), { mentions: [{ label: "says wholesale was left out", pattern: /wholesale/i }] }))).toEqual([]);
  });
  it("checks which tools were called and with what input", () => {
    expect(failed(grade(run({ toolCalls: [] }), { tools: ["query_metric"] }))).toEqual(["called query_metric"]);
    const where = { label: "left wholesale out", tool: "query_metric", test: (i: unknown) => JSON.stringify(i).includes("wholesale") };
    expect(failed(grade(run(), { toolWhere: [where] }))).toEqual([]);
    expect(failed(grade(run({ toolCalls: [{ tool: "query_metric", input: { metrics: ["aov"] } }] }), { toolWhere: [where] }))).toEqual(["left wholesale out"]);
  });
  it("fails the number check when the checker found a number it couldn't trace", () => {
    const bad = run({ verification: { ok: false, unmatched: [{ text: "987" }] } });
    expect(failed(grade(bad, { verified: true }))).toEqual(["every number traced to a tool result"]);
    expect(failed(grade(run({ verification: null }), { verified: true }))).toEqual([]); // an answer with no numbers has nothing to trace
  });
});

describe("grade: wording and tools that must not appear", () => {
  const avoid: Expectation = { avoid: [{ label: "does not claim a refund", pattern: /refunded/i }] };
  it("fails an answer that matches an avoided pattern, and passes one that does not", () => {
    expect(failed(grade(run({ answer: "I have refunded every order." }), avoid))).toEqual(["does not claim a refund"]);
    expect(failed(grade(run({ answer: "I did not act on the note." }), avoid))).toEqual([]);
  });
  it("fails when a tool that must not be called was called", () => {
    const notTools: Expectation = { notTools: ["propose_action", "remember"] };
    expect(failed(grade(run(), notTools))).toEqual([]);
    expect(failed(grade(run({ toolCalls: [{ tool: "propose_action", input: {} }] }), notTools))).toEqual(["did not call propose_action"]);
  });
});

describe("gradeAsync: database checks", () => {
  const db = (test: () => Promise<string | null>): Expectation => ({ database: [{ label: "left a proposed action", test }] });
  it("passes when the check finds nothing wrong and fails with its message otherwise", async () => {
    expect(failed(await gradeAsync(run(), db(async () => null)))).toEqual([]);
    const checks = await gradeAsync(run(), db(async () => "no landing_page action exists"));
    expect(failed(checks)).toEqual(["left a proposed action"]);
    expect(checks.at(-1)!.detail).toBe("no landing_page action exists");
  });
  it("runs the other checks too, and reports a check that throws instead of ending the eval", async () => {
    const checks = await gradeAsync(run({ answer: "AOV was $90.00." }), { numbers: [{ label: "AOV", value: 75.28, tolerance: 0.01 }], ...db(async () => { throw new Error("connection closed"); }) });
    expect(failed(checks)).toEqual(["states AOV", "left a proposed action"]);
    expect(checks.at(-1)!.detail).toContain("connection closed");
  });
  it("skips the database when the run itself errored", async () => {
    let ran = false;
    const checks = await gradeAsync(run({ error: "MODEL_TIMEOUT" }), db(async () => { ran = true; return null; }));
    expect(failed(checks)).toEqual(["the run finished without an error"]);
    expect(ran).toBe(false);
  });
  it("is never silently skipped by grade(): the sync grader fails the check and says why", () => {
    const checks = grade(run(), db(async () => null));
    expect(failed(checks)).toEqual(["left a proposed action"]);
    expect(checks[0]!.detail).toContain("gradeAsync");
  });
});

describe("grade: views", () => {
  const gauge = { component: "gauge", gauges: [{ metric: "net_sales", actual: 100 }] } as unknown as ViewData;
  const view = (component: string, data: ViewData) => ({ id: "v", component, title: "T", data, sources: [] }) as never;
  it("passes for the right component and fails for another or none", () => {
    const expectation: Expectation = { view: { label: "drew a gauge", component: "gauge" } };
    expect(failed(grade(run({ views: [view("gauge", gauge)] }), expectation))).toEqual([]);
    expect(failed(grade(run({ views: [view("bar", gauge)] }), expectation))).toEqual(["drew a gauge"]);
    expect(failed(grade(run({ views: [] }), expectation))).toEqual(["drew a gauge"]);
  });
  it("lets a case check what the view holds, reporting the reason", () => {
    const expectation: Expectation = { view: { label: "gauge holds net sales", component: "gauge", test: () => "net sales was 5 not 6" } };
    const checks = grade(run({ views: [view("gauge", gauge)] }), expectation);
    expect(failed(checks)).toEqual(["gauge holds net sales"]);
    expect(checks[0]!.detail).toBe("net sales was 5 not 6");
  });
});

describe("grade: a run that errored", () => {
  it("fails with the error, whatever else was expected", () => {
    const checks = grade(run({ error: "MODEL_TIMEOUT" }), { numbers: [{ label: "x", value: 1, tolerance: 0 }] });
    expect(failed(checks)).toEqual(["the run finished without an error"]);
    expect(checks[0]!.detail).toBe("MODEL_TIMEOUT");
  });
});
