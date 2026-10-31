import type { CohortCell } from "../tools/cohorts";
import { describe, expect, it } from "vitest";
import type { MetricRow } from "../metrics/query";
import type { QueryMetricInput } from "../metrics/query";
import type { ToolResult } from "../tools/result";
import { buildView, type ViewSource } from "./build";

const result = (data: MetricRow[], over: Partial<ToolResult<MetricRow[]>> = {}): ToolResult<MetricRow[]> => ({
  data,
  queryId: "q_aaaaaaaaaaaa",
  range: { from: "2026-09-01", to: "2026-09-30" },
  definitions: {},
  asOf: "2026-10-31T10:34:00.000Z",
  ...over,
});
const src = (input: QueryMetricInput, data: MetricRow[], over: Partial<ToolResult<MetricRow[]>> = {}): ViewSource => ({ tool: "query_metric", input, result: result(data, over) });
const row = (group: Record<string, string>, values: MetricRow["values"], extra: Partial<MetricRow> = {}): MetricRow => ({ group, values, ...extra });
const fails = (fn: () => unknown, message: RegExp) => {
  try {
    fn();
  } catch (e) {
    expect(e).toMatchObject({ code: "INVALID_INPUT" });
    expect((e as Error).message).toMatch(message);
    return;
  }
  throw new Error("expected buildView to throw");
};

describe("buildView: kpi", () => {
  it("makes a card for each metric of an ungrouped result, with the comparison and plan when the result has them", () => {
    const plan = { month: "2026-09", target: 700_000, planned: 700_000, actual: 629_448, gap: -70_552, pctGap: -0.1008, throughDate: "2026-09-30" };
    const v = buildView("kpi", [
      src({ metrics: ["net_sales", "orders"], period: "last_month", compareTo: "previous_period" }, [
        row({}, { net_sales: 629_448, orders: 80 }, { previous: { net_sales: 877_370, orders: 103 }, change: { net_sales: -247_922, orders: -23 }, pctChange: { net_sales: -0.2826, orders: -0.2233 }, gapToPlan: { net_sales: plan } }),
      ]),
    ]);
    expect(v).toMatchObject({ component: "kpi", queryIds: ["q_aaaaaaaaaaaa"], range: { from: "2026-09-01", to: "2026-09-30" } });
    if (v.component !== "kpi") throw new Error();
    expect(v.cards).toHaveLength(2);
    expect(v.cards[0]).toMatchObject({ metric: "net_sales", label: "Net sales", unit: "money", value: 629_448, previous: 877_370, change: -247_922, pctChange: -0.2826, plan });
    expect(v.cards[1]).toMatchObject({ metric: "orders", unit: "count", value: 80 });
    expect(v.cards[1]!.plan).toBeUndefined();
  });

  it("combines up to three results into one row of cards", () => {
    const one = (m: "orders" | "units") => src({ metrics: [m], period: "last_month" }, [row({}, { [m]: 5 })], { queryId: `q_${m}` });
    const v = buildView("kpi", [one("orders"), one("units")]);
    if (v.component !== "kpi") throw new Error();
    expect(v.cards.map((c) => c.metric)).toEqual(["orders", "units"]);
    expect(v.queryIds).toEqual(["q_orders", "q_units"]);
  });

  it("keeps each card's own period, so two results for the same metric can sit side by side", () => {
    const sep = src({ metrics: ["net_sales"], period: "last_month" }, [row({}, { net_sales: 629_448 })], { queryId: "q_sep", range: { from: "2026-09-01", to: "2026-09-30" } });
    const aug = src({ metrics: ["net_sales"], from: "2026-08-01", to: "2026-08-31" }, [row({}, { net_sales: 877_370 })], { queryId: "q_aug", range: { from: "2026-08-01", to: "2026-08-31" } });
    const v = buildView("kpi", [sep, aug]);
    if (v.component !== "kpi") throw new Error();
    expect(v.cards.map((c) => [c.metric, c.range.from])).toEqual([["net_sales", "2026-09-01"], ["net_sales", "2026-08-01"]]);
    expect(v.range).toEqual({ from: "2026-08-01", to: "2026-09-30" });
  });

  it("refuses a grouped result", () => {
    fails(() => buildView("kpi", [src({ metrics: ["orders"], groupBy: ["channel"] }, [row({ channel: "web" }, { orders: 1 })])]), /one total/);
  });
});

