import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "../db/client";
import { orders } from "../db/schema";
import { SEGMENT_IDS, SEGMENT_RULES, type SegmentCustomer, type SegmentOrActive } from "../segments/definitions";
import { loadWindow, type DataWindow } from "../tools/common";
import { loadLineMargins } from "./cohorts";
import { daysBetween } from "./dates";

// The retention segments (T17, feature 35): RFM scores, lifetime value and a churn-risk heuristic per pseudonymous customer, and
// the segments built on them. Plain arithmetic on the synced orders, no model: every figure can be re-derived from the rules below.
// Dates are store-local "YYYY-MM-DD" strings. Nothing here reads the clock or takes a tenant from anywhere but its argument.

// What a churnRisk of 1 means: this many times their usual gap since the last order. At their usual gap it is 0.
const FULLY_LAPSED_GAP_MULTIPLE = 3;
// The "usual gap" of a one-order customer when nobody in the store has ordered twice.
export const FALLBACK_TYPICAL_GAP_DAYS = 120;

// ---- Pure maths

export interface CustomerFacts {
  customerId: string;
  orderDates: string[]; // one per non-cancelled order, any order
  ltvCents: number;
}

// Scores 1 to 5 from rank. Equal values share their average rank, so identical customers always score alike; a rank r of n gives
// the score from (r - 0.5) / n, cut into fifths. Everyone tied (a store where all buy once) scores 3, and so does a lone customer.
// The highest value gets the highest score.
export function rankScores(values: number[]): number[] {
  const n = values.length;
  const order = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const scores = new Array<number>(n);
  for (let lo = 0; lo < n; ) {
    let hi = lo;
    while (hi + 1 < n && order[hi + 1]!.v === order[lo]!.v) hi++;
    // the tied ranks lo+1 to hi+1 average (lo + hi + 2) / 2, so 5 * (average - 0.5) / n is 5 * (lo + hi + 1) / (2n)
    const score = 1 + Math.min(4, Math.floor((5 * (lo + hi + 1)) / (2 * n)));
    for (let k = lo; k <= hi; k++) scores[order[k]!.i] = score;
    lo = hi + 1;
  }
  return scores;
}

