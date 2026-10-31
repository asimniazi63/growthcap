import { readFixtureFile } from "../scripts/fixtures/load-pace";
import { loadCalendar, loadCallNotes, readCallNoteFiles } from "../scripts/fixtures/load-why";
import type { StoreKey } from "../scripts/seed/types.js";
import type { EvalCase, EvalEnv } from "./cases";
import type { Expectation } from "./graders";

// The "why" cases (T7): "why did we miss plan in <month>?" for the storylines S4, S5, S7 and S9, and for a month where nothing
// was planted, where the answer must not invent a cause. Graded like the other cases, by deterministic checks: the expected
// figures come from truth.json and plan.csv (never from lib/why), and the causes and the cited call note are patterns. No
// judge model is used, so a result does not depend on a second model's opinion.
//
// They cost money (the chat model plus three investigators and a synthesis call each). Run them with the T11 eval, not before.

const SOLENNE: StoreKey = "solenne";

// The calendar and the call notes are loaded for the brand before the question (idempotent), as `fixtures:load` does.
const withCalendarAndNotes = async (env: EvalEnv) => {
  await loadCalendar(env.db, env.ctx.tenantId, readFixtureFile(env.store, "calendar.csv"));
  await loadCallNotes(env.db, env.ctx.tenantId, readCallNoteFiles(env.store));
};

const planNetSales = (store: StoreKey, month: string) => Number(readFixtureFile(store, "plan.csv").split("\n").find((l) => l.startsWith(`${month},`))!.split(",")[1]);
// How far the month finished from plan, in dollars (positive when behind), from truth.json's net sales and the plan file.
const shortfall = (env: EvalEnv, month: string) => (planNetSales(env.store, month) - env.truth.monthly[month]!.net_sales) / 100;

const note = (title: RegExp, date: RegExp, what: string): NonNullable<Expectation["mentions"]> => [
  { label: `cites the ${what} by its title`, pattern: title },
  { label: `cites the ${what} by its date`, pattern: date },
];

const askedAbout = (month: string): NonNullable<Expectation["toolWhere"]> => [
  { label: `called explain_gap for ${month}`, tool: "explain_gap", test: (i) => ((i as { month?: string }).month ?? month) === month },
];

