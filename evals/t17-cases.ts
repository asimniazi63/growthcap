import type { Dataset, StoreKey } from "../scripts/seed/types.js";
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
// Slice 2 adds three cases, for the retention segments (`segments-at-risk`), the bundle candidates (`bundles-bought-together`) and a
// launch curve (`launch-curve-gua-sha`). They are written from the tools' contracts and from patterns, not from figures: no count,
// share or lift is pinned, because the segment thresholds and the minimum pair support are the tools' own choices. (Two figures are
// pinned, both worked out from the dataset and not through the tool: the most frequent pair's order count, and the Gua Sha Stone's
// first-week units.) The number checker (`verified`) confirms every figure written traces to a result.
//
// The seed plants no product launch: every product is drawn from the same weights for the whole period, and the storylines S1 to
// S10 hold no product introduction. A "launch" exists only in the tool's own sense (a product's first sale, at least 14 days after
// the store's first order), so the launch case picks a slow seller whose first sale came late and checks that the answer says a launch
// here is a first sale and not a publish date, and that it does not invent a ramp out of a handful of units.
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

// ---- slice 2: the retention segments and the bundle candidates

const AT_RISK = String.raw`at[- ]risk`;
// "148 customers", "148 at-risk customers", "customers: 148", or a table cell on its own ("| 148 |").
const CUSTOMER_COUNT = String.raw`(?:\b\d[\d,]*\s+(?:[\w-]+\s+){0,2}(?:customers?|buyers|shoppers|people)\b|\b(?:customers?|count|number)\b\W{0,6}\d[\d,]*\b|\|\s*\d[\d,]*\s*\|)`;
const DAYS = String.raw`\d[\d,]*(?:\.\d+)?\s+days?\b`;
const OF_CUSTOMERS = String.raw`(?:share|proportion|of\s+(?:all\s+|your\s+|the\s+|total\s+)?(?:[\w-]+\s+)?(?:customers|buyers|shoppers|base))`;
const SINCE_LAST = String.raw`(?:since\s+(?:their\s+)?(?:last|latest)|last\s+(?:ordered|order|purchase|bought)|average|avg|on\s+average|typically)`;
const LTV = String.raw`(?:ltv|lifetime|spent|spend|revenue|worth|value)`;

export const AT_RISK_COUNT = new RegExp(`${near(AT_RISK, CUSTOMER_COUNT, 100).source}|\\b\\d[\\d,]*\\s+${AT_RISK}\\b`, "i");
// Either their share of all customers as a percentage, or the average days since their last order.
export const SHARE_OR_DAYS = new RegExp(`${near(OF_CUSTOMERS, PCT, 80).source}|${near(SINCE_LAST, DAYS, 80).source}`, "i");
export const LTV_IN_DOLLARS = near(LTV, MONEY, 80);
// A listed pseudonymous id, or a plain statement that the customers are ids and not names.
export const IDS_NOT_NAMES = /\bCUST_[0-9a-f]{4,}|\bpseudonym\w*|\bcustomer\s+ids?\b|\banonymi[sz]ed\b|\b(?:no|without|not|aren['’]t|isn['’]t)\s+(?:\w+\s+){0,3}(?:names?|emails?)\b/i;
// The rule behind "at risk" (days since the last order against their usual gap) stated as a rule, or as not being a prediction.
export const RULE_NOT_PREDICTION =
  /\b(?:heuristic|rule[- ]of[- ]thumb|rule|not\s+(?:a\s+)?(?:prediction|forecast|model))\b|\bdays?\s+since\s+(?:their\s+|the\s+)?(?:last|latest)\s+(?:order|purchase)|\b(?:usual|typical|normal|own|median|average)\s+(?:gap|time|rhythm|cadence|interval)\s+between|\bbetween\s+(?:their\s+)?orders\b|\bnothing\s+in\s+the\s+last\b/i;

