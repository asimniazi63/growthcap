import { isDemoClock } from "../clock";
import type { Db } from "../db/client";
import { AppError } from "../errors";
import { addDays, addMonths, monthEnd, monthOf, monthStart } from "../metrics/dates";
import { queryMetric } from "../metrics/query";
import type { MetricId } from "../metrics/registry";
import type { TenantContext } from "../tenancy/context";
import { asOfOf, dbFor, loadWindow, todayFor, type DataWindow } from "../tools/common";
import { requireConnectedShop } from "../tools/result";
import { loadPlan, type PlanGapMap } from "./gap";
import { PLAN_METRICS } from "./metrics";
import { buildPaceSeries, type PaceSeries } from "./series";

export interface PaceSection {
  range: { from: string; to: string };
  gaps?: PlanGapMap; // absent when the plan has no targets for that month
  queryId: string;
}

// The view is for one month: this month by default, or a past month the page asked for (?month=YYYY-MM). `thisMonth` keeps its
// name for the shown month's figures, so for a past month it holds that month whole.
export interface PaceView {
  today: string; // the store's today (the day after the newest order, on a demo store)
  current: string; // this month, YYYY-MM, whatever month is shown
  month: string; // the month shown, YYYY-MM: this month, or the past month asked for
  closed: boolean; // true when the month shown is over: whole-month figures, so no estimate and no "need $X a day"
  through: string; // the last complete day counted: yesterday for this month, the month's last day for a past one
  started: boolean; // false on the first day of a month: nothing is complete yet (always true for a past month)
  demoClock: boolean;
  hasPlan: boolean;
  planLabel: string | null;
  asOf: string; // when the data was last synced
  thisMonth: PaceSection | null; // the month shown: month to date, or the whole month when `closed`
  lastMonth: (PaceSection & { month: string }) | null; // the month before the one shown, whole
  series?: PaceSeries | null; // net sales day by day for the chart; null when the month has no net sales target or the days can't be read
}

// Net sales by day, in cents, from the same metric query the page uses. A day with no orders is simply absent.
async function dailyNetSales(ctx: TenantContext, db: Db, from: string, to: string): Promise<Map<string, number>> {
  const res = await queryMetric(ctx, { metrics: ["net_sales"], from, to, groupBy: ["day"], limit: 200 }, { db });
  const out = new Map<string, number>();
  for (const row of res.data) {
    const day = row.group.day;
    if (day) out.set(day, row.values.net_sales ?? 0);
  }
  return out;
}

// The chart's series for net sales, or null if anything it needs can't be read. The plan is spread exactly as the gap spread it.
async function netSalesSeries(ctx: TenantContext, db: Db, win: DataWindow, month: string, through: string, gaps: PlanGapMap): Promise<PaceSeries | null> {
  const g = gaps.net_sales;
  if (!g || !g.spread) return null;
  try {
    const lyFrom = monthStart(addMonths(month, -12));
    const lyTo = monthEnd(addMonths(month, -12));
    const wantsPattern = g.spread === "last_year" && !!win.first && !!win.last && win.first <= lyFrom && win.last >= lyTo;
    const [dailyActual, lastYear] = await Promise.all([dailyNetSales(ctx, db, monthStart(month), through), wantsPattern ? dailyNetSales(ctx, db, lyFrom, lyTo) : Promise.resolve(null)]);
    if (dailyActual.size === 0) return null;
    const lastYearDaily = lastYear ? Array.from({ length: Number(lyTo.slice(8)) }, (_, i) => lastYear.get(addDays(lyFrom, i)) ?? 0) : null;
    return buildPaceSeries({ month, through, target: g.target, planned: g.planned, actual: g.actual, projected: g.projected ?? null, spread: g.spread, dailyActual, lastYearDaily });
  } catch {
    return null; // the page falls back to the cards
  }
}

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

// The month a page may show: a past month inside the data, asked for as YYYY-MM. Anything else (malformed, this month, a
// future month, or a month before the first order) is this month.
export function chooseMonth(asked: string | undefined, current: string, firstDay: string | null): string {
  if (!asked || !MONTH.test(asked) || asked >= current) return current;
  if (!firstDay || asked < monthOf(firstDay)) return current;
  return asked;
}

