import { describe, expect, it } from "vitest";
import { TOOL_DEFS } from "../lib/agent/tools";
import { readFixture } from "../scripts/fixtures/load-db";
import { CASES, type EvalEnv } from "./cases";
import { grade, type EvalRun } from "./graders";
import {
  AFTER_PERIOD,
  AT_RISK_COUNT,
  BASED_ON_PAST_ORDERS,
  CLAIMS_CONTACTED,
  CLAIMS_PROOF,
  CLAIMS_PUBLISH_DATE,
  CLAIMS_STRONG_LAUNCH,
  CLAIMS_WILL_BUY,
  CLAIMS_WILL_CHURN,
  datePattern,
  EXTRA_IN_DOLLARS,
  firstWeekOf,
  IDS_NOT_NAMES,
  LAUNCH_IS_FIRST_SALE,
  LIFT,
  LTV_IN_DOLLARS,
  MANY_FIRST_TIME,
  mostFrequentPairs,
  NET_OR_PULLED_IN_DOLLARS,
  ORDERS_TOGETHER,
  RAW_FRACTION_CHURN,
  RAW_FRACTION_MEDIAN,
  RAW_FRACTION_RATE,
  RULE_NOT_PREDICTION,
  SHARE_OR_DAYS,
  T17_CASES,
  TOGETHER_AS_PERCENT,
  TWO_REPEAT_RATES,
  twoProductNames,
  VS_MEDIAN_LAUNCH,
  WEEK_ONE_UNITS,
} from "./t17-cases";

// The T17 cases are never run here (they cost money). This checks that they are registered with unique ids, that the tool
// they expect exists, that a good write-up passes each one, and that a write-up that leaves out the comparison, claims proof,
// or writes a raw fraction fails. The sample answers use made-up figures: the patterns check wording, not the real numbers.

