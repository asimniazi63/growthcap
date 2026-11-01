import type { StoreKey } from "../scripts/seed/types.js";
import type { EvalCase } from "./cases";

// The promo post-mortem cases (T17, slice 1): "was this promotion worth it?" for the storylines S6 (the leaked VIPGLOW25 code) and
// S8 (Black Friday 2025 with BFCM25). Graded like the other cases, by deterministic checks only, so a result does not depend on
// a second model's opinion.
//
// No figure is pinned. The post-mortem's baseline, the days counted as "after" and the comparison cohort are the tool's own
// choices, so a number copied from the fixtures here could disagree with a right answer. The cases check the shape of the answer
// instead: the tool was called for the right promotion, the extra sales and the net lift are in dollars, the repeat rates are
// percentages with a comparison, and the answer does not claim proof of a cause. The number checker (`verified`) then confirms
// that every figure written traces to the tool's result, which is what keeps the figures honest.
//
// The seed plants no dip after Black Friday (orders per day in the 28 days after run above the 28 days before, because December is
// busier than November), so the BFCM case asks that the answer says what happened afterwards, whether that is a dip or none. It
// does not require a dip.
//
// They cost money (the chat model and a few tool calls each). Run them only with Asim's go-ahead.

const SOLENNE: StoreKey = "solenne";

// ---- wording pieces, as regular expression source, so the checks below read as sentences

const MONEY = String.raw`\$\s?\d[\d,]*(?:\.\d+)?`;
const PCT = String.raw`\d+(?:\.\d+)?\s?%`;
const REPEAT = String.raw`(?:repeat|(?:order|ordered|buy|bought|purchase|purchased)\s+again|(?:came|come|comes)\s+back|returned|re-?order\w*|second order)`;
const LOWER = String.raw`(?:lower|less\s+(?:often|likely|loyal)|fewer|below|worse|weaker|poorer|smaller|(?:a|one)[- ](?:third|quarter|half)|half\s+as|rarely|only|trail\w*|behind|under)`;
const FIRSTISH = String.raw`(?:first[- ]time(?:\s+\w+)?|new\s+(?:buyers?|customers?|shoppers?)|first\s+orders?|new-customer)`;
const QUANTITY = String.raw`(?:most|majority|many|mostly|largely|bulk|more\s+than\s+half|over\s+half|\d+(?:\.\d+)?\s?%|\d[\d,]*\s+(?:of|out\s+of)\b|\d[\d,]*\s+(?:were\s+)?(?:first|new))`;
const OTHER = String.raw`(?:other|rest\s+of\s+the|remaining|everyone\s+else|comparison|baseline|typical|usual|regular|non-?\w+|without\s+(?:the\s+|a\s+)?(?:code|discount|promo\w*)|no\s+(?:code|discount))`;
const EXTRA = String.raw`(?:extra|additional|incremental|above\s+(?:the\s+)?(?:baseline|normal|usual|expected|typical)|more\s+than\s+(?:expected|usual|normal|the\s+baseline)|uplift|lift|on\s+top\s+of)`;
const PULLED = String.raw`(?:pulled\s+(?:\w+\s+){0,3}forward|pull[- ]?forward|dip|dipped|borrowed|came\s+out\s+of|taken\s+from|cannibali[sz]ed)`;
const NET = String.raw`(?:net\s+(?:lift|gain|effect|result|benefit|uplift|extra|incremental|add|impact)|net\s+of|after\s+(?:subtracting|taking|removing|netting|deducting|the\s+dip|the\s+pull|accounting|adjusting)|once\s+(?:the\s+|you\s+|we\s+)?(?:subtract|take|remove|net|deduct|dip|pulled)|(?:real|true|actual|overall|total)\s+(?:lift|gain|uplift|effect))`;
const AFTER_WORD = String.raw`\b(?:after|following|afterwards?|post)\b`;
const DIP_STRONG = String.raw`\b(?:dip\w*|slump\w*|pulled\s+(?:\w+\s+){0,3}forward|pull[- ]?forward|(?:no|not\s+a|without\s+a)\s+(?:visible\s+|noticeable\s+|measurable\s+|clear\s+|real\s+)?(?:drop|decline|fall))\b`;
const DIP_WEAK = String.raw`\b(?:drop\w*|fell|fall|lower|fewer|down|softer|declin\w*)\b`;

