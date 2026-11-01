import { playbookQuestion } from "../lib/playbooks/definitions";
import type { StoreKey } from "../scripts/seed/types.js";
import type { EvalCase } from "./cases";
import { askedAbout, shortfall, withCalendarAndNotes } from "./why-cases";

// The playbook case (T18): the monthly business review for October, asked with the exact question a playbook run sends, must
// name the Meta prospecting budget cut (storyline S9). Graded like the why cases, with the same expected figures from truth.json
// and plan.csv, and the same pattern for the cut. No judge model is used.
//
// The retention check is the second case: it must trace every figure (it once wrote the raw fraction 0.2224... and a change in
// points that no tool returned, and was blocked).
//
// They cost money (the monthly review also runs explain_gap's investigators and its synthesis call). Run them only with Asim's go-ahead.

const SOLENNE: StoreKey = "solenne";
const NOW = "2026-11-02T12:00:00-05:00";

export const T18_CASES: EvalCase[] = [
  {
    // S9: the Meta prospecting budget was cut by 40% from 2026-10-05; new-customer orders were 34 against a plan of 44.
    id: "playbook-monthly-review-october",
    category: "playbook",
    store: SOLENNE,
    now: NOW,
    question: playbookQuestion("monthly-review", { month: "2026-10" }, new Date(NOW)),
    setup: withCalendarAndNotes,
    expect: (env) => ({
      tools: ["query_metric", "explain_gap"],
      toolWhere: askedAbout("2026-10"),
      numbers: [
        { label: "the October shortfall to plan", value: shortfall(env, "2026-10"), tolerance: 0.5 },
        { label: "October's new-customer orders", value: env.truth.monthly["2026-10"]!.new_customer_orders, tolerance: 0 },
      ],
      mentions: [
        { label: "names new-customer orders as the main drag", pattern: /new[- ]customer/i },
        { label: "names the Meta prospecting budget cut", pattern: /meta[\s\S]{0,80}(budget|prospecting)|(budget|prospecting)[\s\S]{0,80}meta/i },
      ],
      verified: true,
    }),
  },
  {
    id: "playbook-retention-check",
    category: "playbook",
    store: SOLENNE,
    now: NOW,
    question: playbookQuestion("retention-check", {}, new Date(NOW)),
    expect: () => ({
      tools: ["get_cohorts", "query_metric"],
      mentions: [
        { label: "gives the repeat rate as a percentage", pattern: /\d+(\.\d+)?%[\s\S]{0,60}(ordered again|repeat)/i },
        { label: "says how many customers were counted", pattern: /\d[\d,]* customers/i },
      ],
      verified: true,
    }),
  },
];
