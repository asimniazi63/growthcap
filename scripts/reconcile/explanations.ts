import type { Explanation } from "./reconcile";

// A difference between the synced store and truth.json is either a bug or a known, explained gap. Add a note here
// for each gap that is understood; the report shows UNEXPLAINED for the rest, and the command exits with an error.
// Match on store, and optionally on the month or check (`where`) and the metric.
export const EXPLANATIONS: Explanation[] = [];