// Either order, with at most `gap` characters between the two.
const near = (a: string, b: string, gap: number) => new RegExp(String.raw`${a}[\s\S]{0,${gap}}${b}|${b}[\s\S]{0,${gap}}${a}`, "i");

export const EXTRA_IN_DOLLARS = near(EXTRA, MONEY, 140);
export const NET_OR_PULLED_IN_DOLLARS = near(`(?:${NET}|${PULLED})`, MONEY, 160);
// Two percentages and a word for repeat buying in one stretch of text: the cohort's rate and the comparison's, in any order.
export const TWO_REPEAT_RATES = new RegExp(
  [`${REPEAT}[\\s\\S]{0,200}${PCT}[\\s\\S]{0,200}${PCT}`, `${PCT}[\\s\\S]{0,200}${REPEAT}[\\s\\S]{0,200}${PCT}`, `${PCT}[\\s\\S]{0,200}${PCT}[\\s\\S]{0,200}${REPEAT}`].join("|"),
  "i",
);
export const REPEAT_IS_LOWER = near(REPEAT, LOWER, 200);
// "most of its orders were first orders", "20 of 25 were new customers" or "20 first-time buyers".
export const MANY_FIRST_TIME = new RegExp(`${near(QUANTITY, FIRSTISH, 100).source}|\\b\\d[\\d,]*\\s+${FIRSTISH}`, "i");
export const VERSUS_OTHER_NEW_CUSTOMERS = near(OTHER, FIRSTISH, 80);
// A dip, sales pulled forward or an explicit "no dip" on their own; or a weaker word for a fall near "after".
export const AFTER_PERIOD = new RegExp(`${DIP_STRONG}|${near(AFTER_WORD, DIP_WEAK, 140).source}`, "i");

