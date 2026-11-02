import { z } from "zod";
import type { Db } from "../db/client";
import { loadEbitdaMonths, type LoadedEbitda } from "../ebitda/actuals";
import type { CostAssumptions, EbitdaData, EbitdaMonth, EbitdaSourceKey } from "../ebitda/types";
import { addMonths, monthOf, monthStart } from "../metrics/dates";
import type { TenantContext } from "../tenancy/context";
import { dbFor, loadWindow, parseInput, periodShape, queryIdFor, resolveRange, todayFor } from "./common";
import { requireConnectedShop, type ToolResult } from "./result";

// strictObject: an unknown key (a tenant, a shop, anything the model invents) is an error, not ignored.
export const getEbitdaInputSchema = z.strictObject({
  ...periodShape, // the months to cover; the default is the last 6 months. A month the range stops inside is a partial month.
});
export type GetEbitdaInput = z.input<typeof getEbitdaInputSchema>;

const DEFINITIONS = {
  ebitda:
    "Net sales minus cost of goods, card fees, fulfilment, ad spend and operating costs, per month. Net sales and orders are the synced Shopify orders. Cost of goods is TODAY'S unit cost times units kept (refunded units left out), because Shopify doesn't keep the cost at the time of sale. Ad spend is the ad spend file loaded for the brand, which does not come from Shopify. Operating costs come from the brand's cost sheet. Tax, interest, depreciation and amortisation are not part of EBITDA. The total is the sum of the months.",
  profitAfterVariableCosts:
    "Net sales minus cost of goods, card fees, fulfilment and ad spend: what is left before operating costs. It is not the contribution margin of get_unit_economics, which leaves card fees and fulfilment out.",
  cardFees:
    "An assumed rate, not Shopify data: cardFeeRate of net sales plus cardFeeFixedCents per order. assumptionsSource says whether these are the brand's own rates or the defaults used because none were entered.",
  fulfilment: "An assumed rate, not Shopify data: fulfilmentCentsPerOrder times the month's orders.",
  operatingCosts:
    "From the brand's cost sheet, one amount per month and category (payroll, software, rent, contractors, other); operatingCosts lists the categories. They are planning figures, seeded or typed in by a person, not accounting records. A month with nothing entered has operatingCostsEntered false and an empty list: that is 'not entered', not 'free'.",
  partialMonth:
    "When the range stops before a month's last day, that month has partial true and its operating costs are prorated by the days that have passed, so half a month of sales is not set against a full month of costs. Sales, cost of goods and ad spend are for the days in the range.",
  ceiling:
    "ebitdaIsCeiling is true for a month when no operating costs were entered for it, or when some units sold have no unit cost (unitsWithoutCost above 0, which have no cost of goods here). Costs are missing, so the true EBITDA is no higher than shown. The total is a ceiling when any month is.",
};

const OPERATING_COSTS_SOURCE = {
  fixture: "Cost sheet (seeded demo data)",
  manual: "Cost sheet (edited by a person)",
  mixed: "Cost sheet (some rows edited by a person)",
  none: "Cost sheet: nothing entered",
};

// Cents as dollars with two decimals. A per-order amount is written this way and never as "30¢" or "30 cents": the result holds it only
// as money, so the number checker would read the 30 as a count of 30 that no result has, and flag an answer that repeats the receipt.
const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

// Where each line of the bridge comes from, in words a person can read; the /ebitda page lays them out as its receipts.
function sourcesOf(a: CostAssumptions, operatingCosts: LoadedEbitda["operatingCostsSource"]): Record<EbitdaSourceKey, string> {
  return {
    netSales: "Shopify orders (synced)",
    costOfGoods: "Unit costs in Shopify × units sold",
    adSpend: "Ad spend file (not from Shopify)",
    cardFees: `Assumed rate: ${a.cardFeeBps / 100}% + ${dollars(a.cardFeeFixedCents)} per order`,
    fulfilment: `Assumed: ${dollars(a.fulfilmentCentsPerOrder)} per order`,
    operatingCosts: OPERATING_COSTS_SOURCE[operatingCosts],
  };
}

