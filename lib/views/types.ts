import type { PlanGap } from "../pace/gap";
import type { MetricId, MetricUnit } from "../metrics/registry";

// The seven components a chat answer can draw. The set is closed: render_view rejects anything else.
export const VIEW_COMPONENTS = ["kpi", "line", "bar", "table", "gauge", "waterfall", "cohort"] as const;
export type ViewComponent = (typeof VIEW_COMPONENTS)[number];

export interface Basis {
  queryIds: string[];
  range: { from: string; to: string };
  asOf: string;
}

// Every figure here was read from a tool result by the server; the model only chose the component, a title and which
// results to draw. Money is in cents and a rate is a fraction, as in the results. Labels from the store (product titles)
// are store text: rendered as text and never as markup.
export interface KpiCard {
  metric: MetricId;
  label: string;
  unit: MetricUnit;
  value: number;
  range: { from: string; to: string }; // the period this card is for, so cards from different periods can be told apart
  previous?: number;
  change?: number;
  pctChange?: number | null;
  plan?: PlanGap;
}
export interface GaugeItem {
  metric: MetricId;
  label: string;
  unit: MetricUnit;
  actual: number;
  planned: number;
  target: number;
  projected?: number;
  throughDate: string;
}
export interface TableColumn {
  key: string;
  label: string;
  unit?: MetricUnit; // set for a metric column
}

// One row of the cohort grid: the customers whose first order was in `cohort`, and how many of them ordered again within each
// number of 30-day months. A null share means nobody in the cohort is old enough yet to be counted.
export interface CohortRow {
  cohort: string; // YYYY-MM
  cohortCustomers: number;
  cells: { monthsSince: number; customers: number; repeaters: number; repeatShare: number | null }[];
}

export type ViewData =
  | ({ component: "kpi"; cards: KpiCard[] } & Basis)
  | ({ component: "gauge"; gauges: GaugeItem[] } & Basis)
  | ({ component: "line"; metric: MetricId; label: string; unit: MetricUnit; dimension: string; points: { x: string; y: number }[] } & Basis)
  | ({ component: "bar"; metric: MetricId; label: string; unit: MetricUnit; dimension: string; bars: { label: string; value: number; share?: number }[]; truncated?: { shown: number; total: number } } & Basis)
  | ({ component: "table"; columns: TableColumn[]; rows: Record<string, string | number | null>[]; truncated?: { shown: number; total: number } } & Basis)
  | ({ component: "cohort"; windowMonths: number[]; rows: CohortRow[]; firstOrderCode?: string } & Basis)
  | ({ component: "waterfall"; metric: MetricId; label: string; unit: MetricUnit; dimension: string; steps: { label: string; value: number; kind: "start" | "delta" | "end" }[] } & Basis);

// What the model asks for. `queryRefs` are query ids from this turn's tool results.
export interface ViewSpec {
  component: ViewComponent;
  title: string;
  queryRefs: string[];
}

// What re-runs a view: the tool and the input that produced each result. Pinned views keep these, never the data.
export interface ViewSourceRef {
  tool: string;
  input: unknown;
}

// What goes to the browser for one view.
export interface ViewPayload {
  id: string;
  component: ViewComponent;
  title: string;
  data: ViewData;
  sources: ViewSourceRef[];
}
