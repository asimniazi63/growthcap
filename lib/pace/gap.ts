import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { planTargets, plans } from "../db/schema";
import { monthEnd, monthOf } from "../metrics/dates";
import { METRICS, type MetricId } from "../metrics/registry";
import { isPaced, PLAN_METRICS, type PacedMetric, type PlanMetric } from "./metrics";
import { dayWeights, landing, shareThrough } from "./shape";

export type PlanTargets = Map<string, Partial<Record<PlanMetric, number>>>; // month (YYYY-MM) -> metric -> target

export async function loadPlan(db: Db, tenantId: string): Promise<{ id: string; label: string; targets: PlanTargets } | null> {
  const [plan] = await db.select().from(plans).where(and(eq(plans.tenantId, tenantId), eq(plans.active, true))).limit(1);
  if (!plan) return null;
  const rows = await db.select().from(planTargets).where(and(eq(planTargets.tenantId, tenantId), eq(planTargets.planId, plan.id)));
  const targets: PlanTargets = new Map();
  for (const r of rows) {
    if (!(PLAN_METRICS as readonly string[]).includes(r.metric)) continue;
    targets.set(r.month, { ...targets.get(r.month), [r.metric as PlanMetric]: r.value });
  }
  return { id: plan.id, label: plan.label, targets };
}

export interface PlanGap {
  month: string; // the plan month used
  target: number; // the month's target
  planned: number; // the plan for the days in the range: the target itself for a whole month, an average or a rate
  actual: number;
  gap: number; // actual minus planned
  pctGap: number | null; // gap as a fraction of planned (null when nothing is planned yet)
  projected?: number; // month to date only: where the month will land (an estimate)
  spread?: "last_year" | "even"; // how the target was spread over the days (totals and counts only)
  throughDate: string; // the last day counted
}
export type PlanGapMap = Partial<Record<PlanMetric, PlanGap>>;

export interface PlanGapInput {
  plan: PlanTargets | null;
  range: { from: string; to: string };
  metrics: MetricId[];
  values: Partial<Record<MetricId, number>>; // the actual values for the range
  // Last year's same month, one value per day (day 1 first), or null when the data doesn't cover that month.
  lastYearDaily: (month: string, metric: PacedMetric) => Promise<number[] | null>;
}

// Money to whole cents, counts to one decimal, rates to four: the figures an answer can quote add up (gap = actual - planned).
function roundFor(metric: PlanMetric, x: number): number {
  const unit = METRICS[metric].unit;
  if (unit === "money") return Math.round(x);
  if (unit === "rate") return Math.round(x * 1e4) / 1e4;
  return Math.round(x * 10) / 10;
}

// How a range inside one month stands against that month's plan. Undefined when it can't be said: no plan, a range that
// spans months, a month the plan doesn't cover, or no asked-for metric with a target.
export async function planGap(input: PlanGapInput): Promise<PlanGapMap | undefined> {
  const { plan, range, metrics, values } = input;
  if (!plan) return undefined;
  const month = monthOf(range.from);
  if (monthOf(range.to) !== month) return undefined;
  const targets = plan.get(month);
  if (!targets) return undefined;

  const days = Number(monthEnd(month).slice(8));
  const fromDay = Number(range.from.slice(8));
  const toDay = Number(range.to.slice(8));
  const wholeMonth = fromDay === 1 && toDay >= days;
  const out: PlanGapMap = {};

  for (const metric of PLAN_METRICS) {
    const target = targets[metric];
    const actualRaw = values[metric];
    if (target === undefined || actualRaw === undefined || !metrics.includes(metric)) continue;

    let plannedRaw = target;
    let projectedRaw: number | undefined;
    let spread: PlanGap["spread"];
    if (isPaced(metric)) {
      const daily = await input.lastYearDaily(month, metric);
      spread = daily && daily.some((v) => v > 0) ? "last_year" : "even";
      const weights = dayWeights(days, daily);
      if (!wholeMonth) {
        plannedRaw = target * shareThrough(weights, fromDay, toDay);
        if (fromDay === 1 && toDay < days) {
          const rest = target * shareThrough(weights, toDay + 1, days);
          projectedRaw = landing(actualRaw, plannedRaw, rest) ?? undefined;
        }
      }
    }

    const planned = roundFor(metric, plannedRaw);
    const actual = roundFor(metric, actualRaw);
    const gap = roundFor(metric, actual - planned);
    out[metric] = {
      month,
      target: roundFor(metric, target),
      planned,
      actual,
      gap,
      pctGap: planned === 0 ? null : Math.round((gap / planned) * 1e4) / 1e4,
      ...(projectedRaw !== undefined ? { projected: roundFor(metric, projectedRaw) } : {}),
      ...(spread ? { spread } : {}),
      throughDate: range.to,
    };
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
