import { and, asc, eq, gte, inArray, isNull, lte, min, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { orderLines, orders, products } from "../db/schema";
import { addDays, daysBetween } from "./dates";

// The maths and the reads behind get_launch_curves: units sold by week since a product's first sale, and the median curve of the
// launches in the store. The tool does the validation and the envelope. Nothing here reads the clock or takes a tenant from
// anywhere but its argument (the tool passes the session's).
//
// The products table has no publish date, so a launch is a product's first non-cancelled sale. A product already selling when the
// data starts has no knowable launch: its first sale must come at least LAUNCH_LEAD_DAYS after the store's first order.

export const LAUNCH_LEAD_DAYS = 14;
export const WEEK_DAYS = 7;

export interface Launch {
  productId: string;
  launchDate: string;
}

export interface CurveWeek {
  week: number; // 1 is the launch day and the six after it
  from: string;
  to: string; // cut to the last day of the data
  daysObserved: number; // 1 to 7; 7 means the week is complete
  units: number;
  cumulativeUnits: number;
}

export interface LaunchCurve {
  productId: string;
  launchDate: string;
  daysObserved: number; // launch day to the last day of the data, counting both, capped at weeks * 7
  fullyObserved: boolean; // all the asked weeks are complete
  totalUnits: number; // over the observed days
  weeks: CurveWeek[]; // only weeks that start on or before the last day of the data
}

export interface BenchmarkWeek {
  week: number;
  medianUnits: number;
  medianCumulativeUnits: number;
  launches: number; // launches whose week is complete, the ones the medians are over
}

export interface ComparedWeek extends CurveWeek {
  vsMedianUnits: number | null; // units minus the week's medianUnits; null when the week is not complete
  pctOfMedianUnits: number | null; // units as a fraction of medianUnits; null when the week is not complete or the median is 0
}

// ---- Reads

// The store-local date of each product's first non-cancelled sale. Lines with no product (custom items) are not a product's sale.
export async function firstSalesByProduct(db: Db, tenantId: string): Promise<Map<string, string>> {
  const rows = await db
    .select({ productId: orderLines.productId, first: min(orders.localDate) })
    .from(orderLines)
    .innerJoin(orders, and(eq(orders.tenantId, orderLines.tenantId), eq(orders.id, orderLines.orderId)))
    .where(and(eq(orders.tenantId, tenantId), isNull(orders.cancelledAt), sql`${orderLines.productId} is not null`))
    .groupBy(orderLines.productId);
  return new Map(rows.flatMap((r) => (r.productId && r.first ? [[r.productId, r.first] as const] : [])));
}

// Units sold per product per day (order-line quantity before refunds, cancelled orders left out) for a range.
export async function unitsByProductDay(db: Db, tenantId: string, productIds: string[], range: { from: string; to: string }): Promise<Map<string, Map<string, number>>> {
  const out = new Map<string, Map<string, number>>();
  if (productIds.length === 0) return out;
  const rows = await db
    .select({ productId: orderLines.productId, date: orders.localDate, units: sql<string>`sum(${orderLines.quantity})` })
    .from(orderLines)
    .innerJoin(orders, and(eq(orders.tenantId, orderLines.tenantId), eq(orders.id, orderLines.orderId)))
    .where(and(eq(orders.tenantId, tenantId), isNull(orders.cancelledAt), gte(orders.localDate, range.from), lte(orders.localDate, range.to), inArray(orderLines.productId, productIds)))
    .groupBy(orderLines.productId, orders.localDate);
  for (const r of rows) {
    const days = out.get(r.productId!) ?? new Map<string, number>();
    days.set(r.date, Number(r.units));
    out.set(r.productId!, days);
  }
  return out;
}

// Product titles (store text: the caller puts them under `untrusted`). A product missing from the catalogue has no entry.
export async function productTitles(db: Db, tenantId: string, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await db.select({ id: products.id, title: products.title }).from(products).where(and(eq(products.tenantId, tenantId), inArray(products.id, ids)));
  return new Map(rows.map((r) => [r.id, r.title]));
}

// ---- Products asked for by name

export interface ProductRefs {
  ids: string[]; // the products the entries stand for, each once
  byName: { ref: string; matches: number }[]; // entries that were not ids and matched titles
  unmatched: string[]; // entries that are neither an id nor part of a title
}

const MIN_NAME_CHARS = 3; // "A" or "Ne" is not a name worth matching against every title

// The model is asked for product ids but sometimes gives a name ("Gua Sha"), and a name that is not an id would read as a product with
// no sales. An entry that is an id stays one; any other is matched against the titles, ignoring case.
export function matchProductRefs(refs: string[], catalog: { id: string; title: string }[]): ProductRefs {
  const known = new Set(catalog.map((p) => p.id));
  const ids = new Set<string>();
  const byName: ProductRefs["byName"] = [];
  const unmatched: string[] = [];
  for (const ref of refs) {
    if (known.has(ref)) {
      ids.add(ref);
      continue;
    }
    const needle = ref.trim().toLowerCase();
    const hits = needle.length >= MIN_NAME_CHARS ? catalog.filter((p) => p.title.toLowerCase().includes(needle)) : [];
    if (hits.length === 0) {
      unmatched.push(ref);
      continue;
    }
    byName.push({ ref, matches: hits.length });
    for (const h of hits) ids.add(h.id);
  }
  return { ids: [...ids], byName, unmatched };
}

export async function resolveProductRefs(db: Db, tenantId: string, refs: string[]): Promise<ProductRefs> {
  const catalog = await db.select({ id: products.id, title: products.title }).from(products).where(eq(products.tenantId, tenantId)).orderBy(asc(products.title), asc(products.id));
  return matchProductRefs(refs, catalog);
}

// ---- Which products are launches

// Splits first sales into launches (first sale at least LAUNCH_LEAD_DAYS after the first order in the data) and products that were
// already selling when the data starts.
export function splitFirstSales(firstSales: Map<string, string>, dataFirst: string): { launches: Launch[]; alreadySelling: string[] } {
  const launches: Launch[] = [];
  const alreadySelling: string[] = [];
  for (const [productId, launchDate] of firstSales) {
    if (daysBetween(dataFirst, launchDate) >= LAUNCH_LEAD_DAYS) launches.push({ productId, launchDate });
    else alreadySelling.push(productId);
  }
  launches.sort((a, b) => a.launchDate.localeCompare(b.launchDate) || a.productId.localeCompare(b.productId));
  return { launches, alreadySelling };
}

// ---- Curve maths

export function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

// Week by week from the launch day: seven days to a week, the last one cut to the data. Weeks that start after the data ends are left out.
export function weeksOf(launchDate: string, perDay: Map<string, number>, weeks: number, last: string): CurveWeek[] {
  const out: CurveWeek[] = [];
  let cumulative = 0;
  for (let k = 0; k < weeks; k++) {
    const from = addDays(launchDate, WEEK_DAYS * k);
    if (from > last) break;
    const end = addDays(from, WEEK_DAYS - 1);
    const to = end > last ? last : end;
    let units = 0;
    for (let d = from; d <= to; d = addDays(d, 1)) units += perDay.get(d) ?? 0;
    cumulative += units;
    out.push({ week: k + 1, from, to, daysObserved: daysBetween(from, to) + 1, units, cumulativeUnits: cumulative });
  }
  return out;
}

export function launchCurve(productId: string, launchDate: string, perDay: Map<string, number>, weeks: number, last: string): LaunchCurve {
  const curve = weeksOf(launchDate, perDay, weeks, last);
  const daysObserved = Math.min(weeks * WEEK_DAYS, daysBetween(launchDate, last) + 1);
  return { productId, launchDate, daysObserved, fullyObserved: daysObserved === weeks * WEEK_DAYS, totalUnits: curve.at(-1)?.cumulativeUnits ?? 0, weeks: curve };
}

// For each week, the median over the launches that have the whole week in the data. A week no launch has fully seen is left out.
export function benchmarkOf(curves: LaunchCurve[]): BenchmarkWeek[] {
  const out: BenchmarkWeek[] = [];
  const longest = Math.max(0, ...curves.map((c) => c.weeks.length));
  for (let w = 1; w <= longest; w++) {
    const seen = curves.flatMap((c) => (c.weeks[w - 1]?.daysObserved === WEEK_DAYS ? [c.weeks[w - 1]!] : []));
    if (seen.length === 0) continue;
    out.push({ week: w, medianUnits: median(seen.map((x) => x.units)), medianCumulativeUnits: median(seen.map((x) => x.cumulativeUnits)), launches: seen.length });
  }
  return out;
}

// Each week against the benchmark's median for that week, as fields, so nobody has to subtract or divide.
export function compareWithBenchmark(curve: LaunchCurve, benchmark: BenchmarkWeek[]): ComparedWeek[] {
  return curve.weeks.map((w) => {
    const b = benchmark.find((x) => x.week === w.week);
    if (!b || w.daysObserved < WEEK_DAYS) return { ...w, vsMedianUnits: null, pctOfMedianUnits: null };
    return { ...w, vsMedianUnits: w.units - b.medianUnits, pctOfMedianUnits: b.medianUnits === 0 ? null : w.units / b.medianUnits };
  });
}
