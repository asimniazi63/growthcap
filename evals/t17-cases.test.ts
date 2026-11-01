import { describe, expect, it } from "vitest";
import { TOOL_DEFS } from "../lib/agent/tools";
import { CASES, type EvalEnv } from "./cases";
import { grade, type EvalRun } from "./graders";
import { AFTER_PERIOD, CLAIMS_PROOF, EXTRA_IN_DOLLARS, MANY_FIRST_TIME, NET_OR_PULLED_IN_DOLLARS, RAW_FRACTION_RATE, T17_CASES, TWO_REPEAT_RATES } from "./t17-cases";

// The promo post-mortem cases are never run here (they cost money). This checks that they are registered with unique ids, that
// the tool they expect exists, that a good write-up passes each one, and that a write-up that leaves out the comparison, claims
// proof, or writes a raw fraction fails. The sample answers use made-up figures: the patterns check wording, not the real numbers.

const env = { store: "solenne" } as EvalEnv;
const vip = T17_CASES.find((c) => c.id === "postmortem-vipglow25")!;
const bfcm = T17_CASES.find((c) => c.id === "postmortem-bfcm25")!;

const run = (answer: string, input: unknown, tool = "get_promo_postmortem"): EvalRun => ({
  answer,
  toolCalls: [{ tool, input }],
  views: [],
  verification: { ok: true, unmatched: [] },
});
const failed = (c: (typeof T17_CASES)[number], r: EvalRun) => grade(r, c.expect(env)).filter((k) => !k.ok).map((k) => k.name);

const VIP_INPUT = { code: "VIPGLOW25", from: "2026-08-01", to: "2026-08-31" };
const BFCM_INPUT = { code: "BFCM25", repeatWindowDays: 180 };

const VIP_GOOD =
  "VIPGLOW25 brought in a lot of first-time buyers: most of its orders in the window were first orders. The code added $1,200.00 of extra net sales above the baseline, but $300.00 of that was pulled forward from the days after, so the net lift was $900.00. " +
  "The quality of those customers is the weak spot: 8.0% of the VIPGLOW25 first-time buyers ordered again within 30 days, against 24.0% of other first-time buyers, so they came back far less often. " +
  "The data shows the pattern but does not prove the code caused it.";

const BFCM_GOOD =
  "Orders spiked during the promotion: BFCM25 brought 36 orders in four days. The weekend added $2,400.00 of extra net sales above the baseline. In the two weeks after, there was no dip: $0.00 was pulled forward, so the net lift was $2,400.00. " +
  "The customers are the weaker part. Within 180 days, 6.0% of the BFCM25 customers ordered again, against 19.0% of the comparison customers, a lower repeat rate. This does not prove the discount caused it.";

