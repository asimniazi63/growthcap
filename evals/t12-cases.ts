import { readFixtureFile } from "../scripts/fixtures/load-pace";
import { metricValue, monthPeriod } from "../scripts/seed/truth.js";
import type { StoreKey } from "../scripts/seed/types.js";
import type { EvalCase, EvalEnv } from "./cases";
import type { Expectation } from "./graders";

// The T12 cases: a cohort grid, a payback, and "how much a day do we need to hit plan?". Graded like the other cases, by
// deterministic checks only. Expected figures come from the dataset (the seed's truth helpers), plan.csv and ad-spend.csv, read
// here with their own code and never through lib/metrics or lib/tools, so the agent is not graded against itself.
//
// They call the chat model, so they cost money. Run them with the T11 eval, not before. Not yet registered in CASES.

const SOLENNE: StoreKey = "solenne";

const planNetSalesTarget = (store: StoreKey, month: string) => Number(readFixtureFile(store, "plan.csv").split("\n").find((l) => l.startsWith(`${month},`))!.split(",")[1]);
const adSpendCents = (store: StoreKey, month: string) =>
  readFixtureFile(store, "ad-spend.csv")
    .split("\n")
    .filter((l) => l.startsWith(`${month}-`))
    .reduce((sum, l) => sum + Number(l.split(",")[2]), 0);

// A dollar amount as a model writes it: "$5,421.33" or "$5,421" (whole dollars are the amount rounded or cut, never a different figure).
function dollars(cents: number): string {
  const exact = (cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const whole = Math.round(cents / 100).toLocaleString("en-US");
  return `(?<![\\d.,])\\$?(?:${exact.replace(/[.]/g, "\\.")}|${whole}(?![\\d,]|\\.\\d))`;
}

export const T12_CASES: EvalCase[] = [
  {
    // A grid of the 30, 60 and 90-day repeat share for each first-order month from January to June 2026.
    id: "cohort-grid-first-half",
    category: "cohorts",
    store: SOLENNE,
    now: "2026-11-02T12:00:00-05:00",
    question: "Show me a cohort grid of repeat rate by first-order month for the first half of 2026, for the first three months after a first order.",
    expect: (env: EvalEnv): Expectation => ({
      tools: ["get_cohorts", "render_view"],
      view: {
        label: "drew a cohort grid whose cells equal the repeat rate in the data",
        component: "cohort",
        test: (data) => {
          if (data.component !== "cohort") return "not a cohort grid";
          for (const month of ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"]) {
            const row = data.rows.find((r) => r.cohort === month);
            if (!row) return `no row for ${month}; drew ${data.rows.map((r) => r.cohort).join(", ")}`;
            for (const k of [1, 2, 3]) {
              const cell = row.cells.find((c) => c.monthsSince === k);
              if (!cell) return `${month} has no cell for ${k} month(s) since`;
              const expected = metricValue(env.dataset, "repeat_rate", { window_days: String(30 * k) }, monthPeriod(month));
              if (cell.repeatShare === null || Math.abs(cell.repeatShare - expected) > 0.0001) return `${month} within ${30 * k} days was ${cell.repeatShare}, the data says ${expected}`;
            }
          }
          return null;
        },
      },
      mentions: [{ label: "says what the shading means or that a month is 30 days", pattern: /30[- ]day|shad|darker|ordered again|repeat/i }],
      verified: true,
    }),
  },
  {
    // Payback: the new-customer CAC for a month is ad spend over new-customer orders, from ad-spend.csv and the dataset.
    id: "payback-september-cohort",
    category: "unit-economics",
    store: SOLENNE,
    now: "2026-11-02T12:00:00-05:00",
    question: "What did it cost us to win a new customer in September 2026, and how many months does a September customer take to pay that back in gross margin?",
    expect: (env: EvalEnv): Expectation => {
      const newCustomers = metricValue(env.dataset, "new_customer_orders", {}, monthPeriod("2026-09"));
      const cac = adSpendCents(env.store, "2026-09") / newCustomers / 100;
      return {
        tools: ["get_unit_economics"],
        numbers: [{ label: "September's new-customer CAC", value: cac, tolerance: 0.011 }],
        mentions: [
          { label: "talks about payback in months, or says it has not paid back yet", pattern: /pa(?:id|y|ys|ying)[- ]?(?:it )?back|payback|not yet|within (?:its|the|their) (?:own|first) month|\bmonths?\b/i },
          { label: "says the cost of goods is today's unit cost", pattern: /today'?s (?:unit )?cost|current (?:unit )?cost|latest (?:unit )?cost/i },
        ],
        verified: true,
      };
    },
  },
  {
    // "Need $X a day": the remaining target over the days left, from the plan gap the tool returns.
    id: "need-per-day-october",
    category: "plan",
    store: SOLENNE,
    now: "2026-10-16T12:00:00-04:00",
    question: "How much net sales a day do we need for the rest of the month to hit plan?",
    expect: (env: EvalEnv): Expectation => {
      const target = planNetSalesTarget(env.store, "2026-10");
      // Through the 15th (complete days, 16 left) or through the 16th (15 left): either is right.
      const need = (throughDay: number) => Math.round((target - metricValue(env.dataset, "net_sales", {}, { from: "2026-10-01", to: `2026-10-${String(throughDay).padStart(2, "0")}` })) / (31 - throughDay));
      return {
        tools: ["query_metric"],
        mentions: [{ label: "states the daily need for the rest of the month", pattern: new RegExp(`${dollars(need(15))}|${dollars(need(16))}`) }],
        avoid: [{ label: "does not say the month's target is already met", pattern: /already (?:met|hit|reached)|target (?:is )?met/i }],
        verified: true,
      };
    },
  },
];