describe("buildView: line", () => {
  const daily = (input: Partial<QueryMetricInput> = {}) => src({ metrics: ["orders", "units"], groupBy: ["day"], ...input }, [row({ day: "2026-09-02" }, { orders: 3, units: 5 }), row({ day: "2026-09-01" }, { orders: 1, units: 2 })]);

  it("plots the first metric against the time grouping, oldest first", () => {
    const v = buildView("line", [daily()]);
    if (v.component !== "line") throw new Error();
    expect(v).toMatchObject({ metric: "orders", label: "Orders", unit: "count", dimension: "day" });
    expect(v.points).toEqual([{ x: "2026-09-01", y: 1 }, { x: "2026-09-02", y: 3 }]);
  });

  it("needs exactly one time grouping", () => {
    fails(() => buildView("line", [src({ metrics: ["orders"] }, [row({}, { orders: 1 })])]), /day, week or month/);
    fails(() => buildView("line", [src({ metrics: ["orders"], groupBy: ["channel"] }, [row({ channel: "web" }, { orders: 1 })])]), /day, week or month/);
  });
});

describe("buildView: bar", () => {
  it("names product bars by title, and keeps the share and the truncation note", () => {
    const v = buildView("bar", [
      src(
        { metrics: ["units"], groupBy: ["product"], limit: 2 },
        [row({ product: "gid://shopify/Product/1" }, { units: 30 }, { share: { units: 0.6 }, untrusted: { product: "Hero Vitamin C Serum" } }), row({ product: "gid://shopify/Product/2" }, { units: 20 }, { share: { units: 0.4 }, untrusted: { product: "Barrier Cream" } })],
        { truncated: { shown: 2, total: 24 } },
      ),
    ]);
    if (v.component !== "bar") throw new Error();
    expect(v.bars).toEqual([{ label: "Hero Vitamin C Serum", value: 30, share: 0.6 }, { label: "Barrier Cream", value: 20, share: 0.4 }]);
    expect(v.truncated).toEqual({ shown: 2, total: 24 });
    expect(JSON.stringify(v)).not.toContain("gid://");
  });

  it("names a variant bar with its product and variant titles", () => {
    const v = buildView("bar", [src({ metrics: ["units"], groupBy: ["variant"] }, [row({ variant: "gid://x/1" }, { units: 3 }, { untrusted: { product: "Hero Vitamin C Serum", variant: "30 ml" } })])]);
    if (v.component !== "bar") throw new Error();
    expect(v.bars[0]!.label).toBe("Hero Vitamin C Serum 30 ml");
  });

  it("uses the group value for a grouping with no titles", () => {
    const v = buildView("bar", [src({ metrics: ["discounts"], groupBy: ["discount_code"] }, [row({ discount_code: "WELCOME10" }, { discounts: 8620 })])]);
    if (v.component !== "bar") throw new Error();
    expect(v.bars[0]).toMatchObject({ label: "WELCOME10", value: 8620 });
  });

  it("needs a grouped result", () => {
    fails(() => buildView("bar", [src({ metrics: ["orders"] }, [row({}, { orders: 1 })])]), /grouped/);
  });
});

