import { describe, expect, it } from "vitest";
import { readFixture } from "../scripts/fixtures/load-db";
import type { EvalEnv } from "./cases";
import { grade, type EvalRun } from "./graders";
import { WHY_CASES } from "./why-cases";

// The why cases are never run here (they cost money). This checks that their expectations are readable from the fixtures and
// that a good answer passes and an answer that invents a cause fails.

const env = { store: "solenne", truth: readFixture("solenne").truth } as EvalEnv;
const run = (answer: string, month: string): EvalRun => ({
  answer,
  toolCalls: [{ tool: "explain_gap", input: { month } }],
  views: [],
  verification: { ok: true, unmatched: [] },
});
const failed = (id: string, answer: string, month: string) => {
  const c = WHY_CASES.find((x) => x.id === id)!;
  return grade(run(answer, month), c.expect(env)).filter((k) => !k.ok).map((k) => k.name);
};

describe("why eval cases", () => {
  it("are five, for S9, S7, S4, S5 and a month where nothing was planted", () => {
    expect(WHY_CASES.map((c) => c.id)).toEqual(["why-october-meta-cut", "why-september-serum-stockout", "why-june-barrier-cream-refunds", "why-july-fig-sellout", "why-april-nothing-planted"]);
    for (const c of WHY_CASES) expect(c).toMatchObject({ category: "why", store: "solenne", question: expect.stringMatching(/^Why did we miss plan in \w+\?$/) });
  });

  it("S9 passes an answer with the shortfall, the new-customer orders, the Meta cut and the call note", () => {
    const answer = "October finished $604.88 short of plan, mostly new-customer orders (34 against a plan of 44). The Meta prospecting budget was cut on October 5, as the call note Solenne x Growth Capital: Q4 budget and planning (2026-10-01) records.";
    expect(failed("why-october-meta-cut", answer, "2026-10")).toEqual([]);
    expect(failed("why-october-meta-cut", "October was slow because of weak demand.", "2026-10").length).toBeGreaterThan(3);
  });

  it("S7 needs the serum and the supply call note cited by title and date", () => {
    const answer = "September was $751.20 behind plan. The Hero Vitamin C Serum was out of stock for 11 days; the supply check-in call note (2026-08-27) records the supplier delay.";
    expect(failed("why-september-serum-stockout", answer, "2026-09")).toEqual([]);
    expect(failed("why-september-serum-stockout", "The Hero Vitamin C Serum was out of stock; the shortfall was $751.20.", "2026-09")).toEqual(["cites the supply call note by its title", "cites the supply call note by its date"]);
  });

  it("S4 and S5 expect the product and the cause", () => {
    expect(failed("why-june-barrier-cream-refunds", "June was $279.30 behind plan; refunds of the Barrier Cream rose.", "2026-06")).toEqual([]);
    expect(failed("why-july-fig-sellout", "July was $76.25 behind plan: the Lip Tint in Fig went viral, then sold out.", "2026-07")).toEqual([]);
    expect(failed("why-july-fig-sellout", "July was $76.25 behind plan.", "2026-07").length).toBe(2);
  });

  it("the month with nothing planted passes 'no clear cause' and fails an invented one", () => {
    expect(failed("why-april-nothing-planted", "April finished $14.00 behind plan. I found no clear cause: no single driver stands out.", "2026-04")).toEqual([]);
    expect(failed("why-april-nothing-planted", "April finished $14.00 behind plan, a small gap. The Meta prospecting budget cut hit new customers.", "2026-04")).toEqual([
      "names no cause from another month (budget cut, stock-out, viral product, bad batch, leaked code)",
    ]);
    expect(failed("why-april-nothing-planted", "April missed plan because the serum went out of stock.", "2026-04").length).toBeGreaterThan(1);
  });
});
