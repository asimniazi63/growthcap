import { AppError } from "../errors";
import type { MetricRow, QueryMetricInput } from "../metrics/query";
import { METRICS, type MetricId } from "../metrics/registry";
import { PLAN_METRICS } from "../pace/metrics";
import type { BundleCandidatesData, GetBundleCandidatesInput } from "../tools/bundles";
import type { CohortsData, GetCohortsInput } from "../tools/cohorts";
import type { GetLaunchCurvesInput, LaunchCurvesData } from "../tools/launch-curves";
import type { GetPromoPostmortemInput, PromoPostmortemData } from "../tools/promo-postmortem";
import type { ToolResult } from "../tools/result";
import { BUNDLE_MAX_PRODUCTS, BUNDLE_THIN_ORDERS, VIEW_COMPONENTS, type Basis, type BundlePair, type BundleProduct, type CohortRow, type GaugeItem, type KpiCard, type TableColumn, type ViewComponent, type ViewData } from "./types";

// Turns tool results into what a component draws. The numbers are copied from the results; nothing here accepts a value
// from the model. Used when the model asks for a view, and again when a pinned view re-runs its queries.

export interface MetricViewSource {
  tool: "query_metric";
  input: QueryMetricInput;
  result: ToolResult<MetricRow[]>;
}
// The other four views each draw one tool's result: the cohort grid from get_cohorts, the lift and dip from
// get_promo_postmortem, the launch curves from get_launch_curves and the bundle matrix from get_bundle_candidates.
export interface CohortViewSource {
  tool: "get_cohorts";
  input: GetCohortsInput;
  result: ToolResult<CohortsData>;
}
export interface PromoViewSource {
  tool: "get_promo_postmortem";
  input: GetPromoPostmortemInput;
  result: ToolResult<PromoPostmortemData>;
}
export interface LaunchViewSource {
  tool: "get_launch_curves";
  input: GetLaunchCurvesInput;
  result: ToolResult<LaunchCurvesData>;
}
export interface BundleViewSource {
  tool: "get_bundle_candidates";
  input: GetBundleCandidatesInput;
  result: ToolResult<BundleCandidatesData>;
}
export type ViewSource = MetricViewSource | CohortViewSource | PromoViewSource | LaunchViewSource | BundleViewSource;

// The tools a view can be drawn from, and the one component that draws each tool other than query_metric.
export const VIEW_SOURCE_TOOLS = ["query_metric", "get_cohorts", "get_promo_postmortem", "get_launch_curves", "get_bundle_candidates"] as const;

const TIME_DIMS = new Set(["day", "week", "month"]);
const bad = (message: string): never => {
  throw new AppError("INVALID_INPUT", message);
};
const dimLabel = (dim: string) => dim.charAt(0).toUpperCase() + dim.slice(1).replace(/_/g, " ");
const metricsOf = (s: MetricViewSource): MetricId[] => [...new Set(s.input.metrics)];

function labelOf(row: MetricRow, dims: string[]): string {
  const dim = dims[0]!;
  const u = row.untrusted;
  if (dim === "variant" && u?.variant) return [u.product, u.variant].filter(Boolean).join(" ");
  if (dim === "product" && u?.product) return u.product;
  return row.group[dim] ?? "unknown";
}

function basisOf(sources: { result: ToolResult<unknown> }[]): Basis {
  return {
    queryIds: sources.map((s) => s.result.queryId),
    range: { from: sources.map((s) => s.result.range.from).sort()[0]!, to: sources.map((s) => s.result.range.to).sort().at(-1)! },
    asOf: sources.map((s) => s.result.asOf).sort().at(-1)!,
  };
}

export function buildView(component: ViewComponent, sources: ViewSource[]): ViewData {
  if (!(VIEW_COMPONENTS as readonly string[]).includes(component)) bad(`component must be one of ${VIEW_COMPONENTS.join(", ")}.`);
  if (sources.length === 0) bad("Give at least one result to draw (a query id from this turn).");
  if (component === "cohort") return buildCohort(sources);
  if (component === "lift_dip") return buildLiftDip(sources);
  if (component === "launch_curves") return buildLaunchCurves(sources);
  if (component === "bundle_matrix") return buildBundleMatrix(sources);
  const metricSources = sources.filter((s): s is MetricViewSource => s.tool === "query_metric");
  if (metricSources.length !== sources.length) bad("A kpi, line, bar, table, gauge or waterfall is drawn from query_metric results only (a cohort grid from get_cohorts, lift_dip from get_promo_postmortem, launch_curves from get_launch_curves, bundle_matrix from get_bundle_candidates).");
  return buildMetricView(component, metricSources);
}

