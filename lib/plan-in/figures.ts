import type { ClaimEntry } from "../agent/checker";
import type { ToolResult } from "../tools/result";

// Figures written in a document's text, in the checker's units (money in dollars, a rate as a percentage, a count as is).
// The document text comes back from ask_document under `untrusted`, which the number checker never reads, so these are the
// one deliberate exception: a figure the document itself states may be repeated when the answer says where it is written
// ("page 1 states $26,767"). Only figures that are literally in the returned pages count; nothing is derived.
const MAX_FIGURES = 400;

export function figuresWrittenIn(text: string): Pick<ClaimEntry, "value" | "unit">[] {
  const out: Pick<ClaimEntry, "value" | "unit">[] = [];
  for (const m of text.matchAll(/(\$\s?)?(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?(\s?%)?/g)) {
    const value = Number(`${m[2]!.replace(/,/g, "")}${m[3] ?? ""}`);
    if (!Number.isFinite(value)) continue;
    out.push({ value, unit: m[1] ? "money" : m[4] ? "rate" : "count" });
    if (out.length >= MAX_FIGURES) break;
  }
  return out;
}

// For ledgerFromToolResults in lib/agent/checker.ts: the figures in the pages an ask_document result returned.
export function documentFigureEntries(result: Pick<ToolResult<unknown>, "data" | "queryId">): ClaimEntry[] {
  const documents = (result.data as { documents?: { pages?: { page?: number; untrusted?: { text?: string } }[] }[] } | null)?.documents;
  if (!Array.isArray(documents)) return [];
  const entries: ClaimEntry[] = [];
  documents.forEach((d, di) =>
    (d.pages ?? []).forEach((p, pi) => {
      for (const f of figuresWrittenIn(typeof p.untrusted?.text === "string" ? p.untrusted.text : "")) entries.push({ ...f, queryId: result.queryId, path: `data.documents[${di}].pages[${pi}].untrusted.text` });
    }),
  );
  return entries;
}
