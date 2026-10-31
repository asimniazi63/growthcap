import { describe, expect, it } from "vitest";
import type { ViewData } from "../lib/views/types";
import { grade, numbersIn, type EvalRun, type Expectation } from "./graders";

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
