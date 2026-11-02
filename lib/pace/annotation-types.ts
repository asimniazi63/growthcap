// What the Pace chart's timeline shows beside the cumulative line: things that explain a month. Pure, so the chart (a client
// component) and the server loader (lib/pace/annotations.ts) share it. `label` and `detail` can be store text (a calendar entry's
// title, a discount code, a product's name): the chart prints them as text and nothing else.

export const ANNOTATION_KINDS = ["calendar", "note", "code", "stockout"] as const;
export type AnnotationKind = (typeof ANNOTATION_KINDS)[number];

export interface PaceAnnotation {
  date: string; // YYYY-MM-DD, store time, inside the month
  kind: AnnotationKind;
  label: string; // short
  detail?: string;
}

export const ANNOTATION_KIND_LABEL: Record<AnnotationKind, string> = {
  calendar: "Marketing calendar",
  note: "Call note",
  code: "New discount code",
  stockout: "Possible stockout",
};

// The legend's shorter names.
export const ANNOTATION_LEGEND_LABEL: Record<AnnotationKind, string> = {
  calendar: "Calendar",
  note: "Call notes",
  code: "New codes",
  stockout: "Possible stockouts",
};

export const ANNOTATION_CAP = 12;
// A month with many codes or quiet days would drown the calendar, so these two have their own ceilings.
const CEILING: Record<AnnotationKind, number> = { calendar: ANNOTATION_CAP, note: ANNOTATION_CAP, code: 5, stockout: 3 };
const RANK: Record<AnnotationKind, number> = { calendar: 0, note: 0, code: 1, stockout: 2 };
const KIND_ORDER: Record<AnnotationKind, number> = { calendar: 0, note: 1, code: 2, stockout: 3 };

// Keeps the most useful `cap` of them: calendar entries and call notes first, then codes, then stockouts, each kind in the order
// it came in (the caller puts the likeliest first). The result is in date order.
export function capAnnotations(list: readonly PaceAnnotation[], cap = ANNOTATION_CAP): PaceAnnotation[] {
  const byPriority = list.map((a, i) => ({ a, i })).sort((x, y) => RANK[x.a.kind] - RANK[y.a.kind] || x.i - y.i);
  const used: Record<AnnotationKind, number> = { calendar: 0, note: 0, code: 0, stockout: 0 };
  const kept: { a: PaceAnnotation; i: number }[] = [];
  for (const item of byPriority) {
    if (kept.length >= cap) break;
    if (used[item.a.kind] >= CEILING[item.a.kind]) continue;
    used[item.a.kind]++;
    kept.push(item);
  }
  return kept.sort((x, y) => x.a.date.localeCompare(y.a.date) || KIND_ORDER[x.a.kind] - KIND_ORDER[y.a.kind] || x.i - y.i).map((k) => k.a);
}

// Cuts text to `max` characters at a word end, with an ellipsis. Whitespace (including newlines) collapses to single spaces.
export function shorten(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max - 1);
  const at = cut.lastIndexOf(" ");
  return `${(at > max * 0.6 ? cut.slice(0, at) : cut).replace(/[\s,.;:–-]+$/, "")}…`;
}