// The churn risk or a share written as the raw fraction the tool returns (0.82) instead of a percentage (82%).
export const RAW_FRACTION_CHURN = /\b(?:churn\w*|risk\s+(?:score|level)|share)\b[^\n]{0,60}\b0\.\d{2,}\b(?!\s*%|\d)|\b0\.\d{2,}\b(?!\s*%|\d)[^\n]{0,60}\b(?:churn\w*|risk\s+score)\b/i;
// The agent only reads data: "I emailed them" or "an offer was sent" is invented.
export const CLAIMS_CONTACTED =
  /\b(?:I|we)(?:['’]ve|\s+have)?\s+(?:already\s+|just\s+)?(?:contacted|emailed|e-mailed|messaged|texted|notified|reached\s+out|sent\s+(?:them|an?\s+(?:email|message|offer|discount|reminder)))\b|\b(?:emails?|messages?|offers?|discounts?|reminders?)\s+(?:was|were|has\s+been|have\s+been)\s+sent\b/i;
// A rule about days since the last order says who is at risk, not who "will" leave.
export const CLAIMS_WILL_CHURN =
  /\b(?:will|going\s+to|are\s+about\s+to|certain\s+to|sure\s+to|bound\s+to)\s+(?:definitely\s+|certainly\s+|probably\s+|likely\s+|soon\s+)?(?:churn|leave|stop\s+buying|lapse|never\s+(?:buy|order|return|come\s+back)|be\s+lost)\b/i;

const TOGETHER = String.raw`(?:together|both|same\s+(?:order|basket)|pair\w*|alongside|combination)`;
const ORDER_COUNT = String.raw`\b\d[\d,]*\s+(?:(?:[\w-]+\s+){0,3}orders?|times|baskets)\b`;

// "bought together in 70 orders", "70 orders had both", or a table whose column is "Orders together".
export const ORDERS_TOGETHER = new RegExp(`${near(TOGETHER, ORDER_COUNT, 120).source}|\\borders?\\s+(?:together|with\\s+both|containing\\s+both)\\b[\\s\\S]{0,300}\\d`, "i");
export const TOGETHER_AS_PERCENT = near(String.raw`(?:together|also|both|alongside|pair\w*|confidence|support|share|of\s+(?:the\s+|all\s+)?(?:[\w-]+\s+){0,3}orders)`, PCT, 120);
// "lift of 1.9", "lift: 1.9x", a Lift column with an "x" figure, or "1.9x as often".
export const LIFT =
  /\blift\b(?:\s+(?:of|is|was|at|score(?:\s+of)?|ratio(?:\s+of)?))?[\s:=(|*]*\d+(?:\.\d+)?|\blift\b[\s\S]{0,300}\d+(?:\.\d+)?\s?(?:x|×)(?!\w)|\d+(?:\.\d+)?\s?(?:x|×)\s+(?:the\s+)?lift\b|\d+(?:\.\d+)?\s?(?:x|×|times)\s+(?:as\s+(?:likely|often)|more\s+(?:likely|often)|the\s+(?:rate|chance|odds))/i;
// What the numbers rest on (past orders), or that they are not proof.
export const BASED_ON_PAST_ORDERS =
  /\b(?:past|previous|historical|recorded|prior)\s+(?:[\w-]+\s+){0,2}(?:orders|baskets|purchases)|\bbased\s+on\s+(?:your\s+|the\s+|all\s+)?(?:\d[\d,]*\s+)?(?:[\w-]+\s+){0,2}(?:orders|baskets|purchases)|\bhistor\w+\b|\b(?:not|n['’]t)\s+(?:\w+\s+){0,2}(?:proof|prove|guarantee|causal|cause)\b|\bassociation\b|\bcorrelat\w+|\bno\s+(?:proof|guarantee)\b|\bdoes\s+not\s+mean\b/i;
// "customers will buy it", "shoppers who buy X will also buy Y", "proves they want a bundle": the data is past orders, not a promise.
export const CLAIMS_WILL_BUY =
  /\b(?:customers?|shoppers?|buyers?|people|they)\s+(?:who\s+[^.\n]{0,40}\s+)?(?:will|would\s+definitely|are\s+(?:sure|certain|bound)\s+to)\s+(?:definitely\s+|certainly\s+|surely\s+|also\s+)?(?:buy|purchase|order|add|want)\b|(?<!\bnot\s)(?<!\bnot\sa\s)(?<!n['’]t\s)(?<!\bno\s)(?<!\bcannot\s)(?<!\bnecessarily\s)\b(?:proves?|proved|proven|proof|guarantees?|guaranteed)\b[^.\n]{0,60}\b(?:buy|bundle|demand|want|sell|sales|customers?)|(?<!\bnot\s)(?<!\bnot\sa\s)(?<!n['’]t\s)(?<!\bno\s)\b(?:proven|guaranteed|sure[- ]?fire)\s+(?:bundle|winner|combination|pairing|pair)\b/i;

const WEEK_ONE = String.raw`(?:week\s*1\b|first\s+(?:week|(?:7|seven)\s+days)|launch\s+week|opening\s+week)`;
const UNITS = String.raw`\b\d[\d,]*\s+units?\b`;

export const WEEK_ONE_UNITS = near(WEEK_ONE, UNITS, 120);
// The tool's launch is a product's first sale: the answer says so, or says there is no publish date.
export const LAUNCH_IS_FIRST_SALE = new RegExp(
  `${near(String.raw`launch\w*`, String.raw`first\s+(?:recorded\s+)?(?:sale|order|purchase)`, 100).source}|\\b(?:no|not|isn['’]t|without|doesn['’]t\\s+(?:have|know))\\b[^.\\n]{0,40}\\bpublish\\w*`,
  "i",
);
export const VS_MEDIAN_LAUNCH = near(String.raw`\bmedian\b`, String.raw`(?:\d+(?:\.\d+)?\s?%|\b\d[\d,]*\s+(?:units?\s+)?(?:above|below|more|fewer|less|over|under|ahead|behind)|\b\d[\d,]*\s+units?\b)`, 120);
// A share of the median written as the raw fraction the tool returns (0.85) instead of a percentage (85%).
export const RAW_FRACTION_MEDIAN = /\bmedian\b[^\n]{0,60}\b0\.\d{2,}\b(?!\s*%|\d)|\b0\.\d{2,}\b(?!\s*%|\d)[^\n]{0,60}\bmedian\b/i;
// A handful of units is not a "strong launch" or a ramp. "not a strong launch", "no momentum" and "never ramped up" are let through.
export const CLAIMS_STRONG_LAUNCH =
  /(?<!\bnot\s)(?<!\bnot\sa\s)(?<!n['’]t\s)(?<!\bno\s)(?<!\bnever\s)\b(?:strong|great|successful|big|huge|impressive|breakout|blockbuster|hit)\b[^.\n]{0,30}\blaunch|\blaunch\b[^.\n]{0,30}\b(?:was|went|looks?|is)\s+(?:very\s+|really\s+|quite\s+)?(?:strong|great|successful|huge|impressive|a\s+hit|a\s+success)\b|(?<!\bnot\s)(?<!n['’]t\s)(?<!\bnever\s)\b(?:took\s+off|ramped\s+up|gained\s+momentum|snowballed|exploded)\b/i;
// The tool knows a first sale only. "Published on", "went live on" and the like state a date it does not have.
export const CLAIMS_PUBLISH_DATE = /(?<!\bnot\s)(?<!n['’]t\s)\b(?:published|went\s+live|was\s+released|released|was\s+listed|introduced)\s+(?:on|in|around|at)\b/i;

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
// A date written as 2025-11-14, "November 14", "Nov 14th, 2025" or "14 November".
export function datePattern(iso: string): RegExp {
  const [, m, d] = iso.split("-").map(Number) as [number, number, number];
  const month = MONTHS[m - 1]!;
  const short = month.slice(0, 3);
  return new RegExp(`${iso}|\\b(?:${month}|${short}\\.?)\\s+0?${d}(?:st|nd|rd|th)?\\b|\\b0?${d}(?:st|nd|rd|th)?\\s+(?:of\\s+)?(?:${month}|${short}\\.?)\\b`, "i");
}

// The day of a product's first sale and the units sold in the 7 days from it (the launch day and the six after, as the tool's week 1
// is), counted from the dataset and not through the tool. The day is the store-local date, which is how processedAt is written.
export function firstWeekOf(dataset: Dataset, title: string): { launchDate: string; units: number } {
  const product = dataset.products.find((p) => p.title === title)!;
  const variants = new Set(dataset.variants.filter((v) => v.productGenId === product.genId).map((v) => v.genId));
  const byDay = new Map<string, number>();
  for (const order of dataset.orders) for (const l of order.lines) if (variants.has(l.variantGenId)) byDay.set(order.processedAt.slice(0, 10), (byDay.get(order.processedAt.slice(0, 10)) ?? 0) + l.qty);
  const launchDate = [...byDay.keys()].sort()[0]!;
  const lastDay = new Date(Date.parse(launchDate) + 6 * 86_400_000).toISOString().slice(0, 10);
  const units = [...byDay].filter(([day]) => day <= lastDay).reduce((sum, [, qty]) => sum + qty, 0);
  return { launchDate, units };
}

// Two different product titles from the store's catalogue in one answer, in either order.
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export const twoProductNames = (titles: string[]) => {
  const alt = [...titles].sort((a, b) => b.length - a.length).map(escapeRe).join("|");
  return new RegExp(`(${alt})[\\s\\S]*?(?!\\1)(?:${alt})`, "i");
};

// One title, but not when it is the start of a longer title ("Barrier Cream" in "Barrier Cream Mini").
const titlePattern = (title: string, titles: string[]) => {
  const longer = titles.filter((t) => t !== title && t.toLowerCase().startsWith(`${title.toLowerCase()} `)).map((t) => escapeRe(t.slice(title.length)));
  return longer.length > 0 ? `${escapeRe(title)}(?!${longer.join("|")})` : escapeRe(title);
};

// The pair (or pairs, on a tie) of products held together by the most orders, counted from the dataset and not through the tool.
// An order counts once for a pair, whatever the quantities, and every variant folds into its product, as the tool defines it.
// The fixtures have no cancelled orders, so nothing is left out.
export function mostFrequentPairs(dataset: Dataset): { count: number; pairs: [string, string][] } {
  const productOf = new Map(dataset.variants.map((v) => [v.genId, v.productGenId]));
  const titleOf = new Map(dataset.products.map((p) => [p.genId, p.title]));
  const together = new Map<string, number>();
  for (const order of dataset.orders) {
    const ids = [...new Set(order.lines.map((l) => productOf.get(l.variantGenId)!))].sort();
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) together.set(`${ids[i]}|${ids[j]}`, (together.get(`${ids[i]}|${ids[j]}`) ?? 0) + 1);
  }
  const count = Math.max(...together.values());
  const pairs = [...together].filter(([, n]) => n === count).map(([key]) => key.split("|").map((id) => titleOf.get(id)!) as [string, string]);
  return { count, pairs };
}

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
  {
    // The at-risk segment: two or more orders, nothing in the last 90 days. The question gives no segment name, so the model has to
    // map "at risk" to the tool's segment (or list the customers and filter). Customers are pseudonymous ids only, so a good answer
    // cannot give a name or an email, and it must not claim it contacted anyone.
    id: "segments-at-risk",
    category: "retention",
    store: SOLENNE,
    now: "2026-11-02T12:00:00-05:00",
    question: "Which customers are at risk?",
    expect: () => ({
      tools: ["get_customer_segments"],
      toolWhere: [
        {
          label: "asked for the at-risk segment, or for a list of customers",
          tool: "get_customer_segments",
          test: (i) => /at[_-]risk|\blist\b/i.test(JSON.stringify(i)),
        },
      ],
      mentions: [
        { label: "says how many customers are at risk", pattern: AT_RISK_COUNT },
        { label: "gives their share of customers as a percentage, or the average days since their last order", pattern: SHARE_OR_DAYS },
        { label: "gives their lifetime value in dollars", pattern: LTV_IN_DOLLARS },
        { label: "refers to customers by pseudonymous id, or says there are no names", pattern: IDS_NOT_NAMES },
        { label: "explains at risk as a rule on days since the last order, not a prediction", pattern: RULE_NOT_PREDICTION },
      ],
      avoid: [
        { label: "writes churn risk and shares as percentages, not raw fractions", pattern: RAW_FRACTION_CHURN },
        { label: "does not claim to have contacted anyone", pattern: CLAIMS_CONTACTED },
        { label: "does not say customers will leave", pattern: CLAIMS_WILL_CHURN },
      ],
      verified: true,
    }),
  },
  {
    // Bundle candidates from baskets. On the Solenne fixtures the pairs bought together most often are the bestsellers, and their lift
    // is below 1 (worked out by hand from dataset.json, not through the tool: Hero Vitamin C Serum and Barrier Cream are in 70 orders
    // with a lift of about 0.7, and among pairs in at least 5 orders only one, in 5 orders, is above 1.2). So the case does not require a lift
    // above 1: it checks that the pair, its count, its share and its lift are written, and that the answer is hedged as past orders.
    id: "bundles-bought-together",
    category: "merchandising",
    store: SOLENNE,
    now: "2026-11-02T12:00:00-05:00",
    question: "Which products are bought together most often?",
    // The tool sorts by lift, so a pair seen in 5 orders can top its list. "Most often" means the most orders together, which the case
    // works out from the dataset (the same count the tool must report) and requires the answer to name and count.
    expect: (env) => {
      const top = mostFrequentPairs(env.dataset);
      const titles = env.dataset.products.map((p) => p.title);
      return {
        tools: ["get_bundle_candidates"],
        numbers: [{ label: "the orders that held the most frequent pair", value: top.count, tolerance: 0 }],
        mentions: [
          { label: "names two products as a pair", pattern: twoProductNames(titles) },
          { label: "names the pair that is in the most orders", pattern: new RegExp(top.pairs.map(([a, b]) => near(titlePattern(a, titles), titlePattern(b, titles), 200).source).join("|"), "i") },
          { label: "says how many orders held the pair", pattern: ORDERS_TOGETHER },
          { label: "gives how often they are bought together as a percentage", pattern: TOGETHER_AS_PERCENT },
          { label: "gives the lift", pattern: LIFT },
          { label: "says it rests on past orders, or is not proof", pattern: BASED_ON_PAST_ORDERS },
        ],
        avoid: [{ label: "does not say customers will buy, or that the numbers prove demand", pattern: CLAIMS_WILL_BUY }],
        verified: true,
      };
    },
  },
  {
    // The Gua Sha Stone has no storyline. Worked out by hand from dataset.json, not through the tool: its first sale is 2025-11-14,
    // 74 days after the store's first order, and it sold 3, 0, 1, 0 units in its first four weeks (5 in eight weeks, 31 in all). It is
    // a slow seller whose first sale came late, not a planned launch, so there is no ramp to find: the median launch sold 1 unit in
    // week 1 and none after. The case requires the answer to say that the launch date is the first sale (the products table has no
    // publish date), to give the first-week units and the median to compare, and not to call a handful of units a strong launch.
    // It asks for no productIds, so a run that lists every launch and picks the stone out of the list is as good as one that
    // searches for its id first.
    id: "launch-curve-gua-sha",
    category: "merchandising",
    store: SOLENNE,
    now: "2026-11-02T12:00:00-05:00",
    question: "How did the Gua Sha Stone launch go?",
    expect: (env) => {
      const launch = firstWeekOf(env.dataset, "Gua Sha Stone");
      return {
        tools: ["get_launch_curves"],
        numbers: [{ label: "the units sold in its first week", value: launch.units, tolerance: 0 }],
        mentions: [
          { label: "names the Gua Sha Stone", pattern: /gua\s+sha/i },
          { label: "gives the day of its first sale", pattern: datePattern(launch.launchDate) },
          { label: "says the launch is the first sale, not a publish date", pattern: LAUNCH_IS_FIRST_SALE },
          { label: "gives the units sold in the first week", pattern: WEEK_ONE_UNITS },
          { label: "compares it with the median launch, as a percentage or a number of units", pattern: VS_MEDIAN_LAUNCH },
        ],
        avoid: [
          { label: "does not call it a strong launch or describe a ramp", pattern: CLAIMS_STRONG_LAUNCH },
          { label: "does not give a publish date", pattern: CLAIMS_PUBLISH_DATE },
          { label: "writes the share of the median as a percentage, not a raw fraction", pattern: RAW_FRACTION_MEDIAN },
        ],
        verified: true,
      };
    },
  },
];
