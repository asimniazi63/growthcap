import { z } from "zod";
import type { Db } from "../db/client";
import { loadEbitdaMonths, scenarioBaseOf } from "../ebitda/actuals";
import { AppError } from "../errors";
import { addMonths, monthEnd, monthOf, monthStart } from "../metrics/dates";
import { DEFAULT_PRICE_ELASTICITY, runScenario, volumeChangeForTarget, type Levers, type ScenarioResult } from "../metrics/ebitda";
import type { TenantContext } from "../tenancy/context";
import { dbFor, loadWindow, parseInput, queryIdFor, todayFor } from "./common";
import { requireConnectedShop, type ToolResult } from "./result";

const DEFAULT_BASELINE_MONTHS = 3;

// strictObject: an unknown key (a tenant, a shop, anything the model invents) is an error, not ignored. Every lever is a fraction of
// today's figure, and the bounds keep it to a change a person could plan. They also catch a percentage passed as a whole number
// (-20 for a 20% cut), which would otherwise be read as a change of minus two thousand percent.
export const getEbitdaScenarioInputSchema = z.strictObject({
  months: z.number().int().min(1).max(12).optional(), // the last N complete months the scenario starts from; the default is 3
  priceChange: z.number().min(-0.5).max(1).optional(),
  adSpendChange: z.number().min(-1).max(2).optional(),
  unitCostChange: z.number().min(-0.5).max(1).optional(),
  volumeChange: z.number().min(-1).max(3).optional(),
  operatingCostChange: z.number().min(-1).max(2).optional(),
  elasticity: z.number().min(-5).max(0).optional(),
  targetEbitdaPerMonthCents: z.number().int().optional(), // dollars x 100
});
export type GetEbitdaScenarioInput = z.input<typeof getEbitdaScenarioInputSchema>;

type LeverKey = Exclude<keyof Levers, "elasticity">;
const LEVER_KEYS: readonly LeverKey[] = ["priceChange", "adSpendChange", "unitCostChange", "volumeChange", "operatingCostChange"];

export interface EbitdaScenarioData {
  baselineMonths: string[]; // YYYY-MM, oldest first: the complete months the baseline adds up
  baselineMonthCount: number; // how many of them, as a figure an answer can quote
  baseline: ScenarioResult["baseline"]; // all those months together
  scenario: ScenarioResult["scenario"]; // the baseline with the levers applied
  deltaEbitdaCents: number; // scenario less baseline, over all the months
  baselineEbitdaPerMonthCents: number; // the two EBITDAs as a month's worth
  scenarioEbitdaPerMonthCents: number;
  deltaEbitdaPerMonthCents: number; // and the change between those two, so that an answer given by the month never has to subtract
  priceChange?: number; // the levers that were given, as the fractions they were given in
  adSpendChange?: number;
  unitCostChange?: number;
  volumeChange?: number;
  operatingCostChange?: number;
  elasticity: number;
  elasticityIsDefault: boolean;
  baselineIsCeiling: boolean; // a baseline month had no operating costs entered, or units with no unit cost: the scenario is a ceiling too
  impacts: ScenarioResult["impacts"];
  // The change in volume, on top of the other levers, that reaches targetEbitdaPerMonthCents. All of it is per month, to match the
  // target that was asked for; null when no target was given or when no change in volume can reach it.
  target: { targetEbitdaPerMonthCents: number; volumeChange: number; ordersNeededPerMonth: number; baselineOrdersPerMonth: number } | null;
}