export const WHY_CASES: EvalCase[] = [
  {
    // S9: the Meta prospecting budget was cut by 40% from 2026-10-05; new-customer orders were 34 against a plan of 44.
    id: "why-october-meta-cut",
    category: "why",
    store: SOLENNE,
    now: "2026-11-02T12:00:00-05:00",
    question: "Why did we miss plan in October?",
    setup: withCalendarAndNotes,
    expect: (env) => ({
      tools: ["explain_gap"],
      toolWhere: askedAbout("2026-10"),
      numbers: [
        { label: "the October shortfall to plan", value: shortfall(env, "2026-10"), tolerance: 0.5 },
        { label: "October's new-customer orders", value: env.truth.monthly["2026-10"]!.new_customer_orders, tolerance: 0 },
      ],
      mentions: [
        { label: "names new-customer orders as the main drag", pattern: /new[- ]customer/i },
        { label: "names the Meta prospecting budget cut", pattern: /meta[\s\S]{0,80}(budget|prospecting)|(budget|prospecting)[\s\S]{0,80}meta/i },
        ...note(/Q4 budget and planning/i, /2026-10-01|October 1\b|Oct\.? 1\b|1 Oct/i, "Q4 budget call note"),
      ],
      verified: true,
    }),
  },
  {
    // S7: the Hero Vitamin C Serum was out of stock from 09-03 to 09-13 (a supplier delay, in the 2026-08-27 call note).
    id: "why-september-serum-stockout",
    category: "why",
    store: SOLENNE,
    now: "2026-10-10T12:00:00-04:00",
    question: "Why did we miss plan in September?",
    setup: withCalendarAndNotes,
    expect: (env) => ({
      tools: ["explain_gap"],
      toolWhere: askedAbout("2026-09"),
      numbers: [{ label: "the September shortfall to plan", value: shortfall(env, "2026-09"), tolerance: 0.5 }],
      mentions: [
        { label: "names the Hero Vitamin C Serum", pattern: /vitamin c serum|hero serum/i },
        { label: "says it was out of stock or had no sales", pattern: /out of stock|stock-?out|ran out|no sales|unavailable|delay/i },
        ...note(/supply check-in/i, /2026-08-27|August 27\b|Aug\.? 27\b|27 Aug/i, "supply call note"),
      ],
      verified: true,
    }),
  },
  {
    // S4: a bad Barrier Cream batch, refunded for "skin reaction" from 06-08 to 06-28 (refund rate about 4% to about 19%).
    id: "why-june-barrier-cream-refunds",
    category: "why",
    store: SOLENNE,
    now: "2026-07-06T12:00:00-04:00",
    question: "Why did we miss plan in June?",
    setup: withCalendarAndNotes,
    expect: (env) => ({
      tools: ["explain_gap"],
      toolWhere: askedAbout("2026-06"),
      numbers: [{ label: "the June shortfall to plan", value: shortfall(env, "2026-06"), tolerance: 0.5 }],
      mentions: [
        { label: "names the Barrier Cream", pattern: /barrier cream/i },
        { label: "says refunds were the problem", pattern: /refund/i },
      ],
      verified: true,
    }),
  },
  {
    // S5: the Lip Tint 'Fig' went viral on 07-10, sold out after 07-18 and was restocked on 08-05. Its effect on July's small gap
    // is the faintest of the five, so this is the hardest case: the cause has to come from the data, not from a call note.
    id: "why-july-fig-sellout",
    category: "why",
    store: SOLENNE,
    now: "2026-08-06T12:00:00-04:00",
    question: "Why did we miss plan in July?",
    setup: withCalendarAndNotes,
    expect: (env) => ({
      tools: ["explain_gap"],
      toolWhere: askedAbout("2026-07"),
      numbers: [{ label: "the July shortfall to plan", value: shortfall(env, "2026-07"), tolerance: 0.5 }],
      mentions: [
        { label: "names the Lip Tint in Fig", pattern: /\bfig\b/i },
        { label: "says it went viral or sold out", pattern: /viral|sold out|out of stock|stock-?out|ran out|no sales|restock/i },
      ],
      verified: true,
    }),
  },
  {
    // April 2026: nothing was planted, and net sales finished $14.00 behind plan. The answer must not invent a cause.
    id: "why-april-nothing-planted",
    category: "why",
    store: SOLENNE,
    now: "2026-05-06T12:00:00-04:00",
    question: "Why did we miss plan in April?",
    setup: withCalendarAndNotes,
    expect: (env) => ({
      tools: ["explain_gap"],
      toolWhere: askedAbout("2026-04"),
      numbers: [{ label: "the April shortfall to plan", value: shortfall(env, "2026-04"), tolerance: 0.5 }],
      mentions: [
        {
          label: "says no clear cause was found, or that the miss is small",
          pattern: /no (clear|specific|single|obvious|known|particular|real)\b[^.]{0,40}(cause|driver|reason|explanation)|(did not|didn't|could not|couldn't|unable to|not able to) (find|identify|point)|nothing (stands out|unusual|notable)|\b(small|slight|marginal|tiny|negligible)\b|(close|near|nearly|essentially|virtually|almost)\b[^.]{0,20}\bplan/i,
        },
        {
          // A negative lookahead: passes only when none of the other storylines' causes appear in the answer.
          label: "names no cause from another month (budget cut, stock-out, viral product, bad batch, leaked code)",
          pattern: /^(?![\s\S]*(budget (cut|reduc)|meta prospecting|stock-?out|out of stock|sold out|supplier|viral|skin reaction|barrier cream|vitamin c serum|\bfig\b|vipglow|bfcm))[\s\S]*$/i,
        },
      ],
      verified: true,
    }),
  },
];