// The sum of the months, line by line, so the total adds up from the months shown and its own bridge adds up too.
function totalOf(months: EbitdaMonth[]): EbitdaData["total"] {
  const sum = (f: (m: EbitdaMonth) => number) => months.reduce((s, m) => s + f(m), 0);
  const netSalesCents = sum((m) => m.netSalesCents);
  const profitAfterVariableCostsCents = sum((m) => m.profitAfterVariableCostsCents);
  const ebitdaCents = sum((m) => m.ebitdaCents);
  return {
    netSalesCents,
    costOfGoodsCents: sum((m) => m.costOfGoodsCents),
    cardFeesCents: sum((m) => m.cardFeesCents),
    fulfilmentCents: sum((m) => m.fulfilmentCents),
    adSpendCents: sum((m) => m.adSpendCents),
    profitAfterVariableCostsCents,
    operatingCostsCents: sum((m) => m.operatingCostsCents),
    ebitdaCents,
    ebitdaRate: netSalesCents > 0 ? ebitdaCents / netSalesCents : null,
    profitAfterVariableCostsRate: netSalesCents > 0 ? profitAfterVariableCostsCents / netSalesCents : null,
    orders: sum((m) => m.orders),
    unitsWithoutCost: sum((m) => m.unitsWithoutCost),
    ebitdaIsCeiling: months.some((m) => m.ebitdaIsCeiling),
  };
}

// EBITDA by month from the synced orders, the unit costs, the loaded ad spend and the brand's cost sheet. The tenant is the
// session's; every figure is computed here, not by the model.
export async function getEbitda(ctx: TenantContext, rawInput: GetEbitdaInput, deps: { db?: Db } = {}): Promise<ToolResult<EbitdaData>> {
  const shop = requireConnectedShop(ctx);
  const input = parseInput(getEbitdaInputSchema, rawInput);
  const db = await dbFor(deps);
  const win = await loadWindow(db, ctx.tenantId);
  const today = todayFor(shop.timezone, win);
  const hasRange = input.period !== undefined || input.from !== undefined || input.to !== undefined;
  const asked = hasRange ? resolveRange(input, today) : { from: monthStart(addMonths(monthOf(today), -5)), to: today };

  const loaded = await loadEbitdaMonths(ctx, asked, { db });
  const { assumptions } = loaded;
  return {
    data: {
      months: loaded.months,
      total: totalOf(loaded.months),
      cardFeeRate: assumptions.cardFeeBps / 10_000,
      cardFeeFixedCents: assumptions.cardFeeFixedCents,
      fulfilmentCentsPerOrder: assumptions.fulfilmentCentsPerOrder,
      assumptionsSource: loaded.assumptionsSource,
      sources: sourcesOf(assumptions, loaded.operatingCostsSource),
    },
    queryId: queryIdFor("get_ebitda", ctx.tenantId, input, loaded.asOf),
    range: loaded.range,
    definitions: DEFINITIONS,
    asOf: loaded.asOf,
  };
}

type Run = (ctx: TenantContext, input: never, deps: { db?: Db }) => Promise<ToolResult<unknown>>;

// The shape of an entry of TOOL_DEFS in lib/agent/tools.ts.
export const getEbitdaTool = {
  description:
    "EBITDA by month. months is, per month, net sales, cost of goods (TODAY'S unit cost times units kept), card fees and fulfilment (assumed rates: see cardFeeRate, cardFeeFixedCents and fulfilmentCentsPerOrder, and assumptionsSource), ad spend, profitAfterVariableCostsCents (net sales less those four, before operating costs), operatingCostsCents (from the brand's cost sheet, listed by category in operatingCosts) and ebitdaCents, with ebitdaRate and profitAfterVariableCostsRate as fractions of net sales. total is the sum of the months. ebitdaIsCeiling is true for a month with no operating costs entered (operatingCostsEntered false) or with units that have no unit cost (unitsWithoutCost above 0): say EBITDA is a ceiling then. A month with partial true has its operating costs prorated by days. sources says where each line comes from. Default the last 6 months. Quote the figures as written; never work out an EBITDA, a margin or a cost yourself.",
  schema: getEbitdaInputSchema as z.ZodType,
  run: getEbitda as unknown as Run,
};
