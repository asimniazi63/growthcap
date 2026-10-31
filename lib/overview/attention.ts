import { METRICS, type MetricId } from "../metrics/registry";
import { formatGap, formatValue } from "../pace/format";
import type { PlanGap, PlanGapMap } from "../pace/gap";
import type { PlanMetric } from "../pace/metrics";
import type { InventoryRow } from "../tools/inventory";

// What the Overview page flags, worked out in code from the pace view and the stock tool. Every figure here is formatted from
// a query result; nothing is written by the model. Product and variant titles are store text: callers render them as text.

export type Severity = "behind" | "warn" | "info";

export interface AttentionItem {
  key: string;
  severity: Severity;
  title: string;
  detail: string;
  question: string; // opened in Chat from the row's button
  cta: string;
  cover?: number; // 0 to 1: the share of 30 days of stock left, for the small bar
}

export const COVER_DAYS = 30; // below this much cover a variant is flagged
const URGENT_DAYS = 7;
const MAX_ROWS = 3;
const RANK: Record<Severity, number> = { behind: 0, warn: 1, info: 2 };
const PLURAL = new Set<PlanMetric>(["net_sales", "orders", "new_customer_orders"]);

const count = (n: number, max = 0) => new Intl.NumberFormat("en-US", { maximumFractionDigits: max }).format(n);
const units = (n: number) => `${count(n)} ${n === 1 ? "unit" : "units"}`;

function pace(row: InventoryRow): string {
  if (row.dailyRate >= 1) return `selling about ${count(row.dailyRate, row.dailyRate < 10 ? 1 : 0)} a day`;
  return `selling about ${count(row.dailyRate * 7, 1)} a week`;
}

// The variant that runs out soonest. `rows` come from getInventory, soonest first; `total` is how many are at 30 days of
// cover or less.
export function stockItem(rows: InventoryRow[], total: number): AttentionItem | null {
  const worst = rows[0];
  if (!worst) return null;
  const { product, variant } = worst.untrusted;
  const name = !variant || variant === "Default Title" ? product : `${product} (${variant})`;
  const out = worst.available <= 0;
  const days = worst.daysOfCover ?? COVER_DAYS;
  const rounded = Math.round(days);
  const title = out ? `${name} is out of stock` : days < 1 ? `${name} runs out in less than a day` : `${name} runs out in about ${rounded} ${rounded === 1 ? "day" : "days"}`;
  const more = total - 1;
  const detail = `${out ? "0 units left" : `${units(worst.available)} left`}, ${pace(worst)}.${more > 0 ? ` ${more} more ${more === 1 ? "variant has" : "variants have"} ${COVER_DAYS} days of cover or less.` : ""}`;
  return {
    key: "stock",
    severity: out || days <= URGENT_DAYS ? "behind" : "warn",
    title,
    detail,
    question: "Which variants are about to run out of stock?",
    cta: "Ask why",
    cover: out ? 0 : Math.min(1, Math.max(0, days / COVER_DAYS)),
  };
}

const lower = (metric: PlanMetric) => METRICS[metric as MetricId].label.toLowerCase();

function gapRow(metric: PlanMetric, g: PlanGap, currency: string, kind: "behind" | "ahead"): AttentionItem {
  const label = METRICS[metric as MetricId].label;
  const verb = PLURAL.has(metric) ? "are" : "is";
  const text = formatGap(metric as MetricId, g.gap, currency).text;
  const actual = formatValue(metric as MetricId, g.actual, currency);
  const planned = formatValue(metric as MetricId, g.planned, currency);
  const pct = g.pctGap ?? 0;
  return {
    key: `${kind}-${metric}`,
    severity: kind === "ahead" ? "info" : pct <= -0.1 ? "behind" : "warn",
    title: `${label} ${verb} ${text}`,
    detail: `${actual} so far against ${planned} planned.`,
    question: kind === "behind" ? `Why ${PLURAL.has(metric) ? "are" : "is"} ${lower(metric)} behind plan?` : `What is driving the lift in ${lower(metric)}?`,
    cta: kind === "behind" ? "Ask why" : "See what drove it",
  };
}

// The metric furthest behind its plan and the one furthest ahead, by share of plan (units differ between metrics).
export function planGapItems(gaps: PlanGapMap | undefined, currency: string): { behind: AttentionItem | null; ahead: AttentionItem | null } {
  let behind: [PlanMetric, PlanGap] | null = null;
  let ahead: [PlanMetric, PlanGap] | null = null;
  for (const [metric, g] of Object.entries(gaps ?? {}) as [PlanMetric, PlanGap][]) {
    if (!g || g.pctGap === null || g.gap === 0) continue;
    if (g.gap < 0 && (!behind || g.pctGap < (behind[1].pctGap ?? 0))) behind = [metric, g];
    if (g.gap > 0 && (!ahead || g.pctGap > (ahead[1].pctGap ?? 0))) ahead = [metric, g];
  }
  return {
    behind: behind ? gapRow(behind[0], behind[1], currency, "behind") : null,
    ahead: ahead ? gapRow(ahead[0], ahead[1], currency, "ahead") : null,
  };
}

export interface AttentionInput {
  gaps?: PlanGapMap; // this month's gaps, when the month has started and the plan has targets
  currency: string;
  stock: { rows: InventoryRow[]; total: number } | null; // null when the stock check failed
}

// At most three rows, most urgent first. With nothing behind plan and nothing low on stock, a good-news row leads.
export function buildAttention({ gaps, currency, stock }: AttentionInput): AttentionItem[] {
  const { behind, ahead } = planGapItems(gaps, currency);
  const low = stock ? stockItem(stock.rows, stock.total) : null;
  const items: AttentionItem[] = [];
  if (low) items.push(low);
  if (behind) items.push(behind);
  if (!low && !behind && (gaps || stock)) {
    items.push({
      key: "clear",
      severity: "info",
      title: gaps ? "Nothing is behind plan this month" : "No variant is running low on stock",
      detail: [gaps ? "Every metric with a target is on or ahead of it." : null, stock ? `No variant is under ${COVER_DAYS} days of stock cover.` : null].filter(Boolean).join(" "),
      question: "How is this month going against plan?",
      cta: "Ask",
    });
  }
  if (ahead) items.push(ahead);
  return items.map((it, i) => ({ it, i })).sort((a, b) => RANK[a.it.severity] - RANK[b.it.severity] || a.i - b.i).map((x) => x.it).slice(0, MAX_ROWS);
}