// A ?month= search param as a page receives it: the value when there is exactly one, else undefined (getPaceView then
// checks it is a past month in the data).
export const monthParam = (asked: string | string[] | undefined): string | undefined => (typeof asked === "string" ? asked : undefined);

// One month in a page's month picker. `netSales` is the month's net sales against its whole-month target, for a past month
// with a target; absent for this month (still running) and for a month the plan doesn't cover.
export interface PaceMonth {
  month: string; // YYYY-MM
  closed: boolean; // false for this month
  netSales?: { actual: number; target: number; gap: number; pctGap: number | null }; // cents
}

// Every month from the first order to this month, newest first, with each past month's net sales against its target: what
// the month pickers list. One grouped query for the actuals, so it is cheap enough to load next to the view.
export async function listPaceMonths(ctx: TenantContext, deps: { db?: Db } = {}): Promise<PaceMonth[]> {
  const shop = requireConnectedShop(ctx);
  const db = await dbFor(deps);
  const win = await loadWindow(db, ctx.tenantId);
  if (!win.first) return [];
  const today = todayFor(shop.timezone, win);
  const current = monthOf(today);
  const first = monthOf(win.first);
  const lastClosed = addMonths(current, -1);
  const plan = await loadPlan(db, ctx.tenantId);

  const actuals = new Map<string, number>();
  if (first <= lastClosed) {
    const res = await queryMetric(ctx, { metrics: ["net_sales"], from: monthStart(first), to: monthEnd(lastClosed), groupBy: ["month"], limit: 200 }, { db });
    for (const row of res.data) if (row.group.month) actuals.set(row.group.month.slice(0, 7), row.values.net_sales ?? 0);
  }

  const out: PaceMonth[] = [];
  for (let m = current; m >= first; m = addMonths(m, -1)) {
    const closed = m < current;
    const target = plan?.targets.get(m)?.net_sales;
    const actual = actuals.get(m);
    if (closed && target !== undefined && target > 0 && actual !== undefined) {
      const gap = Math.round(actual - target);
      out.push({ month: m, closed, netSales: { actual: Math.round(actual), target: Math.round(target), gap, pctGap: Math.round((gap / target) * 1e4) / 1e4 } });
    } else {
      out.push({ month: m, closed });
    }
  }
  return out;
}

// What /pace shows, from the same metric query the agent uses: this month through yesterday (complete days only, so a
// day in progress doesn't read as a shortfall), and last month whole. Both come with gapToPlan. With `month` set to a past
// month, that month is shown whole instead, and the month before it is "last month".
export async function getPaceView(ctx: TenantContext, deps: { db?: Db; month?: string } = {}): Promise<PaceView> {
  const shop = requireConnectedShop(ctx);
  const db = await dbFor(deps);
  const win = await loadWindow(db, ctx.tenantId);
  const today = todayFor(shop.timezone, win);
  const current = monthOf(today);
  const month = chooseMonth(deps.month, current, win.first);
  const closed = month < current;
  const through = closed ? monthEnd(month) : addDays(today, -1);
  const plan = await loadPlan(db, ctx.tenantId);

  const section = async (from: string, to: string): Promise<PaceSection | null> => {
    try {
      const res = await queryMetric(ctx, { metrics: [...PLAN_METRICS] as MetricId[], from, to }, { db });
      return { range: { from, to }, gaps: res.data[0]?.gapToPlan, queryId: res.queryId };
    } catch (e) {
      if (e instanceof AppError && e.code === "NO_DATA") return null; // nothing in the data for that stretch
      throw e;
    }
  };

  const started = through >= monthStart(month);
  const prev = addMonths(month, -1);
  const [thisMonth, last] = await Promise.all([started ? section(monthStart(month), through) : Promise.resolve(null), section(monthStart(prev), monthEnd(prev))]);

  const series = thisMonth?.gaps ? await netSalesSeries(ctx, db, win, month, through, thisMonth.gaps) : null;

  return {
    today,
    current,
    month,
    closed,
    through,
    started,
    demoClock: isDemoClock(shop.timezone, win.newest),
    hasPlan: plan !== null,
    planLabel: plan?.label ?? null,
    asOf: asOfOf(win),
    thisMonth,
    lastMonth: last ? { month: prev, ...last } : null,
    series,
  };
}
