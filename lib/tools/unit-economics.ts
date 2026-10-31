import { z } from "zod";
import type { Db } from "../db/client";
import { adSpendByMonth, loadCustomerHistories, loadLineMargins } from "../metrics/cohorts";
import { AppError } from "../errors";
import { addMonths, monthOf, monthStart } from "../metrics/dates";
import { queryMetric } from "../metrics/query";
import type { TenantContext } from "../tenancy/context";
import { assertInWindow, asOfOf, dbFor, loadWindow, parseInput, periodShape, queryIdFor, resolveRange, todayFor } from "./common";
import { requireConnectedShop, type ToolResult } from "./result";

const MAX_MONTHS = 24;
const CURVE_MONTHS = 12;

// strictObject: an unknown key (a tenant, a shop, anything the model invents) is an error, not ignored.
export const getUnitEconomicsInputSchema = z.strictObject({
  ...periodShape, // the months to cover; the default is the last 6 months. Each month is also a cohort for the payback.
  payback: z.boolean().optional(), // include the cohort payback (default true)
});
export type GetUnitEconomicsInput = z.input<typeof getUnitEconomicsInputSchema>;

export interface ContributionMonth {
  month: string;
  netSalesCents: number;
  costOfGoodsCents: number;
  adSpendCents: number;
  contributionMarginCents: number; // net sales - cost of goods - ad spend
  contributionMarginRate: number | null; // as a fraction of net sales; null when there were no net sales
  unitsWithoutCost: number; // units sold on variants with no unit cost, which have no cost of goods here
}

export interface PaybackCohort {
  cohort: string; // the month of the first order
  newCustomers: number;
  cacCents: number; // new_customer_cac for the month
  acquisitionCostCents: number; // cacCents x newCustomers
  curve: { monthsSince: number; cumulativeGrossMarginCents: number }[]; // the cohort's gross margin to date, by months since the cohort month (0 is the month itself)
  paybackMonths: number | null; // the first monthsSince where the cumulative gross margin covers the acquisition cost; null if not yet
  monthsObserved: number; // how many months after the cohort month the data covers
}

export interface UnitEconomicsData {
  months: ContributionMonth[];
  total: Omit<ContributionMonth, "month">;
  payback: PaybackCohort[];
}

const DEFINITIONS = {
  contributionMargin:
    "Net sales minus cost of goods minus ad spend, per month. Net sales and ad spend are the net_sales metric and the ad spend loaded for the brand. Cost of goods is TODAY'S unit cost times units kept (refunded units left out), because Shopify doesn't keep the cost at the time of sale. Variants with no unit cost have no cost of goods here: unitsWithoutCost counts their units, and the margin is higher than it would be by their cost.",
  payback:
    "For each first-order month (a cohort): the months until the cohort's cumulative gross margin (what its orders earned after discounts, refunds and today's unit cost) covers what acquiring it cost in ads, which is new_customer_cac times the new customers. monthsSince 0 is the cohort's own month, so a payback of 0 means it paid back in that month. null means not yet paid back in the months observed. Each cohort month's ad spend is for that whole month, and the cohort's gross margin uses today's unit cost.",
};