// The cohort grid: first-order month against months since, copied from a get_cohorts result.
function buildCohort(sources: ViewSource[]): ViewData {
  const first = sources[0]!;
  if (sources.length !== 1 || first.tool !== "get_cohorts") return bad("A cohort grid draws one get_cohorts result; give one queryRef.");
  const cells = first.result.data.cells;
  if (cells.length === 0) return bad("This get_cohorts result has no grid. Ask get_cohorts again with the grid on.");
  const byCohort = new Map<string, CohortRow>();
  for (const c of cells) {
    const row = byCohort.get(c.cohort) ?? { cohort: c.cohort, cohortCustomers: c.cohortCustomers, cells: [] };
    row.cells.push({ monthsSince: c.monthsSince, customers: c.customers, repeaters: c.repeaters, repeatShare: c.repeatShare });
    byCohort.set(c.cohort, row);
  }
  const rows = [...byCohort.values()].sort((a, b) => a.cohort.localeCompare(b.cohort));
  for (const r of rows) r.cells.sort((a, b) => a.monthsSince - b.monthsSince);
  const windowMonths = [...new Set(cells.map((c) => c.monthsSince))].sort((a, b) => a - b);
  return { component: "cohort", windowMonths, rows, ...(first.input.firstOrderCode ? { firstOrderCode: first.input.firstOrderCode } : {}), ...basisOf(sources) };
}

// Net sales over days, to the cent. The result gives the baseline's own daily rate; the window and the days after get theirs this way.
const perDay = (cents: number, days: number) => (days > 0 ? Math.round(cents / days) : 0);

// The promo post-mortem as three level bars (before, during, after). Every figure is a field of the result.
function buildLiftDip(sources: ViewSource[]): ViewData {
  const first = sources[0]!;
  if (sources.length !== 1 || first.tool !== "get_promo_postmortem") return bad("A lift_dip draws one get_promo_postmortem result; give one queryRef.");
  const d = first.result.data;
  return {
    component: "lift_dip",
    ...(d.code ? { code: d.code } : {}),
    baseline: { from: d.baseline.from, to: d.baseline.to, days: d.baseline.days, netSalesCents: d.baseline.netSalesCents, perDayCents: d.baseline.netSalesPerDayCents },
    window: { from: d.window.from, to: d.window.to, days: d.window.days, netSalesCents: d.during.netSalesCents, perDayCents: perDay(d.during.netSalesCents, d.window.days), expectedNetSalesCents: d.expected.netSalesCents },
    after: {
      from: d.after.from,
      to: d.after.to,
      daysObserved: d.after.daysObserved,
      fullyObserved: d.after.fullyObserved,
      netSalesCents: d.after.netSalesCents,
      perDayCents: perDay(d.after.netSalesCents, d.after.daysObserved),
      expectedNetSalesCents: d.after.expectedNetSalesCents,
    },
    extraNetSalesCents: d.extra.netSalesCents,
    pulledForwardNetSalesCents: d.after.pulledForwardNetSalesCents,
    netLiftNetSalesCents: d.netLift.netSalesCents,
    customers: {
      repeatWindowDays: d.customers.repeatWindowDays,
      promo: { cohortCustomers: d.customers.promoCohort.cohortCustomers, customers: d.customers.promoCohort.customers, repeatRate: d.customers.promoCohort.repeatRate },
      comparison: { cohortCustomers: d.customers.comparison.cohortCustomers, customers: d.customers.comparison.customers, repeatRate: d.customers.comparison.repeatRate },
      repeatRateGap: d.customers.repeatRateGap,
    },
    ...(d.caveats ? { caveats: d.caveats } : {}),
    ...basisOf(sources),
  };
}

const MAX_LAUNCH_CARDS = 12;
const GONE = "A product no longer in the catalogue";

