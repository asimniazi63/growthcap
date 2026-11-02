import type { Db } from "../db/client";
import { AppError } from "../errors";
import { adSpendByMonth, loadLineMargins } from "../metrics/cohorts";
import { addMonths, daysBetween, monthEnd, monthOf, monthStart } from "../metrics/dates";
import { ebitdaLines, prorate, type ScenarioBase } from "../metrics/ebitda";
import { queryMetric } from "../metrics/query";
import type { TenantContext } from "../tenancy/context";
import { assertInWindow, asOfOf, dbFor, loadWindow } from "../tools/common";
import { requireConnectedShop } from "../tools/result";
import { loadAssumptions, loadCostSheet } from "./store";
import type { CostAssumptions, CostSheetRow, CostSource, EbitdaMonth } from "./types";

export type { EbitdaMonth } from "./types";

const MAX_MONTHS = 24;

type OperatingCost = EbitdaMonth["operatingCosts"][number];

export interface LoadedEbitda {
  months: EbitdaMonth[];
  assumptions: CostAssumptions;
  assumptionsSource: CostSource | "default";
  operatingCostsSource: CostSource | "mixed" | "none"; // "mixed" when a person edited some of the cells and not others
  range: { from: string; to: string }; // whole months from the first one's first day to the last day with data
  asOf: string;
}

// A partial month has had only part of its days, so it carries only that part of each cost. Each category is prorated by days;
// the cents lost to rounding go to the categories with the largest remainders, so the categories add up to the prorated total
// (which is what operatingCostsCents is) exactly.
function proratedCosts(costs: OperatingCost[], elapsedDays: number, daysInMonth: number): OperatingCost[] {
  const parts = costs.map((c) => ({
    category: c.category,
    amountCents: Math.floor((c.amountCents * elapsedDays) / daysInMonth),
    remainder: (c.amountCents * elapsedDays) % daysInMonth,
  }));
  const total = prorate(costs.reduce((s, c) => s + c.amountCents, 0), elapsedDays, daysInMonth);
  let leftover = total - parts.reduce((s, p) => s + p.amountCents, 0);
  for (const p of [...parts].sort((x, y) => y.remainder - x.remainder)) {
    if (leftover <= 0) break;
    p.amountCents += 1;
    leftover -= 1;
  }
  return parts.map(({ category, amountCents }) => ({ category, amountCents }));
}

// The months of the range with their bridge from net sales to EBITDA. Net sales, orders and new-customer orders are the synced
// Shopify metrics; cost of goods is today's unit cost times units kept (as in unit economics); ad spend is the loaded file; card
// fees and fulfilment are worked out from the brand's assumed rates; operating costs are the brand's cost sheet. The tenant is
// the session's: nothing in `range` can name another.
export async function loadEbitdaMonths(ctx: TenantContext, range: { from: string; to: string }, deps: { db?: Db } = {}): Promise<LoadedEbitda> {
  requireConnectedShop(ctx);
  if (range.from > range.to) throw new AppError("INVALID_INPUT", `from (${range.from}) is after to (${range.to}).`);
  const db = await dbFor(deps);
  const win = await loadWindow(db, ctx.tenantId);
  assertInWindow(range, win);
  const to = range.to > win.last! ? win.last! : range.to;

  // Months before the first synced order are not months of this store, so they are not rows.
  const firstMonth = monthOf(range.from) < monthOf(win.first!) ? monthOf(win.first!) : monthOf(range.from);
  const lastMonth = monthOf(to);
  const monthList: string[] = [];
  for (let m = firstMonth; m <= lastMonth; m = addMonths(m, 1)) monthList.push(m);
  if (monthList.length > MAX_MONTHS) throw new AppError("INVALID_INPUT", `EBITDA covers at most ${MAX_MONTHS} months; narrow from and to.`);

  // Whole months from their first day, so a month's sales, cost of goods and ad spend all stop on the same day.
  const span = { from: monthStart(firstMonth), to };
  const metric = await queryMetric(ctx, { metrics: ["net_sales", "orders", "new_customer_orders"], ...span, groupBy: ["month"], limit: 200 }, { db });
  const byMonth = new Map(metric.data.map((r) => [r.group.month!, r.values]));

  const cogs = new Map<string, { cost: number; uncosted: number }>();
  for (const l of await loadLineMargins(db, ctx.tenantId, span)) {
    const e = cogs.get(l.month) ?? { cost: 0, uncosted: 0 };
    if (l.costed) e.cost += l.cost;
    else e.uncosted += l.qty;
    cogs.set(l.month, e);
  }
  const spend = await adSpendByMonth(db, ctx.tenantId, span);

  const sheet = await loadCostSheet(db, ctx.tenantId, { from: firstMonth, to: lastMonth });
  const sheetByMonth = new Map<string, CostSheetRow[]>();
  for (const r of sheet) sheetByMonth.set(r.month, [...(sheetByMonth.get(r.month) ?? []), r]);
  const { assumptions, source: assumptionsSource } = await loadAssumptions(db, ctx.tenantId);

  const months = monthList.map((month): EbitdaMonth => {
    const sold = byMonth.get(month);
    const entered = (sheetByMonth.get(month) ?? []).map((r): OperatingCost => ({ category: r.category, amountCents: r.amountCents }));
    const partial = to < monthEnd(month);
    const operatingCosts = partial ? proratedCosts(entered, daysBetween(monthStart(month), to) + 1, daysBetween(monthStart(month), monthEnd(month)) + 1) : entered;
    const orders = sold?.orders ?? 0;
    const unitsWithoutCost = cogs.get(month)?.uncosted ?? 0;
    const bridge = ebitdaLines(
      {
        netSalesCents: Math.round(sold?.net_sales ?? 0),
        orders,
        costOfGoodsCents: cogs.get(month)?.cost ?? 0,
        adSpendCents: spend.get(month) ?? 0,
        operatingCostsCents: operatingCosts.reduce((s, c) => s + c.amountCents, 0),
      },
      assumptions,
    );
    return {
      month,
      partial,
      ...bridge,
      orders,
      newCustomerOrders: sold?.new_customer_orders ?? 0,
      operatingCosts,
      operatingCostsEntered: entered.length > 0,
      unitsWithoutCost,
      ebitdaIsCeiling: entered.length === 0 || unitsWithoutCost > 0,
    };
  });

  const sources = new Set(sheet.map((r) => r.source));
  const operatingCostsSource = sources.size === 0 ? "none" : sources.size === 1 ? [...sources][0]! : "mixed";
  return { months, assumptions, assumptionsSource, operatingCostsSource, range: span, asOf: asOfOf(win) };
}

// The sums of the months, as the base a scenario starts from. Scenarios use complete months only, so the caller leaves a partial month out.
export function scenarioBaseOf(months: EbitdaMonth[]): ScenarioBase {
  const sum = (f: (m: EbitdaMonth) => number) => months.reduce((s, m) => s + f(m), 0);
  return {
    netSalesCents: sum((m) => m.netSalesCents),
    orders: sum((m) => m.orders),
    newCustomerOrders: sum((m) => m.newCustomerOrders),
    costOfGoodsCents: sum((m) => m.costOfGoodsCents),
    adSpendCents: sum((m) => m.adSpendCents),
    operatingCostsCents: sum((m) => m.operatingCostsCents),
  };
}