// Contribution margin by month and the payback of each month's new customers, from the synced orders, the unit costs on the
// variants and the loaded ad spend. The tenant is the session's; every figure is computed here, not by the model.
export async function getUnitEconomics(ctx: TenantContext, rawInput: GetUnitEconomicsInput, deps: { db?: Db } = {}): Promise<ToolResult<UnitEconomicsData>> {
  const shop = requireConnectedShop(ctx);
  const input = parseInput(getUnitEconomicsInputSchema, rawInput);
  const db = await dbFor(deps);
  const win = await loadWindow(db, ctx.tenantId);
  const today = todayFor(shop.timezone, win);
  const hasRange = input.period !== undefined || input.from !== undefined || input.to !== undefined;
  const asked = hasRange ? resolveRange(input, today) : { from: monthStart(addMonths(monthOf(today), -5)), to: today };
  assertInWindow(asked, win);
  const range = { from: asked.from, to: asked.to > win.last! ? win.last! : asked.to };

  const firstMonth = monthOf(range.from);
  const lastMonth = monthOf(range.to);
  const months: string[] = [];
  for (let m = firstMonth; m <= lastMonth; m = addMonths(m, 1)) months.push(m);
  if (months.length > MAX_MONTHS) throw new AppError("INVALID_INPUT", `Unit economics covers at most ${MAX_MONTHS} months; narrow from and to.`);

  // Whole months, so every month's ad spend and cost are complete (the last month is to the end of the data).
  const span = { from: monthStart(firstMonth), to: range.to };
  const metric = await queryMetric(ctx, { metrics: ["net_sales", "new_customer_cac", "new_customer_orders"], ...span, groupBy: ["month"], limit: 200 }, { db });
  const byMonth = new Map(metric.data.map((r) => [r.group.month!, r.values]));

  const lines = await loadLineMargins(db, ctx.tenantId, { from: span.from, to: win.last! });
  const spend = await adSpendByMonth(db, ctx.tenantId, span);

  const cogs = new Map<string, { cost: number; uncosted: number }>();
  for (const l of lines) {
    const e = cogs.get(l.month) ?? { cost: 0, uncosted: 0 };
    if (l.costed) e.cost += l.cost;
    else e.uncosted += l.qty;
    cogs.set(l.month, e);
  }

  const rows: ContributionMonth[] = months.map((month) => {
    const netSalesCents = Math.round(byMonth.get(month)?.net_sales ?? 0);
    const costOfGoodsCents = cogs.get(month)?.cost ?? 0;
    const adSpendCents = spend.get(month) ?? 0;
    const contributionMarginCents = netSalesCents - costOfGoodsCents - adSpendCents;
    return {
      month,
      netSalesCents,
      costOfGoodsCents,
      adSpendCents,
      contributionMarginCents,
      contributionMarginRate: netSalesCents === 0 ? null : contributionMarginCents / netSalesCents,
      unitsWithoutCost: cogs.get(month)?.uncosted ?? 0,
    };
  });
  const sum = (f: (r: ContributionMonth) => number) => rows.reduce((s, r) => s + f(r), 0);
  const total = {
    netSalesCents: sum((r) => r.netSalesCents),
    costOfGoodsCents: sum((r) => r.costOfGoodsCents),
    adSpendCents: sum((r) => r.adSpendCents),
    contributionMarginCents: sum((r) => r.contributionMarginCents),
    contributionMarginRate: sum((r) => r.netSalesCents) === 0 ? null : sum((r) => r.contributionMarginCents) / sum((r) => r.netSalesCents),
    unitsWithoutCost: sum((r) => r.unitsWithoutCost),
  };

  const payback: PaybackCohort[] = [];
  if (input.payback !== false) {
    // Each customer belongs to the month of their first order; the cohort's gross margin builds up by month.
    const cohortOf = new Map<string, string>();
    const sizes = new Map<string, number>();
    for (const h of await loadCustomerHistories(db, ctx.tenantId)) {
      const cohort = monthOf(h.firstDate);
      if (cohort < firstMonth || cohort > lastMonth) continue;
      cohortOf.set(h.customerId, cohort);
      sizes.set(cohort, (sizes.get(cohort) ?? 0) + 1);
    }
    const monthIndex = (m: string) => Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7));
    const margin = new Map<string, Map<number, number>>(); // cohort -> monthsSince -> gross margin that month
    for (const l of lines) {
      const cohort = l.customerId ? cohortOf.get(l.customerId) : undefined;
      if (!cohort || !l.costed) continue;
      const since = monthIndex(l.month) - monthIndex(cohort);
      const per = margin.get(cohort) ?? new Map<number, number>();
      per.set(since, (per.get(since) ?? 0) + l.net - l.cost);
      margin.set(cohort, per);
    }
    for (const cohort of months) {
      const newCustomers = sizes.get(cohort) ?? 0;
      if (newCustomers === 0) continue;
      const cacCents = Math.round(byMonth.get(cohort)?.new_customer_cac ?? 0);
      const acquisitionCostCents = Math.round((byMonth.get(cohort)?.new_customer_cac ?? 0) * newCustomers);
      const monthsObserved = Math.min(CURVE_MONTHS, monthIndex(monthOf(win.last!)) - monthIndex(cohort));
      let running = 0;
      let paidAt: number | null = null;
      const curve: PaybackCohort["curve"] = [];
      for (let since = 0; since <= monthsObserved; since++) {
        running += margin.get(cohort)?.get(since) ?? 0;
        curve.push({ monthsSince: since, cumulativeGrossMarginCents: running });
        if (paidAt === null && acquisitionCostCents > 0 && running >= acquisitionCostCents) paidAt = since;
      }
      payback.push({ cohort, newCustomers, cacCents, acquisitionCostCents, curve, paybackMonths: paidAt, monthsObserved });
    }
  }

  const syncedAt = asOfOf(win);
  return {
    data: { months: rows, total, payback },
    queryId: queryIdFor("get_unit_economics", ctx.tenantId, input, syncedAt),
    range: { from: span.from, to: range.to },
    definitions: DEFINITIONS,
    asOf: syncedAt,
  };
}

type Run = (ctx: TenantContext, input: never, deps: { db?: Db }) => Promise<ToolResult<unknown>>;

// The shape of an entry of TOOL_DEFS in lib/agent/tools.ts.
export const getUnitEconomicsTool = {
  description:
    "Contribution margin and payback. months is, per month, net sales, cost of goods (TODAY'S unit cost times units kept), ad spend and contributionMarginCents = net sales - cost of goods - ad spend, with contributionMarginRate and unitsWithoutCost (variants with no unit cost have no cost of goods, so say the margin is a ceiling when that is above 0). payback is, per first-order month, the new customers, new-customer CAC (cacCents), the cohort's gross margin to date by months since, and paybackMonths: the months until its gross margin covers the CAC (0 means within its own month; null means not yet within monthsObserved). Default the last 6 months. Quote the figures as written; never work out a margin or a payback yourself.",
  schema: getUnitEconomicsInputSchema as z.ZodType,
  run: getUnitEconomics as unknown as Run,
};
