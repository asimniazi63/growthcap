import { and, asc, eq, gte, inArray, isNotNull, isNull, lte, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { calendarEvents, callNotes, orders, products, variants } from "../db/schema";
import { STOCKOUT_LOOKBACK_DAYS, unitsByVariantDay, zeroSalesDaysOf } from "../metrics/cohorts";
import { addDays, daysBetween, monthEnd, monthStart } from "../metrics/dates";
import { loadWindow } from "../tools/common";
import { capAnnotations, shorten, type PaceAnnotation } from "./annotation-types";
import { formatRange } from "./format";

export type { PaceAnnotation } from "./annotation-types";

// What explains a month, for the markers on the Pace chart: marketing calendar entries, call notes, the first day a discount
// code appears on orders, and suspected stockouts. Read-only, tenant-scoped, and capped (see capAnnotations). Calendar text and
// call notes are text people wrote, so they go through as plain text only; they are never read as instructions or as figures.

const QUIET_RUN_DAYS = 3; // a stockout marker needs this many days in a row with no sales; one or two quiet days are only noise
const SCAN_BACK_DAYS = 14; // a quiet spell that began just before the month still shows, on the first
const FETCH = 40;

const longDay = (ymd: string) => new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", timeZone: "UTC" }).format(new Date(`${ymd}T00:00:00Z`));
const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;
const words = (s: string) => s.replace(/_/g, " ").trim();
const sentence = (s: string) => (s.length > 0 ? s[0]!.toUpperCase() + s.slice(1) : s);

// The note's gist for a hover card: the first plain paragraph after its headings (skipping the bold "Date:" style lines), without markdown.
export function noteExcerpt(body: string): string {
  const para = body
    .replace(/\r/g, "")
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l !== "" && !l.startsWith("#") && !/^\*\*[^*]+:\*\*/.test(l) && !/^[-*]\s/.test(l));
  const bullet = body.split("\n").find((l) => /^\s*[-*]\s+\S/.test(l));
  const text = (para ?? bullet ?? "").replace(/^\s*[-*]\s+/, "").replace(/[*_`]/g, "");
  return shorten(text, 200);
}

interface Candidates {
  inMonth: PaceAnnotation[]; // calendar entries and call notes
  codes: PaceAnnotation[];
  stockouts: PaceAnnotation[];
}

async function calendarAndNotes(db: Db, tenantId: string, ms: string, me: string): Promise<PaceAnnotation[]> {
  const events = await db
    .select()
    .from(calendarEvents)
    .where(and(eq(calendarEvents.tenantId, tenantId), lte(calendarEvents.dateFrom, me), gte(calendarEvents.dateTo, ms)))
    .orderBy(asc(calendarEvents.dateFrom), asc(calendarEvents.title))
    .limit(FETCH);
  const notes = await db
    .select()
    .from(callNotes)
    .where(and(eq(callNotes.tenantId, tenantId), gte(callNotes.heldOn, ms), lte(callNotes.heldOn, me)))
    .orderBy(asc(callNotes.heldOn), asc(callNotes.title))
    .limit(FETCH);
  const out: PaceAnnotation[] = [];
  for (const e of events) {
    const head = [sentence(words(e.type)), e.channel.trim(), e.dateTo === e.dateFrom ? null : formatRange(e.dateFrom, e.dateTo)].filter(Boolean).join(" · ");
    out.push({ date: e.dateFrom < ms ? ms : e.dateFrom, kind: "calendar", label: shorten(e.title, 70), detail: shorten(e.details.trim() ? `${head}. ${e.details}` : head, 240) });
  }
  for (const n of notes) out.push({ date: n.heldOn, kind: "note", label: shorten(n.title, 70), detail: noteExcerpt(n.body) || undefined });
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

// The first day each code shows up on orders, for codes that first show up in this month. A month at the very start of the data
// can't say a code is new, so it gets none.
async function newCodes(db: Db, tenantId: string, ms: string, end: string, firstDay: string | null): Promise<PaceAnnotation[]> {
  if (!firstDay || firstDay >= ms) return [];
  const rows = await db
    .select({ code: orders.discountCode, date: orders.localDate, n: sql<number>`count(*)::int` })
    .from(orders)
    .where(and(eq(orders.tenantId, tenantId), isNull(orders.cancelledAt), isNotNull(orders.discountCode), lte(orders.localDate, end)))
    .groupBy(orders.discountCode, orders.localDate);
  const byCode = new Map<string, { first: string; onFirst: number; inMonth: number }>();
  for (const r of rows) {
    const code = r.code?.trim();
    if (!code) continue;
    const cur = byCode.get(code) ?? { first: r.date, onFirst: 0, inMonth: 0 };
    if (r.date < cur.first) {
      cur.first = r.date;
      cur.onFirst = 0;
    }
    if (r.date === cur.first) cur.onFirst = r.n;
    if (r.date >= ms) cur.inMonth += r.n;
    byCode.set(code, cur);
  }
  return [...byCode.entries()]
    .filter(([, c]) => c.first >= ms)
    .sort(([ca, a], [cb, b]) => b.inMonth - a.inMonth || a.first.localeCompare(b.first) || ca.localeCompare(cb))
    .map(([code, c]) => ({
      date: c.first,
      kind: "code" as const,
      label: shorten(code, 40),
      detail: `First seen on orders on ${longDay(c.first)}: ${count(c.onFirst, "order")} that day, ${count(c.inMonth, "order")} so far this month.`,
    }));
}

interface Run {
  variantId: string;
  from: string;
  to: string;
  days: number;
  before: number; // units a day over the 28 days before the run began
}

// Spells of no sales for a variant that had been selling: a spell starts on a day with no sales that zeroSalesDaysOf accepts
// (the variant averaged 0.5 units a day or more before it) right after a day with sales, and lasts until the next sale or the
// last complete day. Only spells of at least QUIET_RUN_DAYS that reach into the month are kept.
function quietRuns(byVariant: Map<string, Map<string, number>>, ms: string, end: string): Run[] {
  const scanFrom = addDays(ms, -SCAN_BACK_DAYS);
  const runs: Run[] = [];
  for (const [variantId, perDay] of byVariant) {
    for (const from of zeroSalesDaysOf(perDay, { from: scanFrom, to: end })) {
      if ((perDay.get(addDays(from, -1)) ?? 0) <= 0) continue; // inside a spell already counted from its first day
      let to = from;
      while (to < end && (perDay.get(addDays(to, 1)) ?? 0) <= 0) to = addDays(to, 1);
      const days = daysBetween(from, to) + 1;
      if (days < QUIET_RUN_DAYS || to < ms) continue;
      let prior = 0;
      for (let k = 1; k <= STOCKOUT_LOOKBACK_DAYS; k++) prior += perDay.get(addDays(from, -k)) ?? 0;
      runs.push({ variantId, from, to, days, before: prior / STOCKOUT_LOOKBACK_DAYS });
    }
  }
  return runs;
}

// One marker per product, for its longest spell, longest first.
async function stockouts(db: Db, tenantId: string, ms: string, end: string): Promise<PaceAnnotation[]> {
  const byVariant = await unitsByVariantDay(db, tenantId, { from: addDays(ms, -SCAN_BACK_DAYS - STOCKOUT_LOOKBACK_DAYS), to: end });
  const runs = quietRuns(byVariant, ms, end);
  if (runs.length === 0) return [];
  const info = await db
    .select({ id: variants.id, variant: variants.title, productId: variants.productId, product: products.title })
    .from(variants)
    .innerJoin(products, and(eq(products.tenantId, variants.tenantId), eq(products.id, variants.productId)))
    .where(and(eq(variants.tenantId, tenantId), inArray(variants.id, [...new Set(runs.map((r) => r.variantId))])));
  const byId = new Map(info.map((v) => [v.id, v]));
  const best = new Map<string, { run: Run; product: string; variant: string }>();
  for (const run of runs) {
    const v = byId.get(run.variantId);
    if (!v) continue;
    const cur = best.get(v.productId);
    if (!cur || run.days > cur.run.days || (run.days === cur.run.days && run.from < cur.run.from)) best.set(v.productId, { run, product: v.product, variant: v.variant });
  }
  return [...best.values()]
    .sort((a, b) => b.run.days - a.run.days || a.run.from.localeCompare(b.run.from) || a.product.localeCompare(b.product))
    .map(({ run, product, variant }) => {
      const named = variant && variant !== "Default Title" ? `${product} (${variant})` : product;
      return {
        date: run.from < ms ? ms : run.from,
        kind: "stockout" as const,
        label: shorten(named, 70),
        detail: `No units sold for ${count(run.days, "day")} in a row from ${longDay(run.from)}${run.to === end ? " (none on the last complete day either)" : ""}, after selling about ${(Math.round(run.before * 10) / 10).toFixed(1)} a day. A possible stockout, not confirmed.`,
      };
    });
}

export interface PaceAnnotationOptions {
  through?: string; // the last complete day: sales-based markers stop there. Default: the newest day in the data
  internal?: boolean; // include calendar entries and call notes, which a client viewer is not offered. Default true
}

// The markers for one month (YYYY-MM) of a tenant's Pace chart, in date order. The tenant comes from the caller's session,
// never from a request body.
export async function loadPaceAnnotations(db: Db, tenantId: string, month: string, opts: PaceAnnotationOptions = {}): Promise<PaceAnnotation[]> {
  const ms = monthStart(month);
  const me = monthEnd(month);
  const win = await loadWindow(db, tenantId);
  const cands: Candidates = { inMonth: [], codes: [], stockouts: [] };
  if (opts.internal !== false) cands.inMonth = await calendarAndNotes(db, tenantId, ms, me);
  const end = [opts.through ?? me, me, win.last ?? ""].filter(Boolean).reduce((a, b) => (a < b ? a : b));
  if (win.last && end >= ms) {
    cands.codes = await newCodes(db, tenantId, ms, end, win.first);
    cands.stockouts = await stockouts(db, tenantId, ms, end);
  }
  return capAnnotations([...cands.inMonth, ...cands.codes, ...cands.stockouts]);
}