// No digits in these on purpose: a figure in a definition is not a tool result, so an answer that quoted it would fail the number check.
const DEFINITIONS = {
  baseline:
    "The last complete months added together (baselineMonths, baselineMonthCount of them), as the same bridge get_ebitda gives: net sales, cost of goods at today's unit cost, card fees and fulfilment at the brand's assumed rates, ad spend, and the cost sheet's operating costs. Only complete months count. A month still going is left out, so the baseline never sets half a month of sales against a full month of costs. baselineEbitdaPerMonthCents and scenarioEbitdaPerMonthCents are the totals over those months divided by how many there are, and deltaEbitdaPerMonthCents is the change between them.",
  levers:
    "Each lever is a fraction of today's figure, so a cut is negative and a rise is positive. A lever left out leaves that figure alone, and the levers echoed in data are the ones that were given. priceChange is the selling price, unitCostChange what each unit costs, adSpendChange ad spend, operatingCostChange operating costs, and volumeChange orders for any other reason (demand, a launch, the season). Net sales, cost of goods, card fees and fulfilment follow the number of orders; ad spend and operating costs do not.",
  adSpendRule:
    "An assumption, not data: cutting ad spend loses new-customer orders in proportion, at today's cost per new customer, and leaves returning-customer orders alone. More ad spend adds new-customer orders the same way. Without this rule, cutting ads would always look free.",
  elasticity:
    "An assumption, not data: the percentage change in orders for each one percent change in price. It is negative, because a higher price loses orders. elasticityIsDefault is true when none was given and the default was used.",
  impacts: "Each lever that was given, applied on its own to the baseline. Levers interact, so the impacts need not add up to deltaEbitdaCents.",
  ceiling:
    "baselineIsCeiling is true when a baseline month had no operating costs entered, or had units sold that have no unit cost (so no cost of goods here). Costs are missing from the baseline, so the true EBITDA is no higher than shown, and the scenario EBITDA is a ceiling too.",
  target:
    "Only when targetEbitdaPerMonthCents is given. volumeChange is the change in orders, on top of the other levers, that brings EBITDA to the target; ordersNeededPerMonth is the orders a month that takes, against baselineOrdersPerMonth. All of it is per month. target is null when no target was given, and also when no change in orders can reach one: each order loses money, or the target is lower than what no orders at all would earn. A volumeChange that was also given does not move the target, because the target is what that lever would have to be.",
};

// The latest month whose last day both the clock and the data have reached. It is the rule that makes get_ebitda flag a month partial
// (its range stops at today or at the last day of data, whichever is first), so these are the months the /ebitda page's what-if
// starts from too. A month either one stops inside is still in progress as far as this store is concerned.
function lastCompleteMonth(today: string, lastDataDay: string): string {
  const through = today < lastDataDay ? today : lastDataDay;
  return through === monthEnd(monthOf(through)) ? monthOf(through) : addMonths(monthOf(through), -1);
}

// A total over the baseline months as a month's worth, in whole cents or orders. This is Math.round(total / months), the rounding the
// scenario panel on the /ebitda page uses for the same figures, so chat and page agree to the cent; the + 0 only turns -0 into 0.
const perMonth = (total: number, months: number): number => Math.round(total / months) + 0;