const { dataset, truth } = readFixture("solenne");
const env = { store: "solenne", dataset, truth } as EvalEnv;
const vip = T17_CASES.find((c) => c.id === "postmortem-vipglow25")!;
const bfcm = T17_CASES.find((c) => c.id === "postmortem-bfcm25")!;
const atRisk = T17_CASES.find((c) => c.id === "segments-at-risk")!;
const bundles = T17_CASES.find((c) => c.id === "bundles-bought-together")!;
const launch = T17_CASES.find((c) => c.id === "launch-curve-gua-sha")!;

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
  it("are Solenne cases with unique ids, registered with the others", () => {
    expect(T17_CASES.map((c) => c.id)).toEqual(["postmortem-vipglow25", "postmortem-bfcm25", "segments-at-risk", "bundles-bought-together", "launch-curve-gua-sha"]);
    expect(T17_CASES.map((c) => c.category)).toEqual(["promo", "promo", "retention", "merchandising", "merchandising"]);
    for (const c of T17_CASES) {
      expect(c).toMatchObject({ store: "solenne" });
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
    for (const c of [vip, bfcm]) {
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

// ---- slice 2: the segments and bundles cases. The same idea: a good write-up passes, and each weaker one fails only the check it should.

const SEG_INPUT = { segment: "at_risk" };
const segRun = (answer: string, input: unknown = SEG_INPUT, tool = "get_customer_segments") => run(answer, input, tool);
const bundleRun = (answer: string, input: unknown = {}, tool = "get_bundle_candidates") => run(answer, input, tool);

const SEG_GOOD =
  "Customers here are pseudonymous ids, so there are no names or emails. 148 customers are at risk, which is 23.6% of all customers. Their average lifetime value is $187.40, and it has been 214 days on average since their last order. " +
  "At risk is a rule, not a prediction: two or more orders, but nothing in the last 90 days. The biggest by lifetime value are CUST_1a2b3c4d ($642.00) and CUST_5e6f7a8b ($590.00).";

const BUNDLE_GOOD =
  "Hero Vitamin C Serum and Barrier Cream are bought together most often: 70 orders had both, which is 6.8% of all orders and 24.6% of the orders with Barrier Cream. Their lift is 0.71x, so they sit together slightly less often than chance would suggest, mostly because both are bestsellers. " +
  "The pair with the highest lift is Daily Gel Cleanser and Barrier Cream Mini (lift 1.86x), but it appears in only 5 orders, so it is a thin signal. This is an association in past orders, not proof that customers would buy a bundle.";

describe("the segment and bundle eval cases (T17, slice 2)", () => {
  it("pin the playbooks' clock, ask the plain question, and expect tools that exist", () => {
    expect(atRisk.now).toBe("2026-11-02T12:00:00-05:00");
    expect(bundles.now).toBe("2026-11-02T12:00:00-05:00");
    expect(launch.now).toBe("2026-11-02T12:00:00-05:00");
    expect(launch.question).toBe("How did the Gua Sha Stone launch go?");
    expect(atRisk.question).toBe("Which customers are at risk?");
    expect(bundles.question).toBe("Which products are bought together most often?");
    for (const [c, tool] of [
      [atRisk, "get_customer_segments"],
      [bundles, "get_bundle_candidates"],
      [launch, "get_launch_curves"],
    ] as const) {
      const e = c.expect(env);
      expect(e.tools).toEqual([tool]);
      expect(e.verified).toBe(true);
      for (const t of e.tools ?? []) expect(Object.keys(TOOL_DEFS), `${c.id} expects ${t}`).toContain(t);
      for (const w of e.toolWhere ?? []) expect(Object.keys(TOOL_DEFS), `${c.id} checks ${w.tool}`).toContain(w.tool);
    }
  });

  it("at-risk passes a write-up with the count, the share, the lifetime value and the rule, and fails the weaker ones", () => {
    expect(failed(atRisk, segRun(SEG_GOOD))).toEqual([]);
    // A summary call first and then a filtered list, or a list view, both count.
    const twoCalls: EvalRun = {
      ...segRun(SEG_GOOD),
      toolCalls: [
        { tool: "get_customer_segments", input: {} },
        { tool: "get_customer_segments", input: { view: "list", segment: "at_risk" } },
      ],
    };
    expect(failed(atRisk, twoCalls)).toEqual([]);
    expect(failed(atRisk, segRun(SEG_GOOD, { view: "list" }))).toEqual([]);
    // The summary view alone is a right answer (the first live run did exactly that): it holds the at-risk row.
    expect(failed(atRisk, segRun(SEG_GOOD, {}))).toEqual([]);
    expect(failed(atRisk, segRun(SEG_GOOD, { view: "summary" }))).toEqual([]);

    // The tool was not called, or only for another segment.
    expect(failed(atRisk, segRun(SEG_GOOD, SEG_INPUT, "query_metric"))).toEqual(["called get_customer_segments", "did not narrow the call to another segment"]);
    expect(failed(atRisk, segRun(SEG_GOOD, { segment: "champions" }))).toEqual(["did not narrow the call to another segment"]);

    // Each piece left out fails its own check.
    const noCount = "Customers are pseudonymous ids, so there are no names. Some are at risk. Their average lifetime value is $187.40, and it has been 214 days on average since their last order. At risk is a rule, not a prediction.";
    expect(failed(atRisk, segRun(noCount))).toEqual(["says how many customers are at risk"]);
    const noShareOrDays = SEG_GOOD.replace("which is 23.6% of all customers", "which is a fair number").replace(", and it has been 214 days on average since their last order", "");
    expect(failed(atRisk, segRun(noShareOrDays))).toEqual(["gives their share of customers as a percentage, or the average days since their last order"]);
    expect(failed(atRisk, segRun(SEG_GOOD.replace("$187.40", "a fair amount").replace(" ($642.00)", "").replace(" ($590.00)", "")))).toEqual(["gives their lifetime value in dollars"]);
    const noRule = SEG_GOOD.replace("At risk is a rule, not a prediction: two or more orders, but nothing in the last 90 days.", "These are the customers to watch.");
    expect(failed(atRisk, segRun(noRule))).toEqual(["explains at risk as a rule on days since the last order, not a prediction"]);
  });

  it("at-risk fails an answer that claims to have contacted anyone, says they will leave, or writes the churn risk as a raw fraction", () => {
    expect(failed(atRisk, segRun(`${SEG_GOOD} I have emailed them a win-back offer.`))).toEqual(["does not claim to have contacted anyone"]);
    expect(failed(atRisk, segRun(`${SEG_GOOD} These customers will probably churn.`))).toEqual(["does not say customers will leave"]);
    expect(failed(atRisk, segRun(`${SEG_GOOD} Their average churn risk is 0.8213.`))).toEqual(["writes churn risk and shares as percentages, not raw fractions"]);
  });

  it("the at-risk patterns take the usual phrasings, in a sentence or a table", () => {
    for (const s of ["148 customers are at risk.", "There are 148 at-risk customers.", "At risk: 148 customers.", "| At risk | 148 | 23.6% |", "The at risk group is 1,148 customers."]) expect(AT_RISK_COUNT.test(s), s).toBe(true);
    expect(AT_RISK_COUNT.test("At risk means 2 or more orders and nothing in 90 days.")).toBe(false);
    expect(AT_RISK_COUNT.test("There are 148 customers in all.")).toBe(false);
    for (const s of ["They are 23.6% of all customers.", "Their share is 23.6%.", "They averaged 214 days since their last order.", "On average it has been 214.5 days."]) expect(SHARE_OR_DAYS.test(s), s).toBe(true);
    expect(SHARE_OR_DAYS.test("There are 148 customers at risk.")).toBe(false);
    for (const s of ["Average lifetime value: $187.40.", "They have spent $4,200.00 in total.", "| Avg LTV | $187.40 |"]) expect(LTV_IN_DOLLARS.test(s), s).toBe(true);
    expect(LTV_IN_DOLLARS.test("There are 148 customers.")).toBe(false);
    for (const s of ["CUST_1a2b3c4d is the biggest.", "They are pseudonymised ids.", "I have no names for them.", "The data holds customer ids only.", "There are no emails in the data."]) expect(IDS_NOT_NAMES.test(s), s).toBe(true);
    expect(IDS_NOT_NAMES.test("The biggest is Jane Smith, who spent $642.00.")).toBe(false);
    for (const s of ["It is a heuristic, not a forecast.", "They have not ordered in longer than their usual gap between orders.", "It looks at days since their last order.", "A simple rule of thumb."]) expect(RULE_NOT_PREDICTION.test(s), s).toBe(true);
    expect(RULE_NOT_PREDICTION.test("These customers are in trouble.")).toBe(false);
    for (const s of ["Churn risk is 0.82 for the top customers.", "A score of 0.8213 for churn risk.", "Their share is 0.236."]) expect(RAW_FRACTION_CHURN.test(s), s).toBe(true);
    expect(RAW_FRACTION_CHURN.test("Churn risk is 82% for the top customers.")).toBe(false);
    for (const s of ["I emailed the top ten.", "We've contacted them already.", "A discount was sent to each of them.", "I sent them an offer."]) expect(CLAIMS_CONTACTED.test(s), s).toBe(true);
    for (const s of ["I have not emailed anyone.", "I can't contact them.", "You could email them a win-back offer.", "I did not send anything."]) expect(CLAIMS_CONTACTED.test(s), s).toBe(false);
    for (const s of ["They will churn.", "These customers are going to leave soon.", "They will probably stop buying."]) expect(CLAIMS_WILL_CHURN.test(s), s).toBe(true);
    for (const s of ["They may churn.", "They are at risk of leaving.", "They have not ordered in 90 days."]) expect(CLAIMS_WILL_CHURN.test(s), s).toBe(false);
  });

  it("bundles passes a write-up with the pair, its count, its share, the lift and the hedge, and fails the weaker ones", () => {
    expect(failed(bundles, bundleRun(BUNDLE_GOOD))).toEqual([]);
    expect(failed(bundles, bundleRun(BUNDLE_GOOD, { limit: 5, minOrders: 5 }))).toEqual([]);
    expect(failed(bundles, bundleRun(BUNDLE_GOOD, {}, "query_metric"))).toEqual(["called get_bundle_candidates"]);

    const noNames = BUNDLE_GOOD.replaceAll("Hero Vitamin C Serum", "The first product").replaceAll("Barrier Cream", "the second").replaceAll("Daily Gel Cleanser", "the third");
    expect(failed(bundles, bundleRun(noNames))).toEqual(["names two products as a pair", "names the pair that is in the most orders"]);
    const onlyOne = "Hero Vitamin C Serum is the one most often bought with something else. It is 24.6% of the orders, a lift of 0.7x. This is an association in past orders.";
    expect(failed(bundles, bundleRun(onlyOne))).toEqual(["states the orders that held the most frequent pair", "names two products as a pair", "names the pair that is in the most orders", "says how many orders held the pair"]);

    // The tool ranks by lift, so the pair on top can be a thin one. An answer that leaves out the pair in the most orders fails on it,
    // even when everything else is written well.
    const thinPair =
      "Daily Gel Cleanser and Barrier Cream Mini are bought together in 5 orders, a lift of 1.9x. The next is Hero Vitamin C Serum and Gift Set Deluxe, in 10 orders (6.3% of the Gift Set Deluxe orders, lift 1.1x). This is an association in past orders, not proof of demand.";
    expect(failed(bundles, bundleRun(thinPair))).toEqual(["states the orders that held the most frequent pair", "names the pair that is in the most orders"]);
    expect(failed(bundles, bundleRun(BUNDLE_GOOD.replaceAll(/\d+\.\d%/g, "a good share")))).toEqual(["gives how often they are bought together as a percentage"]);
    expect(failed(bundles, bundleRun(BUNDLE_GOOD.replace(" Their lift is 0.71x, so they sit", " They sit").replace(" (lift 1.86x)", "")))).toEqual(["gives the lift"]);
    expect(failed(bundles, bundleRun(BUNDLE_GOOD.replace(" This is an association in past orders, not proof that customers would buy a bundle.", "")))).toEqual(["says it rests on past orders, or is not proof"]);
  });

  it("the most frequent pair is counted from the dataset: Hero Vitamin C Serum with Barrier Cream, in 70 orders", () => {
    expect(mostFrequentPairs(dataset)).toEqual({ count: 70, pairs: [["Hero Vitamin C Serum", "Barrier Cream"]] });
    expect(bundles.expect(env).numbers).toEqual([{ label: "the orders that held the most frequent pair", value: 70, tolerance: 0 }]);
  });

  it("bundles fails an answer that promises customers will buy, or says the numbers prove demand", () => {
    const promises = BUNDLE_GOOD.replace("This is an association in past orders, not proof that customers would buy a bundle.", "Customers who buy the serum will also buy the cream, so a bundle will sell. This is based on past orders.");
    expect(failed(bundles, bundleRun(promises))).toEqual(["does not say customers will buy, or that the numbers prove demand"]);
    const proves = BUNDLE_GOOD.replace("not proof that customers would buy a bundle.", "which proves customers want a bundle.");
    expect(failed(bundles, bundleRun(proves))).toEqual(["does not say customers will buy, or that the numbers prove demand"]);
    // The rare pair with the top lift is not a proven bundle.
    const proven = BUNDLE_GOOD.replace("so it is a thin signal", "but it is a proven bundle");
    expect(failed(bundles, bundleRun(proven))).toEqual(["does not say customers will buy, or that the numbers prove demand"]);
  });

  it("the bundle patterns take the usual phrasings, in a sentence or a table", () => {
    const names = twoProductNames(dataset.products.map((p) => p.title));
    for (const s of ["Barrier Cream and Hero Vitamin C Serum go together.", "Lip Tint with Daily Gel Cleanser.", "| Hero Vitamin C Serum | Oil Cleanser | 12 |"]) expect(names.test(s), s).toBe(true);
    for (const s of ["Hero Vitamin C Serum sells well.", "Hero Vitamin C Serum, and then the Hero Vitamin C Serum again.", "Gua Sha Stone is slow."]) expect(names.test(s), s).toBe(false);
    for (const s of ["Bought together in 70 orders.", "70 orders had both.", "They appeared together 70 times.", "| Pair | Orders together | Share |\n| A + B | 70 | 24.6% |"]) expect(ORDERS_TOGETHER.test(s), s).toBe(true);
    expect(ORDERS_TOGETHER.test("There were 1,024 orders in all.")).toBe(false);
    for (const s of ["24.6% of orders with Barrier Cream also had the serum.", "A confidence of 24.6%.", "Support is 6.8% of all orders.", "Bought together 12% of the time."]) expect(TOGETHER_AS_PERCENT.test(s), s).toBe(true);
    expect(TOGETHER_AS_PERCENT.test("Net sales were up 12%.")).toBe(false);
    for (const s of ["A lift of 1.9.", "Lift: 1.9x", "Their lift is 0.7x.", "| Pair | Lift |\n| A + B | 1.9x |", "1.9x as likely as chance.", "Seen with a 1.9x lift."]) expect(LIFT.test(s), s).toBe(true);
    expect(LIFT.test("They sat together in 70 orders.")).toBe(false);
    for (const s of ["Based on 1,024 past orders.", "It is only an association.", "That does not prove they will like a bundle.", "This is not a guarantee.", "From your historical orders."]) expect(BASED_ON_PAST_ORDERS.test(s), s).toBe(true);
    expect(BASED_ON_PAST_ORDERS.test("Hero Vitamin C Serum and Barrier Cream were in 70 orders.")).toBe(false);
    for (const s of ["Customers will buy both.", "Shoppers who buy the serum will also buy the cream.", "That proves customers want a bundle.", "It guarantees sales.", "It is a proven bundle."]) expect(CLAIMS_WILL_BUY.test(s), s).toBe(true);
    for (const s of ["This is not proof customers want a bundle.", "It does not guarantee sales.", "It is not a guarantee that customers will like it.", "It is not a proven bundle.", "Customers bought both in 70 orders."]) expect(CLAIMS_WILL_BUY.test(s), s).toBe(false);
  });
});

const LAUNCH_INPUT = { weeks: 8 };
const launchRun = (answer: string, input: unknown = LAUNCH_INPUT, tool = "get_launch_curves") => run(answer, input, tool);

const LAUNCH_GOOD =
  "The data has no publish date for the Gua Sha Stone, so I count its first sale, on 14 November 2025, as its launch. In week 1 it sold 3 units, against a median launch of 1 unit, which is 300% of the median. " +
  "After that it sold 0, 1 and 0 units in weeks 2 to 4, and 5 units over eight weeks. These are very small numbers, so it is a slow seller with no ramp, and I would not read more into it.";

describe("the launch curve eval case (T17, slice 2)", () => {
  it("counts the Gua Sha Stone's first sale and first week from the dataset: 2025-11-14, 3 units", () => {
    expect(firstWeekOf(dataset, "Gua Sha Stone")).toEqual({ launchDate: "2025-11-14", units: 3 });
    expect(launch.expect(env).numbers).toEqual([{ label: "the units sold in its first week", value: 3, tolerance: 0 }]);
  });

  it("passes a write-up with the first sale, the first week and the median, and fails the weaker ones", () => {
    expect(failed(launch, launchRun(LAUNCH_GOOD))).toEqual([]);
    // The model may find the product first, and ask for it by id or for every launch.
    const searched: EvalRun = { ...launchRun(LAUNCH_GOOD), toolCalls: [{ tool: "search_products", input: { query: "Gua Sha" } }, { tool: "get_launch_curves", input: { productIds: ["gid://shopify/Product/26"], weeks: 4 } }] };
    expect(failed(launch, searched)).toEqual([]);
    expect(failed(launch, launchRun(LAUNCH_GOOD, {}, "query_metric"))).toEqual(["called get_launch_curves"]);

    expect(failed(launch, launchRun(LAUNCH_GOOD.replaceAll("Gua Sha Stone", "new product")))).toEqual(["names the Gua Sha Stone"]);
    expect(failed(launch, launchRun(LAUNCH_GOOD.replace("on 14 November 2025, ", "")))).toEqual(["gives the day of its first sale"]);
    const noFirstSale = LAUNCH_GOOD.replace("The data has no publish date for the Gua Sha Stone, so I count its first sale, on 14 November 2025, as its launch.", "The Gua Sha Stone was launched on 14 November 2025.");
    expect(failed(launch, launchRun(noFirstSale))).toEqual(["says the launch is the first sale, not a publish date"]);
    expect(failed(launch, launchRun(LAUNCH_GOOD.replace("In week 1 it sold 3 units", "It started slowly")))).toEqual(["states the units sold in its first week", "gives the units sold in the first week"]);
    expect(failed(launch, launchRun(LAUNCH_GOOD.replace(", against a median launch of 1 unit, which is 300% of the median", "")))).toEqual(["compares it with the median launch, as a percentage or a number of units"]);
  });

  it("fails an answer that calls it a strong launch, gives a publish date, or writes the share of the median as a raw fraction", () => {
    expect(failed(launch, launchRun(`${LAUNCH_GOOD} It was a strong launch.`))).toEqual(["does not call it a strong launch or describe a ramp"]);
    expect(failed(launch, launchRun(`${LAUNCH_GOOD} Sales took off after the first week.`))).toEqual(["does not call it a strong launch or describe a ramp"]);
    expect(failed(launch, launchRun(`${LAUNCH_GOOD} The stone was published on 14 November.`))).toEqual(["does not give a publish date"]);
    expect(failed(launch, launchRun(LAUNCH_GOOD.replace("300% of the median", "0.4521 of the median")))).toEqual(["writes the share of the median as a percentage, not a raw fraction"]);
  });

  it("the launch patterns take the usual phrasings, in a sentence or a table", () => {
    const day = datePattern("2025-11-14");
    for (const s of ["It first sold on 2025-11-14.", "On November 14 it sold.", "Nov 14th, 2025.", "On 14 November 2025.", "14th of November.", "Nov. 14"]) expect(day.test(s), s).toBe(true);
    for (const s of ["On November 15.", "On 4 November.", "November 140.", "On 2025-11-15."]) expect(day.test(s), s).toBe(false);
    for (const s of ["3 units in week 1.", "In its first week it sold 3 units.", "Week 1: 3 units", "It sold 3 units in the first seven days."]) expect(WEEK_ONE_UNITS.test(s), s).toBe(true);
    expect(WEEK_ONE_UNITS.test("It sold 3 units in week 3.")).toBe(false);
    for (const s of ["Its first sale was the launch.", "I count the first sale as the launch.", "There is no publish date in the data.", "The store does not have a publish date."]) expect(LAUNCH_IS_FIRST_SALE.test(s), s).toBe(true);
    expect(LAUNCH_IS_FIRST_SALE.test("The launch was on November 14.")).toBe(false);
    for (const s of ["The median launch sold 1 unit.", "That is 300% of the median.", "3 units more than the median.", "| Week | Units | Median |\n| 1 | 3 units | 1 unit |"]) expect(VS_MEDIAN_LAUNCH.test(s), s).toBe(true);
    expect(VS_MEDIAN_LAUNCH.test("It sold 3 units in week 1.")).toBe(false);
    for (const s of ["It was a strong launch.", "A great launch for a slow seller.", "The launch was a success.", "Sales ramped up quickly.", "It gained momentum."]) expect(CLAIMS_STRONG_LAUNCH.test(s), s).toBe(true);
    for (const s of ["It was not a strong launch.", "This was no big launch.", "It never ramped up.", "It didn't take off.", "The launch was small.", "There is no ramp to find."]) expect(CLAIMS_STRONG_LAUNCH.test(s), s).toBe(false);
    for (const s of ["It was published on 14 November.", "It went live on Nov 14.", "It was released in November."]) expect(CLAIMS_PUBLISH_DATE.test(s), s).toBe(true);
    for (const s of ["There is no publish date.", "It was not published on any date we know.", "Its first sale was on 14 November."]) expect(CLAIMS_PUBLISH_DATE.test(s), s).toBe(false);
    expect(RAW_FRACTION_MEDIAN.test("It sold 0.4521 of the median.")).toBe(true);
    expect(RAW_FRACTION_MEDIAN.test("It sold 45% of the median.")).toBe(false);
  });
});
