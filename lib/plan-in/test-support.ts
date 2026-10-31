import { MockLanguageModelV4 } from "ai/test";

// A scripted model for the reader's tests: one answer per call, in order (pass 1, then pass 2).
const usage = { inputTokens: { total: 100, noCache: 100, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 50, text: 50, reasoning: undefined } };

export function scriptedReader(...answers: unknown[]): MockLanguageModelV4 {
  let call = 0;
  return new MockLanguageModelV4({
    doGenerate: async () => {
      const answer = answers[Math.min(call++, answers.length - 1)];
      return { content: [{ type: "text" as const, text: JSON.stringify(answer) }], finishReason: { unified: "stop" as const, raw: undefined }, usage, warnings: [] };
    },
  });
}

// What a good reader says about fixtures/solenne/sow.pdf. The quotes are copied from the PDF's text, line breaks aside.
const NET_QUOTE = "October $6,507, November $10,433 and December $9,827";
export const SOLENNE_CLAIMS = [
  { sentence: "Net sales target is $26,767 in total for Q4 2026.", page: 1, quote: "Net sales $26,767 in total Q4 2026" },
  { sentence: "Returning-customer rate is at least 45% in each month of Q4 2026.", page: 1, quote: "Returning-customer rate At least 45% Each month in Q4 2026" },
  { sentence: "Refund rate is no more than 6% in each month from 2026-10-01 to 2026-12-31.", page: 1, quote: "No more than 6% Each month, 2026-10-01 to 2026-12-31" },
  { sentence: "At least 30 new customers during Black Friday weekend, 2026-11-27 to 2026-11-30.", page: 1, quote: "New customers during Black Friday weekend At least 30 2026-11-27 to 2026-11-30" },
  { sentence: "The net sales target for October 2026 is $6,507.", page: 1, quote: NET_QUOTE },
  { sentence: "The net sales target for November 2026 is $10,433.", page: 1, quote: NET_QUOTE },
  { sentence: "The net sales target for December 2026 is $9,827.", page: 1, quote: NET_QUOTE },
];
export const MADE_UP_CLAIM = { sentence: "Gross margin must be at least 60% every month.", page: 2, quote: "Gross margin of at least 60% in every month" };

export const SOLENNE_PASS1 = { claims: [...SOLENNE_CLAIMS, MADE_UP_CLAIM] };
export const SOLENNE_PASS2 = {
  targets: [
    { claim: 2, month: "2026-10", metric: "returning_customer_rate", value: 0.45 },
    { claim: 2, month: "2026-11", metric: "returning_customer_rate", value: 0.45 },
    { claim: 2, month: "2026-12", metric: "returning_customer_rate", value: 0.45 },
    { claim: 3, month: "2026-10", metric: "refund_rate", value: 0.06 }, // not a metric a plan holds: shown as not applied
    { claim: 5, month: "2026-10", metric: "net_sales", value: 650700 },
    { claim: 6, month: "2026-11", metric: "net_sales", value: 1043300 },
    { claim: 7, month: "2026-12", metric: "net_sales", value: 982700 },
  ],
  unapplied: [
    { claim: 1, reason: "A quarter's total; the plan holds monthly targets." },
    { claim: 4, reason: "A weekend, not a whole month." },
  ],
};
