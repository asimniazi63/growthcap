import { z } from "zod";
import type { Db } from "../db/client";
import { AppError } from "../errors";
import { addMonths, monthEnd, monthOf, monthStart } from "../metrics/dates";
import { loadCustomerHistories, repeatRateOf, type CohortFilter } from "../metrics/cohorts";
import { METRICS } from "../metrics/registry";
import { assertInWindow, asOfOf, dbFor, loadWindow, parseInput, periodShape, queryIdFor, resolveRange, todayFor, type Ctx } from "./common";
import type { TenantContext } from "../tenancy/context";
import { requireConnectedShop, type ToolResult } from "./result";

export const COHORT_WINDOWS = [30, 60, 180] as const;
const MAX_COHORT_MONTHS = 24;

// strictObject: an unknown key (a tenant, a shop, anything the model invents) is an error, not ignored.
export const getCohortsInputSchema = z.strictObject({
  ...periodShape, // the cohort period: customers whose FIRST order falls in it (default: the last 12 months)
  windowDays: z.union([z.literal(30), z.literal(60), z.literal(180)]).optional(), // for the summary; default 30
  firstOrderCode: z.string().min(1).max(100).optional(),
  excludeFirstOrderCode: z.string().min(1).max(100).optional(),
  excludeTags: z.array(z.string().min(1).max(100)).max(10).optional(), // drop cohorts whose first order carries one of these tags (for example wholesale)
  grid: z.boolean().optional(), // include the month-by-month grid (default true)
  maxMonthsSince: z.number().int().min(1).max(12).optional(), // grid columns, in 30-day months (default 6)
});
export type GetCohortsInput = z.input<typeof getCohortsInputSchema>;

export interface CohortSummary {
  windowDays: number;
  firstOrderCode?: string;
  cohortCustomers: number; // customers whose first order is in the period
  customers: number; // those counted: first order at least windowDays old
  repeaters: number;
  repeatRate: number | null; // fraction; null when nobody is old enough yet
  notYetObserved: number; // cohort customers still inside their window, left out of the rate
}

export interface CohortCell {
  cohort: string; // the month of the first order, YYYY-MM
  monthsSince: number; // 30-day months after the first order: 1 means ordered again within 30 days
  windowDays: number;
  cohortCustomers: number; // all customers whose first order was in that month
  customers: number; // those counted in this cell (first order at least windowDays old)
  repeaters: number;
  repeatShare: number | null; // repeaters / customers, a fraction; null when nobody is old enough yet
}

export interface CohortsData {
  summary: CohortSummary;
  cells: CohortCell[];
}

const DEFINITIONS = {
  repeat_rate: METRICS.repeat_rate.definition,
  cells: "Each cell is one first-order month (cohort) and one window: monthsSince months of 30 days after the first order. repeatShare is the share of that month's new customers (customers counted: first order at least that many days old) who ordered again by then, so it can only grow along a row. A cell with no customers old enough yet has a null share.",
};

// Repeat rate for a cohort, and the first-order-month grid, from the customers' orders. The tenant is the session's.
export async function getCohorts(ctx: Ctx, rawInput: GetCohortsInput, deps: { db?: Db } = {}): Promise<ToolResult<CohortsData>> {
  const shop = requireConnectedShop(ctx);
  const input = parseInput(getCohortsInputSchema, rawInput);
  const db = await dbFor(deps);
  const win = await loadWindow(db, ctx.tenantId);
  const today = todayFor(shop.timezone, win);
  const hasRange = input.period !== undefined || input.from !== undefined || input.to !== undefined;
  const range = hasRange ? resolveRange(input, today) : { from: monthStart(addMonths(monthOf(today), -11)), to: today };
  assertInWindow(range, win);
  const asOf = win.last!;

  const months: string[] = [];
  for (let m = monthOf(range.from); m <= monthOf(range.to); m = addMonths(m, 1)) months.push(m);
  if (months.length > MAX_COHORT_MONTHS) throw new AppError("INVALID_INPUT", `A cohort grid covers at most ${MAX_COHORT_MONTHS} first-order months; narrow from and to.`);

  const histories = await loadCustomerHistories(db, ctx.tenantId);
  const base: Omit<CohortFilter, "from" | "to"> = {
    ...(input.firstOrderCode ? { firstOrderCode: input.firstOrderCode } : {}),
    ...(input.excludeFirstOrderCode ? { excludeFirstOrderCode: input.excludeFirstOrderCode } : {}),
    ...(input.excludeTags ? { excludeTags: input.excludeTags } : {}),
  };

  const windowDays = input.windowDays ?? 30;
  const r = repeatRateOf(histories, { ...base, ...range }, windowDays, asOf);
  const summary: CohortSummary = {
    windowDays,
    ...(input.firstOrderCode ? { firstOrderCode: input.firstOrderCode } : {}),
    cohortCustomers: r.cohortCustomers,
    customers: r.customers,
    repeaters: r.repeaters,
    repeatRate: r.repeatRate,
    notYetObserved: r.cohortCustomers - r.customers,
  };

  const cells: CohortCell[] = [];
  if (input.grid !== false) {
    const columns = input.maxMonthsSince ?? 6;
    for (const cohort of months) {
      const from = monthStart(cohort) < range.from ? range.from : monthStart(cohort);
      const to = monthEnd(cohort) > range.to ? range.to : monthEnd(cohort);
      for (let k = 1; k <= columns; k++) {
        const cell = repeatRateOf(histories, { ...base, from, to }, 30 * k, asOf);
        cells.push({ cohort, monthsSince: k, windowDays: 30 * k, cohortCustomers: cell.cohortCustomers, customers: cell.customers, repeaters: cell.repeaters, repeatShare: cell.repeatRate });
      }
    }
  }

  const syncedAt = asOfOf(win);
  return {
    data: { summary, cells },
    queryId: queryIdFor("get_cohorts", ctx.tenantId, input, syncedAt),
    range,
    definitions: DEFINITIONS,
    asOf: syncedAt,
  };
}

type Run = (ctx: TenantContext, input: never, deps: { db?: Db }) => Promise<ToolResult<unknown>>;

// The shape of an entry of TOOL_DEFS in lib/agent/tools.ts.
export const getCohortsTool = {
  description:
    "Repeat rate and cohort grid. summary is the repeat rate (the share of a cohort that ordered again within windowDays: 30, 60 or 180) for customers whose FIRST order falls in the period (default the last 12 months), optionally only those whose first order used firstOrderCode, or not excludeFirstOrderCode, or without excludeTags on the first order (for example wholesale). Only customers whose first order is at least windowDays old are counted; notYetObserved says how many were left out. cells is the cohort grid: first-order month against months since (30-day months, 1 to maxMonthsSince, default 6), each cell with the customers counted and repeatShare, cumulative so it grows along a row. Quote repeatRate and repeatShare as written; never work out a rate yourself. Draw the grid with render_view component cohort.",
  schema: getCohortsInputSchema as z.ZodType,
  run: getCohorts as unknown as Run,
};
