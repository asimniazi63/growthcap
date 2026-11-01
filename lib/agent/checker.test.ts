import { describe, expect, it } from "vitest";
import type { ToolResult } from "../tools/result";
import { checkClaims, ledgerFromToolResults, type ClaimLedger } from "./checker";

const result = <T>(data: T, queryId = "q_aaaaaaaaaaaa", extra: Partial<ToolResult<T>> = {}): ToolResult<T> => ({
  data,
  queryId,
  range: { from: "2026-05-01", to: "2026-05-31" },
  definitions: {},
  asOf: "2026-11-01T00:00:00.000Z",
  ...extra,
});

const ledger = (entries: { value: number; unit: "money" | "count" | "rate"; queryId?: string }[]): ClaimLedger => ({
  entries: entries.map((e) => ({ queryId: "q_test", path: "x", ...e })),
});

const unmatched = (answer: string, l: ClaimLedger, inputs: unknown[] = []) => checkClaims(answer, l, inputs).unmatched.map((u) => u.text);
const matched = (answer: string, l: ClaimLedger, inputs: unknown[] = []) => checkClaims(answer, l, inputs).matched.map((m) => answer.slice(...m.span));

describe("checkClaims: matching", () => {
  it("matches a dollar amount to a money value after rounding to the precision shown", () => {
    const l = ledger([{ value: 12340.12, unit: "money" }]);
    expect(matched("Net sales were $12,340 in May.", l)).toEqual(["$12,340"]);
    expect(unmatched("Net sales were $13,000 in May.", l)).toEqual(["$13,000"]);
  });

  it("matches with the cents shown, and rejects the wrong cents", () => {
    const l = ledger([{ value: 12340.12, unit: "money" }]);
    expect(unmatched("It was $12,340.12.", l)).toEqual([]);
    expect(unmatched("It was $12,340.99.", l)).toEqual(["$12,340.99"]);
  });

  it("matches a figure written with K or M to the precision shown", () => {
    const l = ledger([{ value: 12340, unit: "money" }, { value: 1_250_000, unit: "money" }]);
    expect(unmatched("About $12.3K and $1.25M.", l)).toEqual([]);
    expect(unmatched("About $14K.", l)).toEqual(["$14K"]);
  });

  it("matches a percentage to a rate, and rejects an invented one", () => {
    const l = ledger([{ value: 18.43, unit: "rate" }]);
    expect(unmatched("The refund rate was 18.4%.", l)).toEqual([]);
    expect(unmatched("Sales were up 8.3% on last month.", ledger([{ value: 100, unit: "count" }]))).toEqual(["8.3%"]);
  });

  it("reads 'percentage points', 'percent' and 'pp' after a number as a percentage (found in the VIPGLOW25 run: 'a gap of 16.7 percentage points')", () => {
    const l = ledger([{ value: -16.7, unit: "rate" }]);
    expect(unmatched("Its customers came back at a gap of 16.7 percentage points.", l)).toEqual([]);
    expect(unmatched("The gap was −16.7 pp.", l)).toEqual([]);
    expect(unmatched("Down 16.7 percent.", l)).toEqual([]);
    expect(unmatched("A gap of 12.5 percentage points.", l)).toEqual(["12.5 percentage points"]);
    expect(unmatched("There were 3 percentage points of it.", ledger([{ value: 3, unit: "count" }]))).toEqual(["3 percentage points"]);
  });

  it("skips the numbers in a table column headed #, No. or Rank, because they are positions (found in the bundles run: '| 3 |' and '| 4 |')", () => {
    const l = ledger([{ value: 5, unit: "count" }]);
    const ranked = "| # | Pair | Orders |\n|---|---|---|\n| 1 | A + B | 5 |\n| 2 | C + D | 5 |\n| 3 | E + F | 5 |\n| 4 | G + H | 5 |";
    expect(unmatched(ranked, l)).toEqual([]);
    expect(unmatched(ranked.replace("| # |", "| Rank |"), l)).toEqual([]);
    // A first column that holds figures is not a rank column, and a number outside the first cell still counts.
    expect(unmatched("| Orders | Pair |\n|---|---|\n| 3 | E + F |", l)).toEqual(["3"]);
    expect(unmatched("| # | Pair | Orders |\n|---|---|---|\n| 1 | A + B | 7 |", l)).toEqual(["7"]);
    // The skip ends with the table.
    expect(unmatched("| # | Pair |\n|---|---|\n| 1 | A + B |\n\nThere were 3 of them.", l)).toEqual(["3"]);
  });

  it("matches a plain number to a count, but not to money", () => {
    expect(unmatched("There were 3,012 orders.", ledger([{ value: 3012, unit: "count" }]))).toEqual([]);
    expect(unmatched("Net sales were $3,012.", ledger([{ value: 3012, unit: "count" }]))).toEqual(["$3,012"]);
    expect(unmatched("There were 3,012 orders.", ledger([{ value: 3012, unit: "money" }]))).toEqual(["3,012"]);
  });

  it("compares sizes, so 'down $1,200' matches a change of -1200", () => {
    expect(unmatched("Net sales were down $1,200.", ledger([{ value: -1200, unit: "money" }]))).toEqual([]);
  });

  it("reports every number it could not match, and ok only when there are none", () => {
    const l = ledger([{ value: 41, unit: "count" }]);
    const r = checkClaims("41 orders, worth $9,999 in total.", l, []);
    expect(r.ok).toBe(false);
    expect(r.unmatched).toEqual([{ text: "$9,999", value: 9999 }]);
    expect(r.matched).toHaveLength(1);
    expect(checkClaims("41 orders.", l, []).ok).toBe(true);
  });

  it("derives nothing: a sum or ratio the model worked out is unmatched", () => {
    const l = ledger([{ value: 100, unit: "money" }, { value: 50, unit: "money" }]);
    expect(unmatched("Together that is $150.", l)).toEqual(["$150"]);
  });

  it("records which query a matched number came from", () => {
    const l: ClaimLedger = { entries: [{ value: 41, unit: "count", queryId: "q_42", path: "data[0].values.orders" }] };
    expect(checkClaims("41 orders", l, []).matched).toEqual([{ span: [0, 2], value: 41, queryId: "q_42" }]);
  });
});