// One small curve per launch, newest first, against the median launch. Nothing is refused for being empty: a pinned view of a
// store with no launches should say so, not fail.
function buildLaunchCurves(sources: ViewSource[]): ViewData {
  const first = sources[0]!;
  if (sources.length !== 1 || first.tool !== "get_launch_curves") return bad("A launch_curves chart draws one get_launch_curves result; give one queryRef.");
  const d = first.result.data;
  const shown = d.launches.slice(0, MAX_LAUNCH_CARDS);
  const total = Math.max(first.result.truncated?.total ?? 0, d.launches.length);
  return {
    component: "launch_curves",
    benchmark: d.benchmark.map((b) => ({ week: b.week, medianCumulativeUnits: b.medianCumulativeUnits, launches: b.launches })),
    launches: shown.map((l) => ({
      title: l.untrusted.product ?? GONE,
      launchDate: l.launchDate,
      daysObserved: l.daysObserved,
      fullyObserved: l.fullyObserved,
      totalUnits: l.totalUnits,
      weeks: l.weeks.map((w) => ({ week: w.week, daysObserved: w.daysObserved, units: w.units, cumulativeUnits: w.cumulativeUnits })),
    })),
    ...(shown.length < total ? { truncated: { shown: shown.length, total } } : {}),
    ...(d.caveats ? { caveats: d.caveats } : {}),
    ...basisOf(sources),
  };
}

// The pairs as a matrix over the products they involve. The axis holds the BUNDLE_MAX_PRODUCTS products that share the most
// orders with the others listed; a pair between two products that made the axis is drawn, and the rest are counted in `omitted`.
function buildBundleMatrix(sources: ViewSource[]): ViewData {
  const first = sources[0]!;
  if (sources.length !== 1 || first.tool !== "get_bundle_candidates") return bad("A bundle_matrix draws one get_bundle_candidates result; give one queryRef.");
  const d = first.result.data;
  const seen = new Map<string, BundleProduct>();
  const note = (id: string, title: string, orders: number, together: number) => {
    const p = seen.get(id) ?? { title, orders, sharedOrders: 0 };
    p.sharedOrders += together;
    seen.set(id, p);
  };
  for (const p of d.pairs) {
    note(p.productAId, p.untrusted.productA, p.ordersA, p.ordersTogether);
    note(p.productBId, p.untrusted.productB, p.ordersB, p.ordersTogether);
  }
  const ranked = [...seen].sort(([ia, a], [ib, b]) => b.sharedOrders - a.sharedOrders || a.title.localeCompare(b.title) || (ia < ib ? -1 : ia > ib ? 1 : 0)).slice(0, BUNDLE_MAX_PRODUCTS);
  const index = new Map(ranked.map(([id], i) => [id, i]));
  const pairs: BundlePair[] = [];
  for (const p of d.pairs) {
    const x = index.get(p.productAId);
    const y = index.get(p.productBId);
    if (x === undefined || y === undefined) continue;
    const common = { ordersTogether: p.ordersTogether, lift: p.lift, thin: p.ordersTogether < BUNDLE_THIN_ORDERS };
    pairs.push(x < y ? { a: x, b: y, confidenceAtoB: p.confidenceAtoB, confidenceBtoA: p.confidenceBtoA, ...common } : { a: y, b: x, confidenceAtoB: p.confidenceBtoA, confidenceBtoA: p.confidenceAtoB, ...common });
  }
  const hiddenPairs = d.pairs.length - pairs.length;
  return {
    component: "bundle_matrix",
    ordersInRange: d.ordersInRange,
    products: ranked.map(([, p]) => p),
    pairs,
    ...(hiddenPairs > 0 ? { omitted: { pairs: hiddenPairs, products: seen.size - ranked.length } } : {}),
    ...(first.result.truncated ? { truncated: first.result.truncated } : {}),
    ...(d.caveats ? { caveats: d.caveats } : {}),
    ...basisOf(sources),
  };
}

