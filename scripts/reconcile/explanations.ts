import type { Explanation } from "./reconcile";

// A difference between the synced store and truth.json is either a bug or a known, explained gap. Add a note here
// for each gap that is understood; the report shows UNEXPLAINED for the rest, and the command exits with an error.
// Match on store, and optionally on the month or check (`where`) and the metric.
const WEBHOOK_TEST =
  "Live check of the orders/create webhook, 2026-10-31: order #1103 (tag webhook-test, one unit, $16.00) was created in the Tidepool admin after the seed and reached Postgres through the webhook in about 3 seconds. It is not in truth.json.";

export const EXPLANATIONS: Explanation[] = [
  { store: "tidepool", where: "2026-10", note: WEBHOOK_TEST },
  { store: "tidepool", where: 'TP1 net_sales {"exclude_tag":"wholesale"} 2026-10-01..2026-10-31', note: WEBHOOK_TEST },
  { store: "tidepool", where: 'TP1 orders {"exclude_tag":"wholesale"} 2026-10-01..2026-10-31', note: WEBHOOK_TEST },
  { store: "tidepool", where: "synced rows", metric: "orders", note: WEBHOOK_TEST },
];