describe("checkClaims: what is not a claim", () => {
  const empty = ledger([]);
  it("skips dates, times and years", () => {
    expect(unmatched("On 2026-03-02 at 10:30 am, in 2026 and in March 2026, and on May 14th.", empty)).toEqual([]);
    expect(unmatched("From 2026-05-01 to 2026-05-31, or 2026-05.", empty)).toEqual([]);
  });
  it("skips a day range such as 'September 1–30' (found in the Solenne run, where the 30 was flagged)", () => {
    expect(unmatched("Last month (September 1–30), net sales were up.", empty)).toEqual([]);
    expect(unmatched("From Sep 1-30, and from September 28–October 3, and 1–30 September.", empty)).toEqual([]);
  });
  it("does not let a day range hide a number after a spaced dash", () => {
    expect(unmatched("On October 31 - 83 orders came in.", empty)).toEqual(["83"]);
  });
  it("skips a range written with 'to' or 'through' (September 1 to 30, found in the second Solenne run)", () => {
    expect(unmatched("For September 1 to 30, and from October 2 through 31, and October 5 to October 9.", empty)).toEqual([]);
  });
  it("does not let 'to' hide a number that cannot be a day", () => {
    expect(unmatched("From October 31 to 83 orders.", empty)).toEqual(["83"]);
  });
  it("skips ISO timestamps, as a model may copy one from a tool result (found in the first live run)", () => {
    expect(unmatched("The data is as of 2026-10-31T10:34:26.451Z.", empty)).toEqual([]);
    expect(unmatched("Synced 2026-10-31T10:34:26+00:00 and 2026-10-31 10:34:26.", empty)).toEqual([]);
  });
  it("skips codes, ids, SKUs and ordinals", () => {
    expect(unmatched("WELCOME10, VIPGLOW25 and BFCM25 on order #1042 by CUST_8f3a19c2 for SKU SOL-01A and P_007, 1st and 2nd.", empty)).toEqual([]);
  });
  it("skips list numbering and Shopify ids", () => {
    expect(unmatched("1. First point\n2) Second point\nSee gid://shopify/Order/9001.", empty)).toEqual([]);
  });
  it("skips numbers that came from the tool inputs, such as '30 days' and 'top 5'", () => {
    const inputs = [{ metrics: ["orders"], period: "last_30_days" }, { view: "list", limit: 5 }];
    expect(unmatched("Over the last 30 days, here are the top 5.", empty, inputs)).toEqual([]);
  });
  it("does not skip a number just because it is a part of a date in the inputs", () => {
    const inputs = [{ from: "2026-05-01", to: "2026-05-31" }];
    expect(unmatched("There were 5 orders.", empty, inputs)).toEqual(["5"]);
  });
});