describe("buildView: table", () => {
  it("lists the groups and every metric, in the order asked for", () => {
    const v = buildView("table", [
      src({ metrics: ["orders", "net_sales"], groupBy: ["channel"] }, [row({ channel: "web" }, { orders: 4, net_sales: 5000 }), row({ channel: "pos" }, { orders: 1, net_sales: 900 })]),
    ]);
    if (v.component !== "table") throw new Error();
    expect(v.columns).toEqual([
      { key: "channel", label: "Channel" },
      { key: "orders", label: "Orders", unit: "count" },
      { key: "net_sales", label: "Net sales", unit: "money" },
    ]);
    expect(v.rows).toEqual([{ channel: "web", orders: 4, net_sales: 5000 }, { channel: "pos", orders: 1, net_sales: 900 }]);
  });

  it("shows an ungrouped result as one row", () => {
    const v = buildView("table", [src({ metrics: ["orders"] }, [row({}, { orders: 7 })])]);
    if (v.component !== "table") throw new Error();
    expect(v.rows).toEqual([{ orders: 7 }]);
  });
});

describe("buildView: gauge", () => {
  const gap = (over = {}) => ({ month: "2026-10", target: 100, planned: 40, actual: 30, gap: -10, pctGap: -0.25, projected: 75, spread: "even" as const, throughDate: "2026-10-15", ...over });
  it("draws each metric that has a plan gap: actual against plan so far and the target", () => {
    const v = buildView("gauge", [src({ metrics: ["orders", "aov"], from: "2026-10-01", to: "2026-10-15" }, [row({}, { orders: 30, aov: 7000 }, { gapToPlan: { orders: gap(), aov: gap({ target: 7500, planned: 7500, actual: 7000, gap: -500, projected: undefined, spread: undefined }) } })])]);
    if (v.component !== "gauge") throw new Error();
    expect(v.gauges.map((g) => g.metric)).toEqual(["orders", "aov"]);
    expect(v.gauges[0]).toMatchObject({ actual: 30, planned: 40, target: 100, projected: 75, throughDate: "2026-10-15" });
  });
  it("needs a result with gapToPlan, and says what makes one", () => {
    fails(() => buildView("gauge", [src({ metrics: ["orders"], period: "last_30_days" }, [row({}, { orders: 3 })])]), /gapToPlan/);
  });
});

describe("buildView: waterfall", () => {
  const compare = (extra: Partial<ToolResult<MetricRow[]>> = {}) =>
    src(
      { metrics: ["net_sales"], groupBy: ["channel"], compareTo: "previous_period" },
      [
        row({ channel: "web" }, { net_sales: 700 }, { previous: { net_sales: 500 }, change: { net_sales: 200 } }),
        row({ channel: "pos" }, { net_sales: 100 }, { previous: { net_sales: 300 }, change: { net_sales: -200 } }),
        row({ channel: "wholesale" }, { net_sales: 50 }, { previous: { net_sales: 50 }, change: { net_sales: 0 } }),
      ],
      extra,
    );
  it("bridges the previous total to the current one through each group's change", () => {
    const v = buildView("waterfall", [compare()]);
    if (v.component !== "waterfall") throw new Error();
    expect(v.steps).toEqual([
      { label: "Previous period", value: 850, kind: "start" },
      { label: "web", value: 200, kind: "delta" },
      { label: "pos", value: -200, kind: "delta" },
      { label: "wholesale", value: 0, kind: "delta" },
      { label: "This period", value: 850, kind: "end" },
    ]);
    const start = v.steps[0]!.value;
    const deltas = v.steps.filter((s) => s.kind === "delta").reduce((s, x) => s + x.value, 0);
    expect(start + deltas).toBe(v.steps.at(-1)!.value);
  });
  it("needs a comparison, one non-time grouping, an adding-up metric and every group", () => {
    fails(() => buildView("waterfall", [src({ metrics: ["net_sales"], groupBy: ["channel"] }, [row({ channel: "web" }, { net_sales: 1 })])]), /compareTo/);
    fails(() => buildView("waterfall", [src({ metrics: ["aov"], groupBy: ["channel"], compareTo: "previous_period" }, [row({ channel: "web" }, { aov: 1 }, { previous: { aov: 1 }, change: { aov: 0 } })])]), /add up/);
    fails(() => buildView("waterfall", [compare({ truncated: { shown: 3, total: 9 } })]), /every group/);
  });
});

