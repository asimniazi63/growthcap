import type { PlanGap } from "../pace/gap";
import type { MetricId, MetricUnit } from "../metrics/registry";

// The ten components a chat answer can draw. The set is closed: render_view rejects anything else.
export const VIEW_COMPONENTS = ["kpi", "line", "bar", "table", "gauge", "waterfall", "cohort", "lift_dip", "launch_curves", "bundle_matrix"] as const;
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

// get_promo_postmortem as three level bars: the average day before the window, in it, and after it. The result has period totals
// and per-day rates, not a daily series, so nothing here is a daily curve. Money is in cents. Every field is copied from the
// result except the two `perDayCents` for the window and the days after, which are the period's net sales over its days (the
// baseline's own rate comes with the result).
export interface LiftDipData {
  code?: string; // store text
  baseline: { from: string; to: string; days: number; netSalesCents: number; perDayCents: number };
  window: { from: string; to: string; days: number; netSalesCents: number; perDayCents: number; expectedNetSalesCents: number };
  after: { from: string; to: string; daysObserved: number; fullyObserved: boolean; netSalesCents: number; perDayCents: number; expectedNetSalesCents: number };
  extraNetSalesCents: number; // window minus expected; negative when the window sold less than the baseline pace
  pulledForwardNetSalesCents: number; // never below 0
  netLiftNetSalesCents: number; // extra minus pulled forward
  customers: {
    repeatWindowDays: number;
    promo: { cohortCustomers: number; customers: number; repeatRate: number | null };
    comparison: { cohortCustomers: number; customers: number; repeatRate: number | null };
    repeatRateGap: number | null;
  };
  caveats?: string[];
}

// get_launch_curves as small multiples. Each launch's weeks carry the cumulative units of the result; a week with fewer than
// seven days observed is a partial one.
export interface LaunchCard {
  title: string; // store text, or "Untitled product"
  launchDate: string;
  daysObserved: number;
  fullyObserved: boolean;
  totalUnits: number;
  weeks: { week: number; daysObserved: number; units: number; cumulativeUnits: number }[];
}
export interface LaunchBenchmarkWeek {
  week: number;
  medianCumulativeUnits: number;
  launches: number;
}

// get_bundle_candidates as a heat matrix. `products` are the products in the pairs drawn, most shared orders first; a pair
// points at two of them by index (a < b). confidenceAtoB is the share of orders with products[a] that also had products[b].
export const BUNDLE_THIN_ORDERS = 8; // fewer orders together than this is a thin signal
export const BUNDLE_MAX_PRODUCTS = 12;
export interface BundleProduct {
  title: string; // store text
  orders: number; // orders that hold this product
  sharedOrders: number; // orders together summed over the pairs listed with it: what the axis is ordered by
}
export interface BundlePair {
  a: number;
  b: number;
  ordersTogether: number;
  confidenceAtoB: number;
  confidenceBtoA: number;
  lift: number;
  thin: boolean;
}

export type ViewData =
  | ({ component: "kpi"; cards: KpiCard[] } & Basis)
  | ({ component: "gauge"; gauges: GaugeItem[] } & Basis)
  | ({ component: "line"; metric: MetricId; label: string; unit: MetricUnit; dimension: string; points: { x: string; y: number }[] } & Basis)
  | ({ component: "bar"; metric: MetricId; label: string; unit: MetricUnit; dimension: string; bars: { label: string; value: number; share?: number }[]; truncated?: { shown: number; total: number } } & Basis)
  | ({ component: "table"; columns: TableColumn[]; rows: Record<string, string | number | null>[]; truncated?: { shown: number; total: number } } & Basis)
  | ({ component: "cohort"; windowMonths: number[]; rows: CohortRow[]; firstOrderCode?: string } & Basis)
  | ({ component: "lift_dip" } & LiftDipData & Basis)
  | ({ component: "launch_curves"; benchmark: LaunchBenchmarkWeek[]; launches: LaunchCard[]; truncated?: { shown: number; total: number }; caveats?: string[] } & Basis)
  | ({ component: "bundle_matrix"; ordersInRange: number; products: BundleProduct[]; pairs: BundlePair[]; omitted?: { pairs: number; products: number }; truncated?: { shown: number; total: number }; caveats?: string[] } & Basis)
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