describe("the promo post-mortem eval cases (T17)", () => {
  it("are two Solenne cases with unique ids, registered with the others", () => {
    expect(T17_CASES.map((c) => c.id)).toEqual(["postmortem-vipglow25", "postmortem-bfcm25"]);
    for (const c of T17_CASES) {
      expect(c).toMatchObject({ category: "promo", store: "solenne" });
      expect(CASES).toContain(c);
      expect(CASES.filter((x) => x.id === c.id)).toHaveLength(1);
      expect(Number.isNaN(Date.parse(c.now))).toBe(false);
    }
    const ids = CASES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("pin the clock the sibling cases use: the VIPGLOW25 storyline's, and the playbooks' for last Black Friday", () => {
    const sibling = CASES.find((c) => c.id === "storyline-s6-vipglow25")!;
    expect(vip.now).toBe(sibling.now);
    expect(bfcm.now).toBe("2026-11-02T12:00:00-05:00");
  });

  it("ask the question for their promotion, and expect a tool that exists", () => {
    expect(vip.question).toMatch(/VIPGLOW25.*August/);
    expect(bfcm.question).toMatch(/25% Black Friday/);
    for (const c of T17_CASES) {
      const e = c.expect(env);
      expect(e.tools).toEqual(["get_promo_postmortem"]);
      expect(e.verified).toBe(true);
      for (const t of e.tools ?? []) expect(Object.keys(TOOL_DEFS), `${c.id} expects ${t}`).toContain(t);
      for (const w of e.toolWhere ?? []) expect(Object.keys(TOOL_DEFS), `${c.id} checks ${w.tool}`).toContain(w.tool);
    }
  });

  it("VIPGLOW25 passes a write-up with the extra sales, the net lift and the repeat rates, and fails the weaker ones", () => {
    expect(failed(vip, run(VIP_GOOD, VIP_INPUT))).toEqual([]);

    // The tool was not called, or not for this code, or for the code's whole life instead of August.
    expect(failed(vip, run(VIP_GOOD, VIP_INPUT, "query_metric"))).toEqual(["called get_promo_postmortem", "ran the post-mortem on the VIPGLOW25 code", "gave the August window (from and to) rather than the code's whole life"]);
    expect(failed(vip, run(VIP_GOOD, { code: "BFCM25", from: "2026-08-01", to: "2026-08-31" }))).toEqual(["ran the post-mortem on the VIPGLOW25 code"]);
    expect(failed(vip, run(VIP_GOOD, { code: "VIPGLOW25" }))).toEqual(["gave the August window (from and to) rather than the code's whole life"]);
    expect(failed(vip, run(VIP_GOOD, { code: "VIPGLOW25", from: "2026-03-02", to: "2026-10-29" }))).toEqual(["gave the August window (from and to) rather than the code's whole life"]);

    // No customer-quality comparison at all.
    const noRepeat = "VIPGLOW25 brought in many first-time buyers. The code added $1,200.00 of extra net sales above the baseline, and the net lift after the dip was $900.00.";
    expect(failed(vip, run(noRepeat, VIP_INPUT))).toEqual([
      "gives two repeat rates as percentages (the code's buyers and the comparison)",
      "says the code's first-time buyers came back less often",
    ]);

    // The repeat rates, but no dollars for the lift.
    const noDollars = VIP_GOOD.replace(/\$[\d,.]+/g, "a small amount");
    expect(failed(vip, run(noDollars, VIP_INPUT))).toEqual(["gives the extra sales above the baseline in dollars", "gives the net lift or the sales pulled forward in dollars"]);
  });

  it("both fail an answer that claims proof of a cause, and one that writes a raw fraction", () => {
    const proves = VIP_GOOD.replace("The data shows the pattern but does not prove the code caused it.", "This proves the leak caused the low repeat rate.");
    expect(failed(vip, run(proves, VIP_INPUT))).toEqual(["does not claim the numbers prove the code caused the result"]);
    expect(failed(bfcm, run(BFCM_GOOD.replace("This does not prove the discount caused it.", "This conclusively proves the discount brought in one-time buyers."), BFCM_INPUT))).toEqual(["does not claim the numbers prove the code caused the result"]);

    const fraction = VIP_GOOD.replace("8.0%", "0.0801").replace("24.0%", "0.2399");
    expect(failed(vip, run(fraction, VIP_INPUT))).toContain("writes repeat rates as percentages, not raw fractions");
  });

  it("the proof pattern lets the usual hedges through", () => {
    for (const hedge of [
      "That does not prove the code caused it.",
      "It doesn't prove the leak is the reason.",
      "This can't prove the discount caused the drop.",
      "There is no proof the code drove it.",
      "It does not necessarily prove the promotion brought them.",
      "It suggests, but cannot prove, that the code caused it.",
    ])
      expect(CLAIMS_PROOF.test(hedge), hedge).toBe(false);
    for (const claim of ["This proves the code caused it.", "The numbers prove that the leak drove the drop.", "That is definitely because of the leak."]) expect(CLAIMS_PROOF.test(claim), claim).toBe(true);
    expect(RAW_FRACTION_RATE.test("The repeat rate was 0.2224.")).toBe(true);
    expect(RAW_FRACTION_RATE.test("The repeat rate was 22.2%, against 10.25% for the rest.")).toBe(false);
    expect(RAW_FRACTION_RATE.test("The repeat rate was 0.25%.")).toBe(false);
  });

  it("the wording patterns take the usual phrasings, in a sentence or a table", () => {
    for (const s of ["20 first-time buyers used it.", "20 of its 25 orders were first orders.", "Most of its buyers were new customers.", "Over half of the orders came from first-time customers."])
      expect(MANY_FIRST_TIME.test(s), s).toBe(true);
    expect(MANY_FIRST_TIME.test("Existing customers used it.")).toBe(false);
    for (const s of ["Nothing was pulled forward.", "There was no dip in the days after.", "Orders after the weekend were lower.", "No sales were pulled forward from later.", "It did not cause a drop afterwards."])
      expect(AFTER_PERIOD.test(s), s).toBe(true);
    expect(AFTER_PERIOD.test("The promotion added $2,400.00 of extra net sales.")).toBe(false);
    expect(TWO_REPEAT_RATES.test("| Cohort | Repeat rate (180 days) |\n| BFCM25 | 11.5% |\n| Comparison | 42.5% |")).toBe(true);
    expect(TWO_REPEAT_RATES.test("Only 5.0% of them ordered again within 30 days, against 10.9% of other first-time buyers.")).toBe(true);
    expect(TWO_REPEAT_RATES.test("Their repeat rate was 5.0%.")).toBe(false);
    expect(EXTRA_IN_DOLLARS.test("It added $1,310.00 of extra net sales.")).toBe(true);
    expect(EXTRA_IN_DOLLARS.test("Net sales in the window were $9,026.00.")).toBe(false);
    expect(NET_OR_PULLED_IN_DOLLARS.test("The net lift was $640.00.")).toBe(true);
    expect(NET_OR_PULLED_IN_DOLLARS.test("$683.00 of sales were pulled forward from September.")).toBe(true);
  });

  it("BFCM25 passes a write-up with the spike, the after period, the net lift and the 180-day repeat rates", () => {
    expect(failed(bfcm, run(BFCM_GOOD, BFCM_INPUT))).toEqual([]);

    // A dip is fine too, and the code can be given as dates instead.
    const withDip = BFCM_GOOD.replace("there was no dip: $0.00 was pulled forward, so the net lift was $2,400.00", "daily orders dipped, and $400.00 was pulled forward, so the net lift was $2,000.00");
    expect(failed(bfcm, run(withDip, { from: "2025-11-28", to: "2025-12-01", repeatWindowDays: 180 }))).toEqual([]);
  });

  it("BFCM25 fails when the repeat window was left at 30 days, or the customers are not compared", () => {
    expect(failed(bfcm, run(BFCM_GOOD, { code: "BFCM25" }))).toEqual(["asked for the 180-day repeat window"]);
    expect(failed(bfcm, run(BFCM_GOOD, { code: "VIPGLOW25", repeatWindowDays: 180 }))).toEqual(["ran the post-mortem on BFCM25 or the Black Friday 2025 dates"]);

    const noCustomers = "Orders spiked during the promotion. The weekend added $2,400.00 of extra net sales above the baseline. In the two weeks after, daily orders dipped, so the net lift was $2,000.00.";
    expect(failed(bfcm, run(noCustomers, BFCM_INPUT))).toEqual([
      "gives two repeat rates as percentages (the promotion's customers and the comparison)",
      "says the promotion's customers came back less often",
    ]);

    const noAfter = "Orders spiked during the promotion: BFCM25 brought 36 orders. The weekend added $2,400.00 of extra net sales above the baseline, a net lift of $2,400.00. Within 180 days, 6.0% of the BFCM25 customers ordered again, against 19.0% of the comparison customers, a lower repeat rate.";
    expect(failed(bfcm, run(noAfter, BFCM_INPUT))).toEqual(["says what happened after the promotion (a dip, sales pulled forward, or no dip)"]);
  });
});