// What changing a few levers does to EBITDA, over the last few complete months. The arithmetic is the engine's, the one the scenario
// panel on the /ebitda page runs in the browser, so chat and page agree. The tenant is the session's; every figure is computed
// here, not by the model.
export async function getEbitdaScenario(ctx: TenantContext, rawInput: GetEbitdaScenarioInput, deps: { db?: Db } = {}): Promise<ToolResult<EbitdaScenarioData>> {
  const shop = requireConnectedShop(ctx);
  const input = parseInput(getEbitdaScenarioInputSchema, rawInput);
  const db = await dbFor(deps);
  const win = await loadWindow(db, ctx.tenantId);
  if (!win.first || !win.last) throw new AppError("NO_DATA", "This store has no synced orders yet.");

  const last = lastCompleteMonth(todayFor(shop.timezone, win), win.last);
  if (last < monthOf(win.first)) {
    throw new AppError("NO_DATA", `This store has no complete month of orders yet (they start on ${win.first}), so there is nothing to base a scenario on.`);
  }
  // A store with fewer complete months than asked for gets the ones it has: baselineMonths says which.
  const first = addMonths(last, 1 - (input.months ?? DEFAULT_BASELINE_MONTHS));
  const loaded = await loadEbitdaMonths(ctx, { from: monthStart(first), to: monthEnd(last) }, { db });
  const months = loaded.months.length;

  const base = scenarioBaseOf(loaded.months);
  const levers: Levers = {
    priceChange: input.priceChange,
    adSpendChange: input.adSpendChange,
    unitCostChange: input.unitCostChange,
    volumeChange: input.volumeChange,
    operatingCostChange: input.operatingCostChange,
    elasticity: input.elasticity,
  };
  const result = runScenario(base, loaded.assumptions, levers);
  const baselinePerMonth = perMonth(result.baseline.ebitdaCents, months);
  const scenarioPerMonth = perMonth(result.scenario.ebitdaCents, months);

  const given: Partial<Record<LeverKey, number>> = {};
  for (const key of LEVER_KEYS) {
    const value = input[key];
    if (value !== undefined) given[key] = value;
  }

  // The solver takes a target for the whole baseline, because its base is the months added together; the person gave one month's.
  let target: EbitdaScenarioData["target"] = null;
  if (input.targetEbitdaPerMonthCents !== undefined) {
    const solved = volumeChangeForTarget(base, loaded.assumptions, levers, input.targetEbitdaPerMonthCents * months);
    if (solved) {
      target = {
        targetEbitdaPerMonthCents: input.targetEbitdaPerMonthCents,
        volumeChange: solved.volumeChange,
        ordersNeededPerMonth: perMonth(solved.ordersNeeded, months),
        baselineOrdersPerMonth: perMonth(base.orders, months),
      };
    }
  }

  return {
    data: {
      baselineMonths: loaded.months.map((m) => m.month),
      baselineMonthCount: months,
      baseline: result.baseline,
      scenario: result.scenario,
      deltaEbitdaCents: result.deltaEbitdaCents,
      baselineEbitdaPerMonthCents: baselinePerMonth,
      scenarioEbitdaPerMonthCents: scenarioPerMonth,
      deltaEbitdaPerMonthCents: scenarioPerMonth - baselinePerMonth,
      ...given,
      elasticity: input.elasticity ?? DEFAULT_PRICE_ELASTICITY,
      elasticityIsDefault: input.elasticity === undefined,
      baselineIsCeiling: loaded.months.some((m) => m.ebitdaIsCeiling),
      impacts: result.impacts,
      target,
    },
    queryId: queryIdFor("get_ebitda_scenario", ctx.tenantId, input, loaded.asOf),
    range: loaded.range,
    definitions: DEFINITIONS,
    asOf: loaded.asOf,
  };
}

type Run = (ctx: TenantContext, input: never, deps: { db?: Db }) => Promise<ToolResult<unknown>>;

// The shape of an entry of TOOL_DEFS in lib/agent/tools.ts.
export const getEbitdaScenarioTool = {
  description:
    "What-if for EBITDA: the last complete months (months, default 3; baselineMonths lists them) with changes applied, baseline and scenario side by side. Each has net sales, cost of goods, card fees, fulfilment, ad spend, profitAfterVariableCostsCents, operatingCostsCents, ebitdaCents, ebitdaRate and orders, for all the months together; baselineEbitdaPerMonthCents, scenarioEbitdaPerMonthCents and deltaEbitdaPerMonthCents give EBITDA and its change a month, and deltaEbitdaCents the change over all the months. Pass changes as fractions of today's figure: priceChange (the selling price), adSpendChange, unitCostChange, volumeChange (orders for any other reason) and operatingCostChange; a 20% cut is -0.2. Leave a lever out to leave that figure alone. impacts shows each lever on its own. elasticity (how orders respond to price) defaults to -1.5, and elasticityIsDefault says whether it did. Give targetEbitdaPerMonthCents (in cents: $2,500 is 250000) to learn the change in volume that reaches that EBITDA a month; see target. Fewer ads lose new-customer orders at today's cost per new customer, and the price elasticity is a guess: both are assumptions, not data, so say so. If baselineIsCeiling is true (operating costs not entered, or units with no unit cost), the baseline EBITDA is a ceiling, and so is the scenario's: say so. Quote the figures as written; never work out a scenario, a difference or a rate yourself.",
  schema: getEbitdaScenarioInputSchema as z.ZodType,
  run: getEbitdaScenario as unknown as Run,
};