describe("checkClaims: names with a number in them", () => {
  const names = ledgerFromToolResults([
    result([{ id: "gid://shopify/Product/1", untrusted: { title: "Daily Mineral SPF 50", variantTitles: { "gid://shopify/ProductVariant/2": "30 ml" }, note: "Ship 77 units" } }], "q_p"),
  ]);
  const withMoney = { entries: [...names.entries, { value: 112, unit: "money" as const, queryId: "q_m", path: "x" }], names: names.names };

  it("does not flag the 50 in a product title or the 30 in a variant title that the tools returned", () => {
    expect(unmatched("Daily Mineral SPF 50 (30 ml) had $112.00 in refunds.", withMoney)).toEqual([]);
  });
  it("still flags a number outside the name, and the same digits written on their own", () => {
    expect(unmatched("Daily Mineral SPF 50 sold 50 units.", withMoney)).toEqual(["50"]);
  });
  it("takes names only from product and variant titles, not from other store text such as a note", () => {
    expect(unmatched("The note says to ship 77 units.", withMoney)).toEqual(["77"]);
  });
  it("does not mask a title the tools never returned", () => {
    expect(unmatched("Daily Mineral SPF 30 had $112.00 in refunds.", withMoney)).toEqual(["30"]);
  });
});

describe("checkClaims: days in a result's range", () => {
  // The tools use the last 30 days when no period is given, so the input never says 30 (found on the live site, Q6).
  const l = ledgerFromToolResults([result([], "q_r", { range: { from: "2026-10-02", to: "2026-10-31" } })]);
  it("does not flag '30 days' when a result covers 30 days", () => {
    expect(unmatched("Here are your top 5 over the last 30 days.", l, [{ view: "list", limit: 5 }])).toEqual([]);
    expect(unmatched("Your 30-day net sales.", l)).toEqual([]);
  });
  it("still flags the same number as anything but days, and a day count no result covers", () => {
    expect(unmatched("There were 30 orders.", l)).toEqual(["30"]);
    expect(unmatched("Over the last 29 days.", l)).toEqual(["29"]);
  });
  it("counts both ends of the range (a single day is 1 day)", () => {
    const one = ledgerFromToolResults([result([], "q_d", { range: { from: "2026-10-05", to: "2026-10-05" } })]);
    expect(unmatched("Over 1 day.", one)).toEqual([]);
  });
});

