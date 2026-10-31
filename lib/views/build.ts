import { AppError } from "../errors";
import type { MetricRow, QueryMetricInput } from "../metrics/query";
import { METRICS, type MetricId } from "../metrics/registry";
import { PLAN_METRICS } from "../pace/metrics";
import type { ToolResult } from "../tools/result";
import { VIEW_COMPONENTS, type Basis, type GaugeItem, type KpiCard, type TableColumn, type ViewComponent, type ViewData } from "./types";

// Turns tool results into what a component draws. The numbers are copied from the results; nothing here accepts a value
// from the model. Used when the model asks for a view, and again when a pinned view re-runs its queries.

export interface ViewSource {
  tool: string;
  input: QueryMetricInput;
  result: ToolResult<MetricRow[]>;
}

const TIME_DIMS = new Set(["day", "week", "month"]);
const bad = (message: string): never => {
  throw new AppError("INVALID_INPUT", message);
};
const dimLabel = (dim: string) => dim.charAt(0).toUpperCase() + dim.slice(1).replace(/_/g, " ");
const metricsOf = (s: ViewSource): MetricId[] => [...new Set(s.input.metrics)];

function labelOf(row: MetricRow, dims: string[]): string {
  const dim = dims[0]!;
  const u = row.untrusted;
  if (dim === "variant" && u?.variant) return [u.product, u.variant].filter(Boolean).join(" ");
  if (dim === "product" && u?.product) return u.product;
  return row.group[dim] ?? "unknown";
}

function basisOf(sources: ViewSource[]): Basis {
  return {
    queryIds: sources.map((s) => s.result.queryId),
    range: { from: sources.map((s) => s.result.range.from).sort()[0]!, to: sources.map((s) => s.result.range.to).sort().at(-1)! },
    asOf: sources.map((s) => s.result.asOf).sort().at(-1)!,
  };
}

export function buildView(component: ViewComponent, sources: ViewSource[]): ViewData {
  if (!(VIEW_COMPONENTS as readonly string[]).includes(component)) bad(`component must be one of ${VIEW_COMPONENTS.join(", ")}.`);
  if (sources.length === 0) bad("Give at least one result to draw (a query id from this turn).");
  if (sources.some((s) => s.tool !== "query_metric")) bad("Views are drawn from query_metric results only.");
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
  }
}