describe("buildView: nothing to draw", () => {
  it("refuses a line, bar or waterfall with no rows, instead of drawing an empty chart", () => {
    fails(() => buildView("line", [src({ metrics: ["orders"], groupBy: ["day"] }, [])]), /no rows/);
    fails(() => buildView("bar", [src({ metrics: ["orders"], groupBy: ["channel"] }, [])]), /no rows/);
    fails(() => buildView("waterfall", [src({ metrics: ["net_sales"], groupBy: ["channel"], compareTo: "previous_period" }, [])]), /no rows/);
  });
  it("still shows an empty table, which says there are no rows", () => {
    const v = buildView("table", [src({ metrics: ["orders"], groupBy: ["channel"] }, [])]);
    if (v.component !== "table") throw new Error();
    expect(v.rows).toEqual([]);
  });
});

describe("buildView: sources", () => {
  it("accepts results from query_metric only", () => {
    fails(() => buildView("table", [{ tool: "get_orders", input: {}, result: result([]) } as unknown as ViewSource]), /query_metric/);
  });
  it("takes one result for everything but kpi", () => {
    const one = src({ metrics: ["orders"], groupBy: ["channel"] }, [row({ channel: "web" }, { orders: 1 })]);
    fails(() => buildView("bar", [one, one]), /one result/);
    fails(() => buildView("bar", []), /at least one/i);
  });
  it("refuses a component outside the six", () => {
    fails(() => buildView("pie" as never, [src({ metrics: ["orders"] }, [row({}, { orders: 1 })])]), /component/);
  });
});

describe("cohort", () => {
  const cohortSource = (cells: CohortCell[]): ViewSource => ({
    tool: "get_cohorts",
    input: { from: "2026-03-01", to: "2026-04-30" },
    result: { data: { summary: { windowDays: 30, cohortCustomers: 0, customers: 0, repeaters: 0, repeatRate: null, notYetObserved: 0 }, cells }, queryId: "q_cccccccccccc", range: { from: "2026-03-01", to: "2026-04-30" }, definitions: {}, asOf: "2026-10-31T10:00:00.000Z" },
  });
  const cell = (cohort: string, monthsSince: number, repeatShare: number | null): CohortCell => ({ cohort, monthsSince, windowDays: monthsSince * 30, cohortCustomers: 10, customers: 10, repeaters: repeatShare === null ? 0 : repeatShare * 10, repeatShare });

  it("copies the cells into one row per first-order month, oldest first, with the months since as columns", () => {
    const data = buildView("cohort", [cohortSource([cell("2026-04", 1, 0.2), cell("2026-03", 2, 0.3), cell("2026-03", 1, 0.1), cell("2026-04", 2, null)])]);
    expect(data).toMatchObject({ component: "cohort", windowMonths: [1, 2], queryIds: ["q_cccccccccccc"] });
    if (data.component !== "cohort") throw new Error("not a cohort");
    expect(data.rows.map((r) => r.cohort)).toEqual(["2026-03", "2026-04"]);
    expect(data.rows[0]!.cells.map((c) => c.repeatShare)).toEqual([0.1, 0.3]);
    expect(data.rows[1]!.cells[1]!.repeatShare).toBeNull();
  });

  it("refuses a result with no grid, and any other tool's result", () => {
    fails(() => buildView("cohort", [cohortSource([])]), /grid/);
    fails(() => buildView("cohort", [src({ metrics: ["orders"] }, [])]), /get_cohorts/);
    fails(() => buildView("bar", [cohortSource([cell("2026-03", 1, 0.1)])]), /query_metric/);
  });
});