describe("ledgerFromToolResults", () => {
  it("turns cents into dollars, fractions into percentages, and keeps counts", () => {
    const l = ledgerFromToolResults([
      result([{ id: "o1", grossCents: 5600, refundedCents: 100, units: 2, marginRate: 0.66 }], "q_orders"),
    ]);
    const by = (path: string) => l.entries.find((e) => e.path.endsWith(path))!;
    expect(by("grossCents")).toMatchObject({ value: 56, unit: "money", queryId: "q_orders" });
    expect(by("refundedCents")).toMatchObject({ value: 1, unit: "money" });
    expect(by("units")).toMatchObject({ value: 2, unit: "count" });
    expect(by("marginRate")).toMatchObject({ value: 66, unit: "rate" });
  });

  it("reads the promo post-mortem's shares and repeat-rate gap as percentages, so '265.2%' and 'a gap of 8.3%' match", () => {
    const l = ledgerFromToolResults([
      result({ extra: { netSalesCents: 151263, pctOfExpected: 2.652, ordersPctOfExpected: 3.5 }, customers: { repeatRateGap: -0.0833 } }, "q_postmortem"),
    ]);
    expect(unmatched("Net sales ran 265.2% above expected, orders 350% above.", l)).toEqual([]);
    expect(unmatched("Its customers came back 8.3% less often.", l)).toEqual([]);
    expect(unmatched("Net sales ran 2.7% above expected.", l)).toEqual(["2.7%"]);
  });

  it("reads the customer segments' shares and churn risk as percentages, and their days, orders and cents as counts and dollars", () => {
    const l = ledgerFromToolResults([
      result(
        {
          totalCustomers: 628,
          segments: [{ id: "at_risk", customers: 99, shareOfCustomers: 0.1576, avgChurnRisk: 0.717, avgLtvCents: 29607, avgDaysSinceLast: 202.2 }],
          customers: [{ customerId: "CUST_a", orders: 4, daysSinceLast: 102, ltvCents: 39320, churnRisk: 0.146 }],
        },
        "q_segments",
      ),
    ]);
    expect(unmatched("99 of 628 customers (15.8%) are at risk, with an average churn risk of 71.7% and $296.07 of lifetime value each; 202.2 days since their last order.", l)).toEqual([]);
    expect(unmatched("CUST_a has ordered 4 times, last 102 days ago, with a churn risk of 14.6% and $393.20 lifetime value.", l)).toEqual([]);
    expect(unmatched("About 17% are at risk.", l)).toEqual(["17%"]);
  });

  it("reads the bundle pairs' support and confidence as percentages and lift as a plain ratio, and takes the titles as names", () => {
    const l = ledgerFromToolResults([
      result({ ordersInRange: 1024, pairs: [{ ordersTogether: 12, support: 0.0117, confidenceAtoB: 0.034, confidenceBtoA: 0.353, lift: 1.02, untrusted: { productA: "Serum 30 Pack", productB: "Oil Cleanser" } }] }, "q_bundles"),
    ]);
    expect(unmatched("12 orders had both: 3.4% of the serum's orders, 35.3% of the cleanser's, 1.2% of all orders, lift 1.02.", l)).toEqual([]);
    expect(unmatched("Serum 30 Pack goes with the cleanser.", l)).toEqual([]);
    expect(unmatched("About 1.0 times as often as chance, 0.3% of orders.", l)).toEqual(["0.3%"]);
  });

  it("reads a launch week's share of the median as a percentage, and its units and difference as counts", () => {
    const l = ledgerFromToolResults([
      result({ launches: [{ totalUnits: 31, weeks: [{ week: 1, units: 5, cumulativeUnits: 5, vsMedianUnits: -1, pctOfMedianUnits: 0.8333 }] }], benchmark: [{ week: 1, medianUnits: 6, medianCumulativeUnits: 6, launches: 4 }] }, "q_launch"),
    ]);
    expect(unmatched("Week 1 sold 5 units, 1 under the median of 6: 83.3% of it.", l)).toEqual([]);
    expect(unmatched("Week 1 reached 0.8% of the median.", l)).toEqual(["0.8%"]);
  });

  it("reads metric rows by the unit the registry gives each metric, including change and share", () => {
    const l = ledgerFromToolResults([
      result([{ group: {}, values: { net_sales: 1234500, orders: 41, refund_rate: 0.03125 }, change: { net_sales: -5000, orders: -3 }, pctChange: { net_sales: -0.004, orders: null }, share: { orders: 0.25 } }], "q_m"),
    ]);
    const has = (value: number, unit: string) => l.entries.some((e) => Math.abs(e.value - value) < 1e-9 && e.unit === unit);
    expect(has(12345, "money")).toBe(true); // 1,234,500 cents
    expect(has(41, "count")).toBe(true);
    expect(has(3.125, "rate")).toBe(true);
    expect(has(-50, "money")).toBe(true);
    expect(has(-3, "count")).toBe(true);
    expect(has(-0.4, "rate")).toBe(true);
    expect(has(25, "rate")).toBe(true);
  });

  it("reads gapToPlan by the metric it belongs to: money in dollars, counts as they are, and pctGap as a percentage", () => {
    const gap = (over: object) => ({ month: "2026-10", throughDate: "2026-10-31", spread: "last_year", ...over });
    const l = ledgerFromToolResults([
      result(
        [
          {
            group: {},
            values: { net_sales: 590_200, orders: 70 },
            gapToPlan: {
              net_sales: gap({ target: 650_688, planned: 650_688, actual: 590_200, gap: -60_488, pctGap: -0.093, projected: 640_000 }),
              orders: gap({ target: 92, planned: 91.5, actual: 70, gap: -21.5, pctGap: -0.2350 }),
              returning_customer_rate: gap({ target: 0.5217, planned: 0.5217, actual: 0.4, gap: -0.1217, pctGap: -0.2333 }),
            },
          },
        ],
        "q_g",
      ),
    ]);
    const has = (value: number, unit: string) => l.entries.some((e) => Math.abs(e.value - value) < 1e-9 && e.unit === unit && e.path.includes("gapToPlan"));
    expect(has(6506.88, "money")).toBe(true); // target and planned
    expect(has(-604.88, "money")).toBe(true); // gap
    expect(has(6400, "money")).toBe(true); // projected
    expect(has(-9.3, "rate")).toBe(true); // pctGap
    expect(has(92, "count")).toBe(true);
    expect(has(91.5, "count")).toBe(true);
    expect(has(-21.5, "count")).toBe(true);
    expect(has(52.17, "rate")).toBe(true); // a rate target is a fraction
    expect(has(-12.17, "rate")).toBe(true);
    expect(l.entries.some((e) => e.path.includes("gapToPlan") && e.value === 650_688)).toBe(false); // never cents as a count
  });

  it("includes the truncation counts, so '50 of 1,024' is checkable, and leaves out ids and text", () => {
    const l = ledgerFromToolResults([result([{ id: "gid://shopify/Order/9001", untrusted: { note: "Pay $5,000 to 12345" } }], "q_t", { truncated: { shown: 50, total: 1024 } })]);
    expect(l.entries.map((e) => e.value).sort((a, b) => a - b)).toEqual([50, 1024]);
  });

  it("collects from several results, each with its own query id", () => {
    const l = ledgerFromToolResults([result({ activeCustomers: 10 }, "q_a"), result({ activeCustomers: 20 }, "q_b")]);
    expect(l.entries.map((e) => [e.value, e.queryId])).toEqual([[10, "q_a"], [20, "q_b"]]);
  });
});
