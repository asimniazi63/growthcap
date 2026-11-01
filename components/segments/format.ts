import { SEGMENT_IDS, SEGMENTS, type SegmentCustomer, type SegmentId } from "@/lib/segments/definitions";

// Small pure helpers for the Segments page, kept apart from the components so they can be tested without a renderer.

export const TOP_N = 15; // customers listed for the chosen segment

// ?segment= picks the segment whose customers are listed. Anything that is not one of the four ids is the first segment.
export function parseSegment(value: string | string[] | undefined): SegmentId {
  const one = Array.isArray(value) ? value[0] : value;
  return SEGMENT_IDS.find((id) => id === one) ?? SEGMENT_IDS[0];
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

// The biggest customers of one segment: lifetime value first, then id, the same order as the CSV.
export const topCustomers = (customers: SegmentCustomer[], segment: SegmentId, n = TOP_N): SegmentCustomer[] =>
  customers
    .filter((c) => c.segment === segment)
    .sort((a, b) => b.ltvCents - a.ltvCents || cmp(a.customerId, b.customerId))
    .slice(0, n);

// The RFM grid: rows are recency scores 5 down to 1 (the most recent buyers first), columns are frequency scores 1 to 5, and each
// cell is the number of customers with that pair. A score outside 1 to 5 is left out rather than put in the wrong cell.
export function rfmCounts(customers: SegmentCustomer[]): number[][] {
  const grid = Array.from({ length: 5 }, () => Array.from({ length: 5 }, () => 0));
  for (const c of customers) {
    if (!Number.isInteger(c.r) || !Number.isInteger(c.f) || c.r < 1 || c.r > 5 || c.f < 1 || c.f > 5) continue;
    grid[5 - c.r]![c.f - 1]! += 1;
  }
  return grid;
}

// How dark a grid cell is drawn: 0 for an empty cell, then 1 to 4 by its share of the fullest cell. The count is always printed in the
// cell as well, so the shade is never the only way to read it.
export function intensity(count: number, max: number): 0 | 1 | 2 | 3 | 4 {
  if (count <= 0 || max <= 0) return 0;
  return Math.min(4, Math.max(1, Math.ceil((count / max) * 4))) as 1 | 2 | 3 | 4;
}

// The browser cannot propose a Shopify change itself (only the agent's propose_action tool writes to the approval ledger), so the
// page opens the chat with this question, which the agent answers by proposing the segment for approval.
const titleOf = (id: SegmentId) => SEGMENTS.find((s) => s.id === id)?.title ?? id;
export const askToCreateQuestion = (id: SegmentId): string => `Create the ${titleOf(id)} segment in Shopify`;
export const askToCreateUrl = (id: SegmentId): string => `/chat?q=${encodeURIComponent(askToCreateQuestion(id))}`;

// Display formats. The figures themselves come from lib/metrics/segments.ts; these only decide how they read.
const whole = new Intl.NumberFormat("en-US");
export const count = (n: number): string => whole.format(n);
export const money = (cents: number, currency: string): string => new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
export const sharePct = (fraction: number): string => `${(fraction * 100).toFixed(1)}%`;
export const wholePct = (fraction: number): string => `${Math.round(fraction * 100)}%`;
export const days = (n: number): string => `${whole.format(Math.round(n))} ${Math.round(n) === 1 ? "day" : "days"}`;
