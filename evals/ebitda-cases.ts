import { parseCosts } from "../scripts/fixtures/load-costs";
import { readFixtureFile } from "../scripts/fixtures/load-pace";
import type { StoreKey } from "../scripts/seed/types.js";
import type { EvalCase, EvalEnv } from "./cases";
import type { Expectation } from "./graders";

// The EBITDA cases (T22): what a month's EBITDA is made of, and a what-if on ad spend. Graded like the other cases, by deterministic
// checks only. The expected operating costs are read from costs.csv with the loader's own parser, never through lib/ebitda or
// lib/tools, so the agent is not graded against itself. The eval database gets the cost sheet in evals/run.ts.
//
// They call the chat model, so they cost money. Run them only with Asim's go-ahead.

const SOLENNE: StoreKey = "solenne";
const NOW = "2026-11-02T12:00:00-05:00";

// What the cost sheet says a month's operating costs came to, in the dollars an answer states them in.
const operatingCostsDollars = (store: StoreKey, month: string) =>
  parseCosts(readFixtureFile(store, "costs.csv"))
    .filter((r) => r.month === month)
    .reduce((sum, r) => sum + r.amountCents, 0) / 100;

// Both lines are called assumed: "card fees ... assumed" or "assumed ... card fees", and the same for fulfilment, within a sentence or
// so either way round. The prompt asks for the word "assumed".
const assumed = (line: string) => `(?:${line}[\\s\\S]{0,160}(?:assum|estimat)|(?:assum|estimat)[\\s\\S]{0,160}${line})`;
const ASSUMED_RATES = new RegExp(`(?=[\\s\\S]*${assumed("card fees?")})(?=[\\s\\S]*${assumed("fulfil\\w*")})`, "i");

// A negation shortly before a phrase ("not free money", "nothing comes for free") turns the claim round, so it is not one.
const NOT_NEGATED = "(?<!(?:\\bnot|n't|\\bnever|\\bnothing)[^.!?]{0,30})";

// An answer that treats the cut as free: no loss of sales, no cost, no downside. Cutting ads would always look like this without the
// rule that fewer ads lose new-customer orders. "No impact on returning-customer orders" is true under that rule, so it is not caught.
const CALLS_THE_CUT_FREE = new RegExp(
  [
    "\\bno (?:impact|effect|change) (?:at all )?(?:on|in|to) (?:your |our |the )?(?:total |overall )?(?:orders|sales|revenue|volume|new[- ]customer|customer acquisition)",
    "\\bcosts? (?:you |us )?nothing\\b",
    "\\bno downside\\b",
    `${NOT_NEGATED}\\b(?:for free|free money|pure (?:savings?|profit|upside))\\b`,
    "\\bwithout (?:losing|any loss of) (?:any )?(?:orders|sales|customers|revenue|new[- ]customer)",
  ].join("|"),
  "i",
);

export const EBITDA_CASES: EvalCase[] = [
  {
    // August 2026: the cost sheet holds software and contractors for the month, so its operating costs are a figure the answer can be checked on.
    id: "ebitda-solenne-august",
    category: "ebitda",
    store: SOLENNE,
    now: NOW,
    question: "What was Solenne's EBITDA in August 2026, and what is it made of?",
    expect: (env: EvalEnv): Expectation => ({
      tools: ["get_ebitda"],
      numbers: [{ label: "August's operating costs from the cost sheet", value: operatingCostsDollars(env.store, "2026-08"), tolerance: 0.01 }],
      mentions: [{ label: "says card fees and fulfilment are assumed rates", pattern: ASSUMED_RATES }],
      verified: true,
    }),
  },
  {
    // Cutting ads must not look free: the tool takes new-customer orders away with the ad spend, and the answer says that is an assumption.
    id: "ebitda-ads-cut",
    category: "ebitda",
    store: SOLENNE,
    now: NOW,
    question: "What happens to our profit if we cut ad spend by 20%?",
    expect: (): Expectation => ({
      tools: ["get_ebitda_scenario"],
      toolWhere: [
        {
          label: "passed the 20% cut as a fraction (adSpendChange -0.2)",
          tool: "get_ebitda_scenario",
          test: (input) => typeof input === "object" && input !== null && (input as { adSpendChange?: unknown }).adSpendChange === -0.2,
        },
      ],
      mentions: [{ label: "says fewer ads lose new-customer orders, or that this is an assumption", pattern: /new[- ]customer|assum/i }],
      avoid: [{ label: "does not call the cut free", pattern: CALLS_THE_CUT_FREE }],
      verified: true,
    }),
  },
];
