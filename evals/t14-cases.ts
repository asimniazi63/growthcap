import type { StoreKey } from "../scripts/seed/types.js";
import type { EvalCase, EvalEnv } from "./cases";

// The growth-audit case (T14, feature 30): a Growth Capital user asks for the audit on Tidepool, and the write-up must name the
// Cloud Muslin Swaddle's stock risk (storyline TP2: the best seller has about 10 days of stock at its recent sales rate, ahead of
// Black Friday). Graded like the other cases, by deterministic checks. The expected figures are worked out here from the dataset
// itself (stock levels and order lines), never through lib/audit, so the audit is not graded against itself.
//
// It costs money (the chat model and a few tool calls). Run it with the T11 eval, not before.

const TIDEPOOL: StoreKey = "tidepool";
const WINDOW_DAYS = 30; // the audit's stock cover reads the last 30 days of sales

const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

// The swaddle's stock and its sales over the 30 days up to the dataset's last day. An order's own offset is the store's, so the
// first ten characters of processedAt are its store-local date.
function swaddle(env: EvalEnv) {
  const product = env.dataset.products.find((p) => /cloud muslin swaddle/i.test(p.title))!;
  const variantIds = new Set(env.dataset.variants.filter((v) => v.productGenId === product.genId).map((v) => v.genId));
  const unitsLeft = env.dataset.inventory.filter((i) => variantIds.has(i.variantGenId)).reduce((s, i) => s + i.available, 0);
  const to = env.dataset.asOf;
  const from = addDays(to, -(WINDOW_DAYS - 1));
  const unitsSold = env.dataset.orders
    .filter((o) => o.processedAt.slice(0, 10) >= from && o.processedAt.slice(0, 10) <= to)
    .flatMap((o) => o.lines)
    .filter((l) => variantIds.has(l.variantGenId))
    .reduce((s, l) => s + l.qty, 0);
  const dailyRate = unitsSold / WINDOW_DAYS;
  return { unitsLeft, unitsSold, daysOfCover: dailyRate > 0 ? unitsLeft / dailyRate : null };
}

export const T14_CASES: EvalCase[] = [
  {
    id: "audit-tidepool-swaddle-stock",
    category: "audit",
    store: TIDEPOOL,
    now: "2026-10-31T12:00:00-07:00",
    question: "Run the growth audit for this store and write up the top opportunities.",
    expect: (env) => {
      const s = swaddle(env);
      return {
        tools: ["run_growth_audit"],
        numbers: [
          { label: "the swaddle's units left", value: s.unitsLeft, tolerance: 0 },
          // The audit rounds days of cover to one decimal; a write-up may round further, and the storyline says "about 9" to 10.
          ...(s.daysOfCover === null ? [] : [{ label: "the swaddle's days of cover", value: s.daysOfCover, tolerance: 1 }]),
        ],
        mentions: [
          { label: "names the Cloud Muslin Swaddle", pattern: /cloud muslin swaddle|swaddle/i },
          { label: "says it is running low or out of stock", pattern: /stock|run(?:ning)? (?:out|low)|out of|days? of (?:cover|stock)|reorder|restock/i },
        ],
        verified: true,
      };
    },
  },
];
