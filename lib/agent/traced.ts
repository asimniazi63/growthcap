import { toolLabel } from "./tool-labels";

// The figures of an answer that the number checker traced to a tool result, in the small form the chat draws: the text as
// it is written in the answer, the query behind it and a plain-words source. The checker has already decided what matched;
// nothing here re-checks or re-derives a number.

export interface TracedFigure {
  text: string; // as written in the answer, for example "$12,340" or "18.4%"
  queryId: string;
  source: string; // the tool's friendly name
  range?: { from: string; to: string };
  asOf?: string;
  count: number; // how many times this figure was traced in the answer
}

export interface MatchedSpan {
  span: [number, number];
  queryId: string;
}

export interface SourceInfo {
  tool: string;
  range?: { from: string; to: string };
  asOf?: string;
}

// The part stays small however long the answer is. The badge counts come from the checker's own lists, so a figure left out of
// this list is still counted; it just isn't underlined.
export const MAX_TRACED_FIGURES = 60;

// One entry per distinct figure text and query, in the order the figures first appear in the answer.
export function tracedFigures(answer: string, matched: MatchedSpan[], sourceOf: (queryId: string) => SourceInfo | undefined): TracedFigure[] {
  const found = new Map<string, TracedFigure>();
  for (const m of [...matched].sort((a, b) => a.span[0] - b.span[0])) {
    const text = answer.slice(...m.span).trim();
    if (!text) continue;
    const key = `${text}\u0000${m.queryId}`;
    const seen = found.get(key);
    if (seen) {
      seen.count += 1;
      continue;
    }
    if (found.size >= MAX_TRACED_FIGURES) continue;
    const info = sourceOf(m.queryId);
    found.set(key, {
      text,
      queryId: m.queryId,
      source: info ? toolLabel(info.tool) : "the store data",
      ...(info?.range ? { range: info.range } : {}),
      ...(info?.asOf ? { asOf: info.asOf } : {}),
      count: 1,
    });
  }
  return [...found.values()];
}
