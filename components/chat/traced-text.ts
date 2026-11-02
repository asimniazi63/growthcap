import type { TracedFigure } from "@/lib/agent/traced";

// Finds the traced figures inside the text of a rendered answer and marks them. It works on the parsed answer, one text node
// at a time, so it can only ever wrap what is already plain text: never code, never link text, never a tag, and nothing here
// builds HTML from a string.

interface HNode {
  type: string;
  value?: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HNode[];
}

export const TRACED_TAG = "traced-figure";
export const TRACED_PROP = "dataFigure"; // the index into the figure list, as a string

// Code and links are left as they are: a figure inside a code span is not one the answer states, and nesting a mark in a link
// would put two controls in one place.
const SKIP = new Set(["code", "pre", "a", "script", "style", TRACED_TAG]);

// The bounds mirror how the checker reads an answer, so a figure is not found where the checker skipped it: inside a longer number
// ("12" in "112", "12.5", "12%" or "1,12"), after a "$" it did not include, in a code or an order number (P-12, #12), in a time
// (10:12), or in a date (May 12, 12 May, 2026-05-12, May 12-18).
const MONTH = "(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)";
const BEFORE = `(?<![\\w.$#]|\\d[,:]|[A-Za-z][A-Za-z_-]*-|\\d{4}-(?:\\d{2}-)?|\\b${MONTH}[a-z]*\\.?\\s+(?:\\d{1,2}(?:st|nd|rd|th)?[–—-])?)`;
const AFTER = `(?![\\w%]|[.,:]\\d|\\s(?:%|percent|pp\\b|[kKmM]\\b)|\\s+${MONTH}[a-z]*\\b)`;

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export interface TracedMatcher {
  regex: RegExp;
  // For each figure text, the figures to hand out to its occurrences in order: a figure listed with a count of 2 comes twice.
  queue: Map<string, number[]>;
}

export function tracedMatcher(figures: TracedFigure[]): TracedMatcher | null {
  const queue = new Map<string, number[]>();
  figures.forEach((f, i) => {
    if (!f.text) return;
    const slots = queue.get(f.text) ?? [];
    for (let n = 0; n < Math.max(1, f.count); n++) slots.push(i);
    queue.set(f.text, slots);
  });
  if (queue.size === 0) return null;
  // Longest first, so "$12,340.50" is found as one figure before "$12,340" is tried.
  const texts = [...queue.keys()].sort((a, b) => b.length - a.length);
  return { regex: new RegExp(`${BEFORE}(?:${texts.map(escape).join("|")})${AFTER}`, "g"), queue };
}

export type TracedPart = string | { text: string; figure: number };

// Splits one piece of text into plain runs and traced figures. `used` counts how many of each text have been handed out so far
// in this answer, so a figure is marked no more often than the checker traced it.
export function splitTraced(value: string, matcher: TracedMatcher, used: Map<string, number>): TracedPart[] {
  const parts: TracedPart[] = [];
  let cursor = 0;
  for (const hit of value.matchAll(matcher.regex)) {
    const text = hit[0];
    const slots = matcher.queue.get(text);
    const taken = used.get(text) ?? 0;
    if (!slots || taken >= slots.length) continue;
    used.set(text, taken + 1);
    if (hit.index > cursor) parts.push(value.slice(cursor, hit.index));
    parts.push({ text, figure: slots[taken]! });
    cursor = hit.index + text.length;
  }
  if (parts.length === 0) return [value];
  if (cursor < value.length) parts.push(value.slice(cursor));
  return parts;
}

function walk(parent: HNode, matcher: TracedMatcher, used: Map<string, number>): void {
  const children = parent.children;
  if (!children) return;
  for (let i = 0; i < children.length; i++) {
    const node = children[i]!;
    if (node.type === "text" && node.value && /\d/.test(node.value)) {
      const parts = splitTraced(node.value, matcher, used);
      if (parts.length === 1 && typeof parts[0] === "string") continue;
      const next: HNode[] = parts.map((p) =>
        typeof p === "string"
          ? { type: "text", value: p }
          : { type: "element", tagName: TRACED_TAG, properties: { [TRACED_PROP]: String(p.figure) }, children: [{ type: "text", value: p.text }] },
      );
      children.splice(i, 1, ...next);
      i += next.length - 1;
    } else if (node.type === "element" && !SKIP.has(node.tagName ?? "")) {
      walk(node, matcher, used);
    }
  }
}

// A rehype plugin for react-markdown: marks each traced figure in the answer's text as a <traced-figure> element.
export function rehypeTraced(options: { figures: TracedFigure[] }) {
  const matcher = tracedMatcher(options.figures);
  return (tree: HNode) => {
    if (matcher) walk(tree, matcher, new Map());
  };
}