// The middle value; for an even count the exact average of the two middle ones (so a half day can appear). null for no values.
export function medianOf(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

const round = (x: number, places: number) => Math.round(x * 10 ** places) / 10 ** places;

// Two orders on one day make a gap of 0; a ratio against it would divide by zero, so a gap counts as at least a day.
const effectiveGap = (gapDays: number) => Math.max(1, gapDays);

// A heuristic, not a prediction: 0 until the customer is overdue against their usual gap, 1 at three times it, in a straight line
// between. Three decimals.
export function churnRiskOf(daysSinceLast: number, usualGapDays: number): number {
  const overdue = (daysSinceLast / effectiveGap(usualGapDays) - 1) / (FULLY_LAPSED_GAP_MULTIPLE - 1);
  return round(Math.min(1, Math.max(0, overdue)), 3);
}

// The first segment the customer fits, in the order of SEGMENT_IDS; "active" if none.
export function segmentOf(c: { orders: number; daysSinceLast: number; medianGapDays: number | null }): SegmentOrActive {
  const { champions, atRisk, dueToReorder, oneAndDone } = SEGMENT_RULES;
  if (c.orders >= champions.minOrders && c.daysSinceLast <= champions.maxDaysSinceLast) return "champions";
  if (c.orders >= atRisk.minOrders && c.daysSinceLast >= atRisk.minDaysSinceLast && c.daysSinceLast <= atRisk.maxDaysSinceLast) return "at_risk";
  if (c.orders >= dueToReorder.minOrders && c.medianGapDays !== null) {
    const ratio = c.daysSinceLast / effectiveGap(c.medianGapDays);
    if (ratio >= dueToReorder.minGapMultiple && ratio <= dueToReorder.maxGapMultiple) return "due_to_reorder";
  }
  if (c.orders === oneAndDone.orders && c.daysSinceLast >= oneAndDone.minDaysSinceLast) return "one_and_done";
  return "active";
}

// The store's usual gap between orders: the median of the repeat customers' own median gaps. A one-order customer has no gap of
// their own, so their churn risk is judged against this one.
export function typicalGapDays(customers: { medianGapDays: number | null }[]): number {
  return medianOf(customers.flatMap((c) => (c.medianGapDays === null ? [] : [c.medianGapDays]))) ?? FALLBACK_TYPICAL_GAP_DAYS;
}

// Scores every customer against the others in the same store. Sorted by LTV, highest first, then by id.
export function scoreCustomers(facts: CustomerFacts[], asOf: string): SegmentCustomer[] {
  const base = facts.map((f) => {
    const dates = [...f.orderDates].sort();
    const gaps = dates.slice(1).map((d, i) => daysBetween(dates[i]!, d));
    return {
      customerId: f.customerId,
      orders: dates.length,
      firstOrderDate: dates[0]!,
      lastOrderDate: dates[dates.length - 1]!,
      daysSinceLast: Math.max(0, daysBetween(dates[dates.length - 1]!, asOf)),
      ltvCents: f.ltvCents,
      medianGapDays: medianOf(gaps),
    };
  });
  const r = rankScores(base.map((c) => -c.daysSinceLast));
  const fr = rankScores(base.map((c) => c.orders));
  const m = rankScores(base.map((c) => c.ltvCents));
  const typicalGap = typicalGapDays(base);
  return base
    .map((c, i): SegmentCustomer => ({
      ...c,
      r: r[i]!,
      f: fr[i]!,
      m: m[i]!,
      churnRisk: churnRiskOf(c.daysSinceLast, c.medianGapDays ?? typicalGap),
      segment: segmentOf(c),
    }))
    .sort((a, b) => b.ltvCents - a.ltvCents || a.customerId.localeCompare(b.customerId));
}

export interface SegmentSummary {
  segment: SegmentOrActive;
  customers: number;
  shareOfCustomers: number; // a fraction of all customers
  avgLtvCents: number;
  totalLtvCents: number;
  avgOrders: number;
  avgDaysSinceLast: number;
  avgChurnRisk: number; // a fraction, 0 to 1
}

// One row per segment in SEGMENT_IDS order, then "active"; a segment nobody is in is a row of zeros.
export function summarizeSegments(customers: SegmentCustomer[]): SegmentSummary[] {
  return [...SEGMENT_IDS, "active" as const].map((segment): SegmentSummary => {
    const rows = customers.filter((c) => c.segment === segment);
    const n = rows.length;
    const total = (pick: (c: SegmentCustomer) => number) => rows.reduce((sum, c) => sum + pick(c), 0);
    const avg = (pick: (c: SegmentCustomer) => number) => (n === 0 ? 0 : total(pick) / n);
    return {
      segment,
      customers: n,
      shareOfCustomers: customers.length === 0 ? 0 : n / customers.length,
      avgLtvCents: Math.round(avg((c) => c.ltvCents)),
      totalLtvCents: total((c) => c.ltvCents),
      avgOrders: round(avg((c) => c.orders), 2),
      avgDaysSinceLast: round(avg((c) => c.daysSinceLast), 1),
      avgChurnRisk: round(avg((c) => c.churnRisk), 3),
    };
  });
}

// ---- From the database

export interface SegmentData {
  asOf: string; // the last day of synced orders; "" when the store has none
  customers: SegmentCustomer[];
  ordersWithoutCustomer: number; // guest orders: not a customer, so left out of every figure above
}

// Every customer with a non-cancelled order, scored. LTV is the sum of the customer's order lines over the whole data window, each
// after its discount and after the value of what was refunded from it (the same per-line net as the cohort and unit-economics
// tools, so a refund comes off the order it belongs to, not the month it was made). Shipping and tax are not in it.
export async function loadSegmentData(db: Db, tenantId: string, win?: DataWindow): Promise<SegmentData> {
  const window = win ?? (await loadWindow(db, tenantId));
  if (!window.first || !window.last) return { asOf: "", customers: [], ordersWithoutCustomer: 0 };

  const rows = await db
    .select({ customerId: orders.customerId, date: orders.localDate })
    .from(orders)
    .where(and(eq(orders.tenantId, tenantId), isNull(orders.cancelledAt)));
  const dates = new Map<string, string[]>();
  let ordersWithoutCustomer = 0;
  for (const r of rows) {
    if (r.customerId === null) {
      ordersWithoutCustomer++;
      continue;
    }
    const mine = dates.get(r.customerId) ?? [];
    mine.push(r.date);
    dates.set(r.customerId, mine);
  }

  const ltv = new Map<string, number>();
  for (const line of await loadLineMargins(db, tenantId, { from: window.first, to: window.last })) {
    if (line.customerId !== null) ltv.set(line.customerId, (ltv.get(line.customerId) ?? 0) + line.net);
  }

  const facts = [...dates].map(([customerId, orderDates]): CustomerFacts => ({ customerId, orderDates, ltvCents: ltv.get(customerId) ?? 0 }));
  return { asOf: window.last, customers: scoreCustomers(facts, window.last), ordersWithoutCustomer };
}

export async function loadSegmentCustomers(db: Db, tenantId: string): Promise<{ asOf: string; customers: SegmentCustomer[] }> {
  const { asOf, customers } = await loadSegmentData(db, tenantId);
  return { asOf, customers };
}
