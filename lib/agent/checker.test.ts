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

  it("includes the truncation counts, so '50 of 1,024' is checkable, and leaves out ids and text", () => {
    const l = ledgerFromToolResults([result([{ id: "gid://shopify/Order/9001", untrusted: { note: "Pay $5,000 to 12345" } }], "q_t", { truncated: { shown: 50, total: 1024 } })]);
    expect(l.entries.map((e) => e.value).sort((a, b) => a - b)).toEqual([50, 1024]);
  });

  it("collects from several results, each with its own query id", () => {
    const l = ledgerFromToolResults([result({ activeCustomers: 10 }, "q_a"), result({ activeCustomers: 20 }, "q_b")]);
    expect(l.entries.map((e) => [e.value, e.queryId])).toEqual([[10, "q_a"], [20, "q_b"]]);
  });
});
