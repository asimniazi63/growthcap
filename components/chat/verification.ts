import type { UIMessage } from "ai";
import type { MatchedClaim } from "@/lib/agent/links";
import type { ProvenanceEntry } from "@/lib/agent/run";
import { tracedFigures, type TracedFigure } from "@/lib/agent/traced";

// What the chat reads from the server's data-verification part. `figures` is newer than the rest: a conversation saved before it
// existed has only `matched` (where each figure sits in the answer), which is enough to rebuild the same list.
export interface Verification {
  attempt: number;
  ok: boolean;
  unmatched: { text: string; value: number }[];
  matched: MatchedClaim[];
  figures?: TracedFigure[];
}

type Part = UIMessage["parts"][number];

// The verification that belongs to the answer on screen. An answer that was repaired streams twice (the first draft, its
// verification, then the corrected text), so a verification counts only when it comes after the last text: while the
// corrected text is still arriving, the draft's verification is not about it.
export function finalVerification(parts: Part[], lastText: number): Verification | undefined {
  if (lastText < 0) return undefined;
  const at = parts.findLastIndex((p) => p.type === "data-verification");
  return at > lastText ? (parts[at] as unknown as { data: Verification }).data : undefined;
}

export interface TracedSummary {
  figures: TracedFigure[];
  traced: number;
  total: number;
  unmatched: string[];
}

// The counts come from the checker's own lists, so they are right even when the figure list was cut short.
export function tracedSummary(verification: Verification, answer: string, provenance: Record<string, ProvenanceEntry>): TracedSummary {
  const matched = verification.matched ?? [];
  const unmatched = verification.unmatched ?? [];
  return {
    figures: verification.figures ?? tracedFigures(answer, matched, (id) => provenance[id]),
    traced: matched.length,
    total: matched.length + unmatched.length,
    unmatched: unmatched.map((u) => u.text),
  };
}