// "Proves the code caused it", "definitely because of the leak" and the like are a claim of proof. "does not prove", "can't prove",
// "no proof" and "not necessarily prove" are the right hedges and are let through by the lookbehinds.
export const CLAIMS_PROOF =
  /(?<!\bnot\s)(?<!n['’]t\s)(?<!\bcannot\s)(?<!\bno\s)(?<!\bnecessarily\s)\b(?:proves?|proved|proven|proof|conclusively|definitively)\b[^.\n]{0,80}\b(?:caus\w+|because|due\s+to|led\s+to|drove|brought|responsible)|\b(?:definitely|certainly|undoubtedly|without\s+(?:a\s+)?doubt)\b[^.\n]{0,40}\b(?:caus\w+|because|due\s+to|the\s+reason)/i;

// A repeat rate written as the raw fraction the tool returns (0.2224) instead of a percentage (22.2%).
export const RAW_FRACTION_RATE = /\b(?:repeat\w*|ordered again|came back)\b[^\n]{0,60}\b0\.\d{2,}\b(?!\s*%|\d)|\b0\.\d{2,}\b(?!\s*%|\d)[^\n]{0,60}\b(?:repeat\w*|ordered again|came back)\b/i;

const hedged = { label: "does not claim the numbers prove the code caused the result", pattern: CLAIMS_PROOF };
const percentages = { label: "writes repeat rates as percentages, not raw fractions", pattern: RAW_FRACTION_RATE };

export const T17_CASES: EvalCase[] = [
  {
    // S6: VIPGLOW25 leaked on 2026-08-04. Every one of its first-time buyers placed their first order from 08-04 to 08-31, and their
    // 30-day repeat rate is about a third of other first-time buyers'. The code was also used by existing customers from March to
    // October, so the question names August (as the S6 storyline case does). With the code alone the tool's window is March to
    // October and its comparison is February's first-time buyers, and on the fixtures the gap then turns the other way (worked out
    // by hand from dataset.json, not through the tool: February's first-time buyers almost never reordered). The tool's description
    // asks for from and to for a burst inside a longer-running code, and the toolWhere below checks that the model gives them.
    id: "postmortem-vipglow25",
    category: "promo",
    store: SOLENNE,
    now: "2026-09-10T12:00:00-04:00",
    question: "Was the VIPGLOW25 code worth it in August?",
    expect: () => ({
      tools: ["get_promo_postmortem"],
      toolWhere: [
        { label: "ran the post-mortem on the VIPGLOW25 code", tool: "get_promo_postmortem", test: (i) => /VIPGLOW25/i.test(JSON.stringify(i)) },
        {
          label: "gave the August window (from and to) rather than the code's whole life",
          tool: "get_promo_postmortem",
          test: (i) => {
            const w = i as { from?: string; to?: string };
            return w.from?.startsWith("2026-08") === true && w.to?.startsWith("2026-08") === true;
          },
        },
      ],
      mentions: [
        { label: "names the VIPGLOW25 code", pattern: /VIPGLOW25/i },
        { label: "says how many of the code's buyers were first-time customers", pattern: MANY_FIRST_TIME },
        { label: "gives the extra sales above the baseline in dollars", pattern: EXTRA_IN_DOLLARS },
        { label: "gives the net lift or the sales pulled forward in dollars", pattern: NET_OR_PULLED_IN_DOLLARS },
        { label: "gives two repeat rates as percentages (the code's buyers and the comparison)", pattern: TWO_REPEAT_RATES },
        { label: "says the code's first-time buyers came back less often", pattern: REPEAT_IS_LOWER },
        { label: "compares them with other first-time customers", pattern: VERSUS_OTHER_NEW_CUSTOMERS },
      ],
      avoid: [hedged, percentages],
      verified: true,
    }),
  },
  {
    // S8: Black Friday 2025 (2025-11-28 to 12-01) with BFCM25 at 25% off: about 5x daily orders, and the cohort's 180-day repeat rate is
    // lower than that of WELCOME10 customers who first ordered from 2025-09-01 to 2026-04-30. The question asks about six months so
    // the model uses the 180-day window the storyline plants. The tool's default comparison (the 28 days before) also has the
    // promotion's customers lower, at 30, 60 and 180 days (worked out by hand from dataset.json), so the model need not pick the
    // storyline's comparison range.
    id: "postmortem-bfcm25",
    category: "promo",
    store: SOLENNE,
    now: "2026-11-02T12:00:00-05:00",
    question: "Was last year's 25% Black Friday promotion worth it? I care about whether those customers came back within six months.",
    expect: () => ({
      tools: ["get_promo_postmortem"],
      toolWhere: [
        { label: "ran the post-mortem on BFCM25 or the Black Friday 2025 dates", tool: "get_promo_postmortem", test: (i) => /BFCM25|2025-11-2\d|2025-11-30|2025-12-0\d/i.test(JSON.stringify(i)) },
        { label: "asked for the 180-day repeat window", tool: "get_promo_postmortem", test: (i) => (i as { repeatWindowDays?: number }).repeatWindowDays === 180 },
      ],
      mentions: [
        { label: "says orders spiked during the promotion", pattern: /\b(?:spike\w*|jump\w*|surg\w*|soar\w*|rose|rise|climb\w*|increas\w*|boost\w*|lift\w*|extra|more)\b[^\n]{0,100}\borders?\b|\borders?\b[^\n]{0,100}\b(?:spike\w*|jump\w*|surg\w*|soar\w*|rose|up|increas\w*|above|\d+(?:\.\d+)?\s?x|times|multiple|more)\b/i },
        { label: "gives the extra sales above the baseline in dollars", pattern: EXTRA_IN_DOLLARS },
        { label: "says what happened after the promotion (a dip, sales pulled forward, or no dip)", pattern: AFTER_PERIOD },
        { label: "gives the net lift or the sales pulled forward in dollars", pattern: NET_OR_PULLED_IN_DOLLARS },
        { label: "gives two repeat rates as percentages (the promotion's customers and the comparison)", pattern: TWO_REPEAT_RATES },
        { label: "says the promotion's customers came back less often", pattern: REPEAT_IS_LOWER },
      ],
      avoid: [hedged, percentages],
      verified: true,
    }),
  },
];
