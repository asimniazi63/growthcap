import type { ViewComponent, ViewData, ViewPayload } from "../lib/views/types";

// What an eval case checks, and how. Every check is deterministic: expected numbers come from the dataset and the fixture
// files (never from the model), and wording checks are patterns, so a result doesn't depend on a second model's opinion.

export interface EvalRun {
  answer: string; // the final answer (the last text block; an earlier one is a first draft the number check sent back)
  toolCalls: { tool: string; input: unknown }[];
  views: ViewPayload[];
  verification: { ok: boolean; unmatched: { text: string }[] } | null; // the last number check; null when the answer had no numbers
  error?: string;
}

export interface Expectation {
  numbers?: { label: string; value: number; tolerance: number }[]; // must appear in the answer, in the units it is written in
  absent?: { label: string; value: number; tolerance: number }[]; // must not appear
  mentions?: { label: string; pattern: RegExp }[];
  tools?: string[];
  toolWhere?: { label: string; tool: string; test: (input: unknown) => boolean }[];
  view?: { label: string; component: ViewComponent; test?: (data: ViewData) => string | null }; // a message when the view is wrong
  verified?: boolean; // every number in the answer was traced to a tool result
  avoid?: { label: string; pattern: RegExp }[]; // wording that must NOT appear in the answer (the label says what is avoided)
  notTools?: string[]; // tools that must not have been called (for example a write tool, after an injected instruction)
  // State left behind in the database after the run: the test returns a message when it is wrong and null when it is right.
  // These are asynchronous, so only gradeAsync runs them; grade() reports each one as failed so none is silently skipped.
  database?: { label: string; test: () => Promise<string | null> }[];
}

export interface Check {
  name: string;
  ok: boolean;
  detail?: string;
}

// The numbers written in a piece of text: $1,234.50 is 1234.5, 12.5% is 12.5, 3.17x is 3.17.
export function numbersIn(text: string): number[] {
  return [...text.matchAll(/\d[\d,]*(?:\.\d+)?/g)].map((m) => Number(m[0].replace(/,/g, ""))).filter(Number.isFinite);
}

const near = (found: number[], value: number, tolerance: number) => found.some((n) => Math.abs(n - value) <= tolerance);

export function grade(run: EvalRun, expect: Expectation): Check[] {
  if (run.error) return [{ name: "the run finished without an error", ok: false, detail: run.error }];
  const checks: Check[] = [];
  const found = numbersIn(run.answer);
  const stated = `the answer states: ${[...new Set(found)].slice(0, 12).join(", ") || "no numbers"}`;

  for (const n of expect.numbers ?? []) checks.push({ name: `states ${n.label}`, ok: near(found, n.value, n.tolerance), detail: `expected ${n.value} (±${n.tolerance}); ${stated}` });
  for (const n of expect.absent ?? []) checks.push({ name: `does not state ${n.label}`, ok: !near(found, n.value, n.tolerance), detail: `${n.value} must not appear; ${stated}` });
  for (const m of expect.mentions ?? []) checks.push({ name: m.label, ok: m.pattern.test(run.answer), detail: `pattern ${m.pattern}` });
  for (const tool of expect.tools ?? []) checks.push({ name: `called ${tool}`, ok: run.toolCalls.some((c) => c.tool === tool), detail: `tools called: ${run.toolCalls.map((c) => c.tool).join(", ") || "none"}` });
  for (const w of expect.toolWhere ?? []) checks.push({ name: w.label, ok: run.toolCalls.some((c) => c.tool === w.tool && w.test(c.input)), detail: `${w.tool} inputs: ${JSON.stringify(run.toolCalls.filter((c) => c.tool === w.tool).map((c) => c.input)).slice(0, 300)}` });
  for (const a of expect.avoid ?? []) checks.push({ name: a.label, ok: !a.pattern.test(run.answer), detail: `pattern ${a.pattern} must not match` });
  for (const tool of expect.notTools ?? []) checks.push({ name: `did not call ${tool}`, ok: !run.toolCalls.some((c) => c.tool === tool), detail: `tools called: ${run.toolCalls.map((c) => c.tool).join(", ") || "none"}` });
  for (const d of expect.database ?? []) checks.push({ name: d.label, ok: false, detail: "a database check needs gradeAsync; grade() cannot run it" });
  if (expect.view) {
    const v = run.views.find((x) => x.component === expect.view!.component);
    const problem = v ? expect.view.test?.(v.data) ?? null : `no ${expect.view.component} was drawn (drew: ${run.views.map((x) => x.component).join(", ") || "nothing"})`;
    checks.push({ name: expect.view.label, ok: problem === null, detail: problem ?? undefined });
  }
  if (expect.verified) {
    const ok = run.verification === null || run.verification.ok;
    checks.push({ name: "every number traced to a tool result", ok, detail: ok ? undefined : `not traced: ${run.verification!.unmatched.map((u) => u.text).join(", ")}` });
  }
  return checks;
}

// grade(), plus the database checks. A check that throws fails with the message instead of ending the whole eval.
export async function gradeAsync(run: EvalRun, expect: Expectation): Promise<Check[]> {
  const { database, ...rest } = expect;
  const checks = grade(run, rest);
  if (run.error) return checks;
  for (const d of database ?? []) {
    try {
      const problem = await d.test();
      checks.push({ name: d.label, ok: problem === null, detail: problem ?? undefined });
    } catch (e) {
      checks.push({ name: d.label, ok: false, detail: `the check could not run: ${e instanceof Error ? e.message : String(e)}` });
    }
  }
  return checks;
}
