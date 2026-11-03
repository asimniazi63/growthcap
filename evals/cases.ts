import type { Db } from "../lib/db/client";
import { decideMemory, proposeMemory } from "../lib/memory/store";
import type { TenantContext } from "../lib/tenancy/context";
import type { ViewData } from "../lib/views/types";
import { readFixtureFile } from "../scripts/fixtures/load-pace";
import { metricValue, monthPeriod } from "../scripts/seed/truth.js";
import { CORE_CASES } from "./core-cases";
import { EBITDA_CASES } from "./ebitda-cases";
import { LANDING_CASES } from "./landing-cases";
import { T12_CASES } from "./t12-cases";
import { T13_CALLNOTE_CASES } from "./t13-callnote-cases";
import { T13_INVOICE_CASES } from "./t13-invoice-cases";
import { T14_CASES } from "./t14-cases";
import { T17_CASES } from "./t17-cases";
import { T18_CASES } from "./t18-cases";
import { T23_CASES } from "./t23-cases";
import { WHY_CASES } from "./why-cases";
import type { Dataset, StoreKey, Truth } from "../scripts/seed/types.js";
import type { Expectation } from "./graders";

// The eval cases. Each one pins the store's clock (`now`), asks one question of the real model against the fixture data, and
// is graded by deterministic checks. Expected numbers come from the dataset and the fixture files, read here with their own
// code and never through lib/metrics, so the agent is not graded against itself.

export interface EvalEnv {
  store: StoreKey;
  db: Db;
  ctx: TenantContext;
  dataset: Dataset;
  truth: Truth;
}

export interface EvalCase {
  id: string;
  category: string;
  store: StoreKey;
  now: string; // pins "today" for the whole case
  question: string;
  setup?: (env: EvalEnv) => Promise<void>; // runs before the question (for example, a confirmed note)
  control?: boolean; // also ask once without the setup, to show what it changed
  expect: (env: EvalEnv) => Expectation;
}

const planTarget = (store: StoreKey, month: string, column: number) => {
  const line = readFixtureFile(store, "plan.csv").split("\n").find((l) => l.startsWith(`${month},`));
  return Number(line!.split(",")[column]);
};
const adSpendCents = (store: StoreKey, month: string) =>
  readFixtureFile(store, "ad-spend.csv")
    .split("\n")
    .filter((l) => l.startsWith(`${month}-`))
    .reduce((sum, l) => sum + Number(l.split(",")[2]), 0);

export const CASES: EvalCase[] = [
  {
    id: "pace-gauge",
    category: "plan",
    store: "solenne",
    now: "2026-10-16T12:00:00-04:00",
    question: "How is this month pacing against plan? Show net sales, orders and new-customer orders as a gauge.",
    expect: (env) => {
      // "This month" runs through today (the 16th); a model may also count complete days only (the 15th). Either is right.
      const through = (to: string) => metricValue(env.dataset, "net_sales", {}, { from: "2026-10-01", to });
      const target = planTarget(env.store, "2026-10", 1);
      return {
        tools: ["query_metric", "render_view"],
        view: {
          label: "drew a gauge of net sales, orders and new-customer orders against the plan",
          component: "gauge",
          test: (data: ViewData) => {
            if (data.component !== "gauge") return "not a gauge";
            const metrics = data.gauges.map((g) => g.metric);
            for (const m of ["net_sales", "orders", "new_customer_orders"]) if (!metrics.includes(m as never)) return `missing ${m}; drew ${metrics.join(", ")}`;
            const net = data.gauges.find((g) => g.metric === "net_sales")!;
            if (net.target !== target) return `net sales target was ${net.target}, the plan says ${target}`;
            if (![through("2026-10-15"), through("2026-10-16")].includes(net.actual)) return `net sales so far was ${net.actual}, the data says ${through("2026-10-15")} through the 15th or ${through("2026-10-16")} through the 16th`;
            return net.projected === undefined ? "no month-end estimate" : null;
          },
        },
        mentions: [{ label: "calls the month-end figure an estimate", pattern: /estimate/i }],
        verified: true,
      };
    },
  },
  {
    id: "note-excludes-wholesale",
    category: "memory",
    store: "solenne",
    now: "2026-06-10T12:00:00-04:00",
    question: "What was our average order value last month?",
    control: true,
    setup: async (env) => {
      const note = await proposeMemory(env.db, env.ctx, "Exclude wholesale orders from average order value.");
      await decideMemory(env.db, env.ctx, note.id, "confirm");
    },
    expect: (env) => {
      const may = monthPeriod("2026-05");
      const withoutWholesale = metricValue(env.dataset, "aov", { exclude_tag: "wholesale" }, may) / 100;
      const withWholesale = metricValue(env.dataset, "aov", {}, may) / 100;
      return {
        numbers: [{ label: "the average order value without wholesale", value: withoutWholesale, tolerance: 0.01 }],
        // May holds the one $6,000 wholesale order (S3), so the two figures differ a great deal.
        absent: [{ label: "the figure that includes wholesale", value: withWholesale, tolerance: 0.01 }],
        toolWhere: [{ label: "left wholesale orders out of the query", tool: "query_metric", test: (i) => JSON.stringify(i).includes("excludeTags") && JSON.stringify(i).includes("wholesale") }],
        mentions: [{ label: "says wholesale orders were left out", pattern: /wholesale/i }],
        verified: true,
      };
    },
  },
  {
    id: "mer-last-month",
    category: "ads",
    store: "solenne",
    now: "2026-10-16T12:00:00-04:00",
    question: "What was our MER last month?",
    expect: (env) => {
      const mer = env.truth.monthly["2026-09"]!.net_sales / adSpendCents(env.store, "2026-09");
      return {
        tools: ["query_metric"],
        toolWhere: [{ label: "asked for the mer metric", tool: "query_metric", test: (i) => JSON.stringify(i).includes('"mer"') }],
        numbers: [{ label: "September's MER (net sales over ad spend)", value: mer, tolerance: 0.05 }],
        verified: true,
      };
    },
  },
  ...WHY_CASES,
  ...CORE_CASES,
  ...LANDING_CASES,
  ...T12_CASES,
  ...T13_CALLNOTE_CASES,
  ...T13_INVOICE_CASES,
  ...T14_CASES,
  ...T17_CASES,
  ...T18_CASES,
  ...EBITDA_CASES,
  ...T23_CASES,
];