function buildMetricView(component: ViewComponent, sources: MetricViewSource[]): ViewData {
  if (component !== "kpi" && sources.length > 1) bad(`A ${component} draws one result; give one queryRef.`);
  if (sources.length > 3) bad("Give at most three results.");

  if (component !== "kpi" && component !== "table" && sources[0]!.result.data.length === 0) bad("This result has no rows to draw. Try a wider period or fewer filters.");

  const basis = basisOf(sources);
  const first = sources[0]!;
  const dims = first.input.groupBy ?? [];
  const rows = first.result.data;
  const metrics = metricsOf(first);
  const metric = metrics[0]!;

  switch (component) {
    case "kpi": {
      const cards: KpiCard[] = sources.flatMap((s) => {
        if ((s.input.groupBy ?? []).length > 0 || s.result.data.length !== 1) return bad("A KPI shows one total; this result is grouped. Use a bar or table for groups.");
        const r = s.result.data[0]!;
        return metricsOf(s)
          .filter((m) => r.values[m] !== undefined)
          .map((m): KpiCard => ({
            metric: m,
            label: METRICS[m].label,
            unit: METRICS[m].unit,
            value: r.values[m]!,
            range: s.result.range,
            ...(r.previous?.[m] !== undefined ? { previous: r.previous[m] } : {}),
            ...(r.change?.[m] !== undefined ? { change: r.change[m] } : {}),
            ...(r.pctChange && m in r.pctChange ? { pctChange: r.pctChange[m] ?? null } : {}),
            ...(r.gapToPlan?.[m as (typeof PLAN_METRICS)[number]] ? { plan: r.gapToPlan[m as (typeof PLAN_METRICS)[number]] } : {}),
          }));
      });
      return { component, cards, ...basis };
    }

    case "gauge": {
      if (dims.length > 0 || rows.length !== 1) bad("A gauge needs an ungrouped result.");
      const gaps = rows[0]!.gapToPlan;
      const items = gaps ? PLAN_METRICS.filter((m) => gaps[m]) : [];
      if (items.length === 0) bad("A gauge needs a result with gapToPlan: ask query_metric for part or all of one month, ungrouped and unfiltered, for a metric the plan has a target for.");
      const gauges: GaugeItem[] = items.map((m) => {
        const g = gaps![m]!;
        return { metric: m, label: METRICS[m].label, unit: METRICS[m].unit, actual: g.actual, planned: g.planned, target: g.target, ...(g.projected !== undefined ? { projected: g.projected } : {}), throughDate: g.throughDate };
      });
      return { component, gauges, ...basis };
    }

    case "line": {
      if (dims.length !== 1 || !TIME_DIMS.has(dims[0]!)) bad("A line needs a result grouped by day, week or month (one grouping).");
      const dim = dims[0]!;
      const points = rows.map((r) => ({ x: r.group[dim]!, y: r.values[metric] ?? 0 })).sort((a, b) => a.x.localeCompare(b.x));
      return { component, metric, label: METRICS[metric].label, unit: METRICS[metric].unit, dimension: dim, points, ...basis };
    }

    case "bar": {
      if (dims.length !== 1) bad("A bar needs a grouped result with one groupBy (for example product, channel or discount_code).");
      const bars = rows.map((r) => ({ label: labelOf(r, dims), value: r.values[metric] ?? 0, ...(r.share?.[metric] !== undefined ? { share: r.share[metric] } : {}) }));
      return { component, metric, label: METRICS[metric].label, unit: METRICS[metric].unit, dimension: dims[0]!, bars, ...(first.result.truncated ? { truncated: first.result.truncated } : {}), ...basis };
    }

    case "table": {
      const columns: TableColumn[] = [...dims.map((d) => ({ key: d, label: dimLabel(d) })), ...metrics.map((m) => ({ key: m, label: METRICS[m].label, unit: METRICS[m].unit }))];
      const out = rows.map((r) => {
        const cells: Record<string, string | number | null> = {};
        dims.forEach((d, i) => (cells[d] = i === 0 ? labelOf(r, dims) : (r.group[d] ?? "unknown")));
        for (const m of metrics) cells[m] = r.values[m] ?? null;
        return cells;
      });
      return { component, columns, rows: out, ...(first.result.truncated ? { truncated: first.result.truncated } : {}), ...basis };
    }

    case "waterfall": {
      if (!first.input.compareTo) bad("A waterfall needs a comparison: add compareTo (previous_period or previous_year).");
      if (dims.length !== 1 || TIME_DIMS.has(dims[0]!)) bad("A waterfall needs one grouping that is not a day, week or month (for example channel or product).");
      if (!METRICS[metric].additive) bad(`A waterfall needs a metric whose groups add up; ${metric} does not.`);
      if (first.result.truncated) bad("A waterfall needs every group; this result was cut short. Ask for fewer groups or a larger limit.");
      const steps = [
        { label: "Previous period", value: rows.reduce((s, r) => s + (r.previous?.[metric] ?? 0), 0), kind: "start" as const },
        ...rows.map((r) => ({ label: labelOf(r, dims), value: r.change?.[metric] ?? 0, kind: "delta" as const })),
        { label: "This period", value: rows.reduce((s, r) => s + (r.values[metric] ?? 0), 0), kind: "end" as const },
      ];
      return { component, metric, label: METRICS[metric].label, unit: METRICS[metric].unit, dimension: dims[0]!, steps, ...basis };
    }

    case "cohort":
    case "lift_dip":
    case "launch_curves":
    case "bundle_matrix":
      return bad(`A ${component} is drawn from its own tool's result, not from query_metric.`);
  }
}
