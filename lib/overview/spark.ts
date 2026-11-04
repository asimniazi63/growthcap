import { formatUnit, monthName } from "../pace/format";
import type { PaceSeries } from "../pace/series";

// The month's net sales so far for a sparkline: the cumulative figure for each complete day and the plan to the same day. It is read
// from the series the Pace view already builds (net sales by day through the last complete day), so it costs no extra query and its last
// point is the headline figure. Money is integer cents.
export interface SparkData {
  values: number[]; // cumulative net sales at the end of each complete day
  plan: number[]; // cumulative plan to the same days
  firstDay: string; // YYYY-MM-DD
  lastDay: string;
}

// Null when there is no series, or fewer than two complete days (one point is not a line).
export function netSalesSpark(series: PaceSeries | null | undefined): SparkData | null {
  if (!series) return null;
  const done = series.days.filter((d): d is typeof d & { actual: number } => d.actual !== null);
  if (done.length < 2) return null;
  return { values: done.map((d) => d.actual), plan: done.map((d) => d.plan), firstDay: done[0]!.date, lastDay: done[done.length - 1]!.date };
}

const monthDay = (ymd: string) => new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", timeZone: "UTC" }).format(new Date(`${ymd}T00:00:00Z`));

// What a screen reader hears for the sparkline: the first and last value and the plan to date, in words.
// "Net sales so far this month, running total, from $120.00 on October 1 to $12,345.67 on October 30. Plan to date $11,000.00."
// For a month that is over (`closedMonth`, YYYY-MM) it names the month and the plan is the month's: "Net sales in October 2026, …
// Plan for the month $11,000.00."
export function netSalesSparkLabel(spark: SparkData, currency: string, closedMonth?: string): string {
  const money = (cents: number) => formatUnit("money", cents, currency);
  const first = money(spark.values[0]!);
  const last = money(spark.values[spark.values.length - 1]!);
  const plan = money(spark.plan[spark.plan.length - 1]!);
  const span = `running total, from ${first} on ${monthDay(spark.firstDay)} to ${last} on ${monthDay(spark.lastDay)}`;
  return closedMonth ? `Net sales in ${monthName(closedMonth)}, ${span}. Plan for the month ${plan}.` : `Net sales so far this month, ${span}. Plan to date ${plan}.`;
}
