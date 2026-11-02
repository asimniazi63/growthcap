import { METRICS, type MetricId, type MetricUnit } from "../metrics/registry";

// Plain-words figures for the pace screen. Money arrives in cents and rates as fractions.

export function formatValue(metric: MetricId, value: number, currency: string): string {
  return formatUnit(METRICS[metric].unit, value, currency);
}

export function formatUnit(unit: MetricUnit, value: number, currency: string): string {
  if (unit === "money") return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(value / 100);
  if (unit === "rate") return `${(value * 100).toFixed(1)}%`;
  if (unit === "ratio") return `${value.toFixed(2)}x`;
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value);
}

export type Tone = "ahead" | "behind" | "even";

// "$604.88 behind plan": the size and the direction in words, never a minus sign. A rate's gap is in percentage points.
export function formatGap(metric: MetricId, gap: number, currency: string): { text: string; tone: Tone } {
  if (gap === 0) return { text: "on plan", tone: "even" };
  const tone: Tone = gap > 0 ? "ahead" : "behind";
  const size = Math.abs(gap);
  const body = METRICS[metric].unit === "rate" ? `${(size * 100).toFixed(1)} points` : formatValue(metric, size, currency);
  return { text: `${body} ${tone === "ahead" ? "ahead of" : "behind"} plan`, tone };
}

export function formatPct(fraction: number | null): string | null {
  if (fraction === null) return null;
  return `${(Math.abs(fraction) * 100).toFixed(1)}% ${fraction < 0 ? "behind" : "ahead"}`;
}

export function monthName(month: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, 1)));
}

// "up 4.0%" or "down 28.3%": a change over the earlier period, in words.
export function formatMove(fraction: number | null | undefined): string | null {
  if (fraction === null || fraction === undefined) return null;
  const pct = (Math.abs(fraction) * 100).toFixed(1);
  return fraction === 0 ? "no change" : `${fraction > 0 ? "up" : "down"} ${pct}%`;
}

// "September 1 to 30, 2026" or "September 28 to October 3, 2026".
export function formatRange(from: string, to: string): string {
  const day = (ymd: string, withMonth: boolean) => new Intl.DateTimeFormat("en-US", withMonth ? { month: "long", day: "numeric", timeZone: "UTC" } : { day: "numeric", timeZone: "UTC" }).format(new Date(`${ymd}T00:00:00Z`));
  if (from === to) return `${day(from, true)}, ${from.slice(0, 4)}`;
  const sameMonth = from.slice(0, 7) === to.slice(0, 7);
  return `${day(from, true)} to ${day(to, !sameMonth)}, ${to.slice(0, 4)}`;
}

// While a month is too young for a month-end estimate (see MIN_DAYS_FOR_ESTIMATE) these stand in its place and say why.
export interface EarlyMonth {
  daysCounted: number;
  estimateAfterDays: number;
}
const dayCount = (n: number) => `${n} complete ${n === 1 ? "day" : "days"}`;
export const estimateWait = (e: EarlyMonth) => `Needs ${dayCount(e.estimateAfterDays)} (${e.daysCounted} so far)`; // where the figure would be
export const estimateWaitShort = (e: EarlyMonth) => `No estimate yet (${e.daysCounted} of ${e.estimateAfterDays} days)`; // inside a card or a table cell
export const earlyBasis = (e: EarlyMonth) => `Based on ${dayCount(e.daysCounted)}`; // under the ahead or behind badge
