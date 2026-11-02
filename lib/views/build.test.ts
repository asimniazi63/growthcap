import type { BundleCandidatesData, BundlePairRow } from "../tools/bundles";
import type { CohortCell } from "../tools/cohorts";
import type { LaunchCurvesData, LaunchRow } from "../tools/launch-curves";
import type { PromoPostmortemData } from "../tools/promo-postmortem";
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
  it("refuses a component outside the ten", () => {
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

// The three charts drawn from their own tool's result. Hand-made results here; lib/views/build-charts.test.ts uses the real tools.
const envelope = <T,>(data: T, over: Partial<ToolResult<T>> = {}): ToolResult<T> => ({ data, queryId: "q_bbbbbbbbbbbb", range: { from: "2025-11-28", to: "2025-12-01" }, definitions: {}, asOf: "2026-10-31T10:00:00.000Z", ...over });

describe("lift_dip", () => {
  const promo = (over: Partial<PromoPostmortemData> = {}): PromoPostmortemData => ({
    code: "BFCM25",
    window: { from: "2025-11-28", to: "2025-12-01", days: 4 },
    during: { orders: 36, netSalesCents: 208_300 },
    baseline: { from: "2025-10-31", to: "2025-11-27", days: 28, orders: 54, netSalesCents: 399_260, ordersPerDay: 1.93, netSalesPerDayCents: 14_259 },
    expected: { orders: 8, netSalesCents: 57_036 },
    extra: { orders: 28, netSalesCents: 151_264, pctOfExpected: 2.65, ordersPctOfExpected: 3.5 },
    after: { from: "2025-12-02", to: "2025-12-29", daysObserved: 28, fullyObserved: true, orders: 40, netSalesCents: 300_000, expectedOrders: 54, expectedNetSalesCents: 399_260, pulledForwardOrders: 14, pulledForwardNetSalesCents: 99_260 },
    netLift: { orders: 14, netSalesCents: 52_004 },
    codeOrders: { orders: 30, netSalesCents: 150_000, discountCents: 30_000 },
    customers: {
      repeatWindowDays: 30,
      promoCohort: { range: { from: "2025-11-28", to: "2025-12-01" }, cohortCustomers: 26, customers: 26, repeaters: 0, repeatRate: 0, notYetObserved: 0, firstOrderCode: "BFCM25" },
      comparison: { range: { from: "2025-10-31", to: "2025-11-27" }, cohortCustomers: 40, customers: 40, repeaters: 5, repeatRate: 0.125, notYetObserved: 0, excludedCode: "BFCM25" },
      repeatRateGap: -0.125,
    },
    ...over,
  });
  const source = (data: PromoPostmortemData): ViewSource => ({ tool: "get_promo_postmortem", input: { code: "BFCM25" }, result: envelope(data) });

  it("copies the labelled figures from the result and works out only the window's and the after days' average day", () => {
    const v = buildView("lift_dip", [source(promo())]);
    if (v.component !== "lift_dip") throw new Error();
    expect(v).toMatchObject({ code: "BFCM25", queryIds: ["q_bbbbbbbbbbbb"], range: { from: "2025-11-28", to: "2025-12-01" } });
    expect(v.extraNetSalesCents).toBe(151_264);
    expect(v.pulledForwardNetSalesCents).toBe(99_260);
    expect(v.netLiftNetSalesCents).toBe(52_004);
    expect(v.baseline).toEqual({ from: "2025-10-31", to: "2025-11-27", days: 28, netSalesCents: 399_260, perDayCents: 14_259 }); // the result's own rate
    expect(v.window).toMatchObject({ days: 4, netSalesCents: 208_300, perDayCents: 52_075, expectedNetSalesCents: 57_036 });
    expect(v.after).toMatchObject({ daysObserved: 28, fullyObserved: true, netSalesCents: 300_000, perDayCents: 10_714, expectedNetSalesCents: 399_260 });
    expect(v.customers).toEqual({
      repeatWindowDays: 30,
      promo: { cohortCustomers: 26, customers: 26, repeatRate: 0 },
      comparison: { cohortCustomers: 40, customers: 40, repeatRate: 0.125 },
      repeatRateGap: -0.125,
    });
    expect(v.caveats).toBeUndefined();
  });

  it("keeps a zero pulled-forward, the caveats, and a null repeat rate", () => {
    const base = promo();
    const v = buildView("lift_dip", [
      source(promo({ after: { ...base.after, pulledForwardNetSalesCents: 0, pulledForwardOrders: 0 }, netLift: base.extra, caveats: ["Only 3 days of the 28 days after the window are in the data."], customers: { ...base.customers, repeatRateGap: null, comparison: { ...base.customers.comparison, customers: 0, repeatRate: null } } })),
    ]);
    if (v.component !== "lift_dip") throw new Error();
    expect(v.pulledForwardNetSalesCents).toBe(0);
    expect(v.netLiftNetSalesCents).toBe(151_264);
    expect(v.caveats).toEqual(["Only 3 days of the 28 days after the window are in the data."]);
    expect(v.customers.comparison.repeatRate).toBeNull();
    expect(v.customers.repeatRateGap).toBeNull();
  });

  it("has no average day for days after the window that are not in the data", () => {
    const base = promo();
    const v = buildView("lift_dip", [source(promo({ after: { ...base.after, daysObserved: 0, fullyObserved: false, orders: 0, netSalesCents: 0, pulledForwardNetSalesCents: 0, expectedNetSalesCents: 0 } }))]);
    if (v.component !== "lift_dip") throw new Error();
    expect(v.after).toMatchObject({ daysObserved: 0, perDayCents: 0 });
  });

  it("draws one get_promo_postmortem result, and only that", () => {
    fails(() => buildView("lift_dip", [source(promo()), source(promo())]), /one get_promo_postmortem/);
    fails(() => buildView("lift_dip", [src({ metrics: ["orders"] }, [])]), /get_promo_postmortem/);
    fails(() => buildView("bar", [source(promo())]), /query_metric/);
  });
});

describe("launch_curves", () => {
  const week = (n: number, daysObserved: number, units: number, cumulativeUnits: number) => ({ week: n, from: "2026-01-01", to: "2026-01-07", daysObserved, units, cumulativeUnits, vsMedianUnits: null, pctOfMedianUnits: null });
  const launch = (id: string, title: string | null, over: Partial<LaunchRow> = {}): LaunchRow => ({
    productId: `gid://shopify/Product/${id}`,
    launchDate: "2026-01-01",
    daysObserved: 14,
    fullyObserved: true,
    totalUnits: 9,
    weeks: [week(1, 7, 5, 5), week(2, 7, 4, 9)],
    untrusted: { product: title },
    ...over,
  });
  const data = (launches: LaunchRow[], over: Partial<LaunchCurvesData> = {}): LaunchCurvesData => ({
    benchmark: [{ week: 1, medianUnits: 4, medianCumulativeUnits: 4, launches: 6 }, { week: 2, medianUnits: 2, medianCumulativeUnits: 6.5, launches: 6 }],
    launches,
    ...over,
  });
  const source = (d: LaunchCurvesData, over: Partial<ToolResult<LaunchCurvesData>> = {}): ViewSource => ({ tool: "get_launch_curves", input: {}, result: envelope(d, over) });

  it("keeps each launch's title, dates, total and cumulative weeks, and the median's cumulative curve, and no product ids", () => {
    const v = buildView("launch_curves", [source(data([launch("1", "Cedar Candle"), launch("2", null, { daysObserved: 10, fullyObserved: false, totalUnits: 7, weeks: [week(1, 7, 5, 5), week(2, 3, 2, 7)] })]))]);
    if (v.component !== "launch_curves") throw new Error();
    expect(v.benchmark).toEqual([{ week: 1, medianCumulativeUnits: 4, launches: 6 }, { week: 2, medianCumulativeUnits: 6.5, launches: 6 }]);
    expect(v.launches[0]).toEqual({ title: "Cedar Candle", launchDate: "2026-01-01", daysObserved: 14, fullyObserved: true, totalUnits: 9, weeks: [{ week: 1, daysObserved: 7, units: 5, cumulativeUnits: 5 }, { week: 2, daysObserved: 7, units: 4, cumulativeUnits: 9 }] });
    expect(v.launches[1]).toMatchObject({ title: "A product no longer in the catalogue", fullyObserved: false, totalUnits: 7 });
    expect(v.launches[1]!.weeks[1]).toMatchObject({ daysObserved: 3, cumulativeUnits: 7 });
    expect(v.truncated).toBeUndefined();
    expect(JSON.stringify(v)).not.toContain("gid://");
  });

  it("draws the first twelve, newest first as the result lists them, and says how many there were", () => {
    const many = Array.from({ length: 15 }, (_, i) => launch(String(i), `Product ${i}`));
    const v = buildView("launch_curves", [source(data(many.slice(0, 14)), { truncated: { shown: 14, total: 30 } })]);
    if (v.component !== "launch_curves") throw new Error();
    expect(v.launches.map((l) => l.title)).toEqual(many.slice(0, 12).map((_, i) => `Product ${i}`));
    expect(v.truncated).toEqual({ shown: 12, total: 30 });
  });

  it("does not refuse a result with no launches: it carries the caveats so the chart can say why", () => {
    const v = buildView("launch_curves", [source(data([], { benchmark: [], caveats: ["No product launched in the data."] }))]);
    if (v.component !== "launch_curves") throw new Error();
    expect(v.launches).toEqual([]);
    expect(v.caveats).toEqual(["No product launched in the data."]);
  });

  it("draws one get_launch_curves result, and only that", () => {
    fails(() => buildView("launch_curves", [source(data([])), source(data([]))]), /one get_launch_curves/);
    fails(() => buildView("launch_curves", [src({ metrics: ["orders"] }, [])]), /get_launch_curves/);
  });
});

describe("bundle_matrix", () => {
  const pair = (a: string, b: string, titles: [string, string], over: Partial<BundlePairRow> = {}): BundlePairRow => ({
    productAId: `gid://shopify/Product/${a}`,
    productBId: `gid://shopify/Product/${b}`,
    ordersTogether: 10,
    ordersA: 40,
    ordersB: 25,
    support: 0.01,
    confidenceAtoB: 0.25,
    confidenceBtoA: 0.4,
    lift: 1.4,
    untrusted: { productA: titles[0], productB: titles[1] },
    ...over,
  });
  const data = (pairs: BundlePairRow[], over: Partial<BundleCandidatesData> = {}): BundleCandidatesData => ({ ordersInRange: 1000, ordersWithTwoOrMoreProducts: 300, pairs, ...over });
  const source = (d: BundleCandidatesData, over: Partial<ToolResult<BundleCandidatesData>> = {}): ViewSource => ({ tool: "get_bundle_candidates", input: {}, result: envelope(d, over) });

  it("puts the products that share the most orders first, and points each pair at two of them with the right confidence for each way", () => {
    // Serum is in two pairs (10 + 6 orders together), Balm in one (10), Oil in one (6).
    const v = buildView("bundle_matrix", [
      source(data([pair("1", "2", ["Serum", "Balm"]), pair("1", "3", ["Serum", "Oil"], { ordersTogether: 6, ordersA: 40, ordersB: 12, confidenceAtoB: 0.15, confidenceBtoA: 0.5, lift: 0.8 })])),
    ]);
    if (v.component !== "bundle_matrix") throw new Error();
    expect(v.products).toEqual([
      { title: "Serum", orders: 40, sharedOrders: 16 },
      { title: "Balm", orders: 25, sharedOrders: 10 },
      { title: "Oil", orders: 12, sharedOrders: 6 },
    ]);
    expect(v.pairs).toEqual([
      { a: 0, b: 1, ordersTogether: 10, confidenceAtoB: 0.25, confidenceBtoA: 0.4, lift: 1.4, thin: false },
      { a: 0, b: 2, ordersTogether: 6, confidenceAtoB: 0.15, confidenceBtoA: 0.5, lift: 0.8, thin: true },
    ]);
    expect(v.ordersInRange).toBe(1000);
    expect(v.omitted).toBeUndefined();
    expect(JSON.stringify(v)).not.toContain("gid://");
  });

  it("swaps the confidences with the pair when the order of the axis puts the result's second product first", () => {
    // Ids sort "1" < "2", but Balm (2) shares more orders than Serum (1), so Balm comes first on the axis.
    const v = buildView("bundle_matrix", [
      source(data([pair("1", "2", ["Serum", "Balm"], { ordersTogether: 9, ordersA: 30, ordersB: 20, confidenceAtoB: 0.3, confidenceBtoA: 0.45 }), pair("2", "3", ["Balm", "Oil"], { ordersTogether: 9 })])),
    ]);
    if (v.component !== "bundle_matrix") throw new Error();
    expect(v.products.map((p) => p.title)).toEqual(["Balm", "Oil", "Serum"]); // Balm shares 18 orders, the others 9 each
    const serumBalm = v.pairs.find((p) => [v.products[p.a]!.title, v.products[p.b]!.title].sort().join() === "Balm,Serum")!;
    const [first, second] = [v.products[serumBalm.a]!.title, v.products[serumBalm.b]!.title];
    expect(first).toBe("Balm");
    expect(second).toBe("Serum");
    expect(serumBalm.confidenceAtoB).toBe(0.45); // the share of Balm's orders that also had Serum
    expect(serumBalm.confidenceBtoA).toBe(0.3);
  });

  it("marks a pair under eight orders together as thin, and eight as not", () => {
    const v = buildView("bundle_matrix", [source(data([pair("1", "2", ["A", "B"], { ordersTogether: 7 }), pair("3", "4", ["C", "D"], { ordersTogether: 8 })]))]);
    if (v.component !== "bundle_matrix") throw new Error();
    expect(v.pairs.map((p) => [p.ordersTogether, p.thin])).toEqual([[7, true], [8, false]]);
  });

  it("draws at most twelve products and counts the pairs it left out", () => {
    // A chain of 14 products: pair i joins product i and i + 1, so the middle products share the most orders.
    const chain = Array.from({ length: 13 }, (_, i) => pair(String(100 + i), String(101 + i), [`P${i}`, `P${i + 1}`], { ordersTogether: 10 + (i % 3) }));
    const v = buildView("bundle_matrix", [source(data(chain), { truncated: { shown: 13, total: 40 } })]);
    if (v.component !== "bundle_matrix") throw new Error();
    expect(v.products).toHaveLength(12);
    expect(v.omitted!.products).toBe(2);
    expect(v.pairs.length + v.omitted!.pairs).toBe(13);
    expect(v.omitted!.pairs).toBeGreaterThan(0);
    for (const p of v.pairs) expect(p.a).toBeLessThan(p.b);
    expect(v.truncated).toEqual({ shown: 13, total: 40 });
  });

  it("does not refuse a result with no pairs: it carries the caveats", () => {
    const v = buildView("bundle_matrix", [source(data([], { caveats: ["No pair of products appeared together in at least 5 orders in this range, so none is listed."] }))]);
    if (v.component !== "bundle_matrix") throw new Error();
    expect(v.pairs).toEqual([]);
    expect(v.products).toEqual([]);
    expect(v.caveats).toHaveLength(1);
  });

  it("draws one get_bundle_candidates result, and only that", () => {
    fails(() => buildView("bundle_matrix", [source(data([])), source(data([]))]), /one get_bundle_candidates/);
    fails(() => buildView("bundle_matrix", [src({ metrics: ["orders"] }, [])]), /get_bundle_candidates/);
    fails(() => buildView("table", [source(data([]))]), /query_metric/);
  });
});
