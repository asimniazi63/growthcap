import { describe, expect, it } from "vitest";
import { TOOL_DEFS } from "../lib/agent/tools";
import { readFixture } from "../scripts/fixtures/load-db";
import { CASES, type EvalCase, type EvalEnv } from "./cases";
import { EBITDA_CASES } from "./ebitda-cases";
import { grade, type EvalRun } from "./graders";

// The EBITDA cases are never run here (they cost money). This checks that they are registered once, that the tools they expect
// exist, that the expected operating costs are August's from costs.csv, and that a good answer passes while the answers each case
// is built to catch fail: no mention of assumed rates, the cut called free, or the cut passed as 20 instead of 0.2.

const env = { store: "solenne", ...readFixture("solenne") } as EvalEnv;
const august = EBITDA_CASES.find((c) => c.id === "ebitda-solenne-august")!;
const adsCut = EBITDA_CASES.find((c) => c.id === "ebitda-ads-cut")!;

const run = (answer: string, tool: string, input: unknown = {}): EvalRun => ({ answer, toolCalls: [{ tool, input }], views: [], verification: { ok: true, unmatched: [] } });
const failed = (c: EvalCase, r: EvalRun) => grade(r, c.expect(env)).filter((k) => !k.ok).map((k) => k.name);

describe("the EBITDA eval cases", () => {
  it("are two Solenne cases with fixed clocks, registered once with the others", () => {
    expect(EBITDA_CASES.map((c) => c.id)).toEqual(["ebitda-solenne-august", "ebitda-ads-cut"]);
    for (const c of EBITDA_CASES) {
      expect(c).toMatchObject({ category: "ebitda", store: "solenne", now: "2026-11-02T12:00:00-05:00" });
      expect(c.question.trim().length, c.id).toBeGreaterThan(10);
      expect(Number.isNaN(Date.parse(c.now)), c.id).toBe(false);
      expect(CASES, c.id).toContain(c);
      expect(CASES.filter((x) => x.id === c.id), c.id).toHaveLength(1);
    }
    expect(august.question).toBe("What was Solenne's EBITDA in August 2026, and what is it made of?");
    expect(adsCut.question).toBe("What happens to our profit if we cut ad spend by 20%?");
  });

  it("expect the tool each question needs, which exists, and a verified answer", () => {
    expect(august.expect(env).tools).toEqual(["get_ebitda"]);
    expect(adsCut.expect(env).tools).toEqual(["get_ebitda_scenario"]);
    for (const c of EBITDA_CASES) {
      const e = c.expect(env);
      expect(e.verified, c.id).toBe(true);
      for (const t of e.tools ?? []) expect(Object.keys(TOOL_DEFS), `${c.id} expects ${t}`).toContain(t);
      for (const w of e.toolWhere ?? []) expect(Object.keys(TOOL_DEFS), `${c.id} checks ${w.tool}`).toContain(w.tool);
    }
  });

  it("expect August's operating costs from costs.csv, in dollars", () => {
    // Written out here as an independent anchor: software 32,500 and contractors 30,000 cents in 2026-08. October's are 65,000.
    expect(august.expect(env).numbers).toEqual([{ label: "August's operating costs from the cost sheet", value: 625, tolerance: 0.01 }]);
  });
});

describe("the August case", () => {
  const GOOD =
    "Solenne's EBITDA in August 2026 was $2,078.44. Net sales and orders come from Shopify, and cost of goods uses today's unit cost; ad spend is from the ad spend file. " +
    "Card fees and fulfilment are assumed rates (2.9% plus $0.30 an order, and $4.50 an order), not Shopify data. Operating costs were $625.00 from the cost sheet: software $325.00 and contractors $300.00.";

  it("passes an answer that gives the operating costs and calls the card fees and fulfilment assumed", () => {
    expect(failed(august, run(GOOD, "get_ebitda"))).toEqual([]);
  });

  it("fails an answer with another month's operating costs, no word about assumed rates, the wrong tool, or an untraced figure", () => {
    expect(failed(august, run(GOOD.replace("$625.00", "$650.00"), "get_ebitda"))).toEqual(["states August's operating costs from the cost sheet"]);
    const noAssumption = GOOD.replace("Card fees and fulfilment are assumed rates (2.9% plus $0.30 an order, and $4.50 an order), not Shopify data. ", "");
    expect(failed(august, run(noAssumption, "get_ebitda"))).toEqual(["says card fees and fulfilment are assumed rates"]);
    expect(failed(august, run(GOOD, "query_metric"))).toEqual(["called get_ebitda"]);
    expect(failed(august, { ...run(GOOD, "get_ebitda"), verification: { ok: false, unmatched: [{ text: "$2,078.44" }] } })).toEqual(["every number traced to a tool result"]);
  });

  it("takes the assumed rates worded either way round, and an estimate, but not a mention of only one of the two", () => {
    for (const worded of [
      "The card fees are assumed, as is fulfilment.",
      "Fulfilment and card fees are estimates based on assumed rates.",
      "Assumed rates cover card fees and fulfilment.",
      "I assumed a card fee of 2.9% plus $0.30 an order, and a flat fulfilment cost per order.",
    ]) {
      expect(failed(august, run(`EBITDA was $2,078.44. Operating costs were $625.00. ${worded}`, "get_ebitda")), worded).toEqual([]);
    }
    for (const only of ["Net sales are assumed to include all channels.", "Card fees are an assumed rate.", "Fulfilment is an assumed rate."]) {
      expect(failed(august, run(`EBITDA was $2,078.44. Operating costs were $625.00. ${only}`, "get_ebitda")), only).toEqual(["says card fees and fulfilment are assumed rates"]);
    }
  });
});

