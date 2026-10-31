import { METRICS, type MetricId } from "../metrics/registry";

// Plain-words figures for the pace screen. Money arrives in cents and rates as fractions.

export function formatValue(metric: MetricId, value: number, currency: string): string {
  const unit = METRICS[metric].unit;
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
