import { isDemoClock } from "../clock";
import type { Db } from "../db/client";
import { AppError } from "../errors";
import { addDays, addMonths, monthEnd, monthOf, monthStart } from "../metrics/dates";
import { queryMetric } from "../metrics/query";
import type { MetricId } from "../metrics/registry";
import type { TenantContext } from "../tenancy/context";
import { asOfOf, dbFor, loadWindow, todayFor } from "../tools/common";
import { requireConnectedShop } from "../tools/result";
import { loadPlan, type PlanGapMap } from "./gap";
import { PLAN_METRICS } from "./metrics";

export interface PaceSection {
  range: { from: string; to: string };
  gaps?: PlanGapMap; // absent when the plan has no targets for that month
  queryId: string;
}

export interface PaceView {
  today: string; // the store's today (the day after the newest order, on a demo store)
  month: string; // this month, YYYY-MM
  through: string; // the last complete day counted: yesterday
  started: boolean; // false on the first day of a month: nothing is complete yet
  demoClock: boolean;
  hasPlan: boolean;
  planLabel: string | null;
  asOf: string; // when the data was last synced
  thisMonth: PaceSection | null;
  lastMonth: (PaceSection & { month: string }) | null;
}

// What /pace shows, from the same metric query the agent uses: this month through yesterday (complete days only, so a
// day in progress doesn't read as a shortfall), and last month whole. Both come with gapToPlan.
export async function getPaceView(ctx: TenantContext, deps: { db?: Db } = {}): Promise<PaceView> {
  const shop = requireConnectedShop(ctx);
  const db = await dbFor(deps);
  const win = await loadWindow(db, ctx.tenantId);
  const today = todayFor(shop.timezone, win);
  const month = monthOf(today);
  const through = addDays(today, -1);
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

  return {
    today,
    month,
    through,
    started,
    demoClock: isDemoClock(shop.timezone, win.newest),
    hasPlan: plan !== null,
    planLabel: plan?.label ?? null,
    asOf: asOfOf(win),
    thisMonth,
    lastMonth: last ? { month: prev, ...last } : null,
  };
}