describe("the ad cut case", () => {
  const GOOD =
    "Cutting ad spend by 20% would raise EBITDA from $1,087.07 to $1,177.70 a month. This rests on an assumption: fewer ads lose new-customer orders in proportion at today's CAC, while returning-customer orders are left alone. " +
    "The price elasticity is an assumption too, and the default was used.";
  const CALL = { adSpendChange: -0.2 };

  it("passes an answer that explains the assumption, from a call that passed the cut as a fraction", () => {
    expect(failed(adsCut, run(GOOD, "get_ebitda_scenario", CALL))).toEqual([]);
    // A first call with -20 is rejected by the tool; a second with -0.2 is what counts.
    const retried: EvalRun = { ...run(GOOD, "get_ebitda_scenario", { adSpendChange: -20 }), toolCalls: [{ tool: "get_ebitda_scenario", input: { adSpendChange: -20 } }, { tool: "get_ebitda_scenario", input: CALL }] };
    expect(failed(adsCut, retried)).toEqual([]);
  });

  it("fails an answer that never says it is an assumption or loses new-customer orders", () => {
    expect(failed(adsCut, run("Cutting ad spend by 20% would raise EBITDA from $1,087.07 to $1,177.70 a month.", "get_ebitda_scenario", CALL))).toEqual([
      "says fewer ads lose new-customer orders, or that this is an assumption",
    ]);
  });

  it("fails an answer that calls the cut free", () => {
    for (const claim of [
      "The cut costs nothing.",
      "It costs you nothing to do this.",
      "This is money for free.",
      "It is free money.",
      "You can cut 20% with no impact on sales.",
      "There is no effect on orders, so it is a pure saving.",
      "You keep every order without losing any customers.",
      "You get the saving for free.",
      "There is no downside.",
    ]) {
      expect(failed(adsCut, run(`${GOOD} ${claim}`, "get_ebitda_scenario", CALL)), claim).toEqual(["does not call the cut free"]);
    }
  });

  it("does not take a true statement for a claim that the cut is free", () => {
    for (const fair of [
      "There is no impact on returning-customer orders, by that assumption.",
      "Operating costs have no effect on this: they stay the same.",
      "The cut is not free: it loses 28 orders.",
      "That is not free money; you lose new-customer orders.",
      "Nothing comes for free here: the cut loses orders.",
      "It isn't a pure saving, because new-customer orders fall.",
      "No change to operating costs.",
      "You do not lose returning customers.",
    ]) {
      expect(failed(adsCut, run(`${GOOD} ${fair}`, "get_ebitda_scenario", CALL)), fair).toEqual([]);
    }
  });

  it("fails a call that passed the cut as 20, or no cut at all, or used another tool", () => {
    expect(failed(adsCut, run(GOOD, "get_ebitda_scenario", { adSpendChange: -20 }))).toEqual(["passed the 20% cut as a fraction (adSpendChange -0.2)"]);
    expect(failed(adsCut, run(GOOD, "get_ebitda_scenario", { priceChange: -0.2 }))).toEqual(["passed the 20% cut as a fraction (adSpendChange -0.2)"]);
    expect(failed(adsCut, run(GOOD, "get_ebitda_scenario", null))).toEqual(["passed the 20% cut as a fraction (adSpendChange -0.2)"]);
    expect(failed(adsCut, run(GOOD, "get_ebitda", CALL))).toEqual(["called get_ebitda_scenario", "passed the 20% cut as a fraction (adSpendChange -0.2)"]);
  });
});
