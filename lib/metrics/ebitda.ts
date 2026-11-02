import type { CostAssumptions, EbitdaLines } from "../ebitda/types";

// The arithmetic behind the EBITDA page and the two EBITDA tools: the bridge from net sales to EBITDA, the what-if levers, and the
// order count that reaches a target. It imports nothing but types, because the scenario panel runs it in the browser and the agent's
// scenario tool runs the same code, so chat and page show the same figures. It reads no clock and no database.
//
// Money is whole cents. Each line of a bridge is rounded on its own and ebitdaCents is the sum of the rounded lines, so a bridge
// always adds up exactly. Rates are fractions of net sales.

export type { EbitdaLines } from "../ebitda/types";

// How orders respond to a price change: -1.5 means a 5% rise loses 7.5% of orders. It is an assumption, not data, and every place that
// shows a scenario says so. The forecasting work shares this default.
export const DEFAULT_PRICE_ELASTICITY = -1.5;

// The totals a scenario starts from, over one period of any length (a month, or the sum of the last three).
export interface ScenarioBase {
  netSalesCents: number;
  orders: number;
  newCustomerOrders: number;
  costOfGoodsCents: number;
  adSpendCents: number;
  operatingCostsCents: number;
}

// Each lever is a fraction of today's figure: 0.05 is +5% and -0.2 is -20%. Leave a lever out to leave that figure alone.
export interface Levers {
  priceChange?: number; // the selling price; orders respond to it through the elasticity
  adSpendChange?: number; // ad spend; new-customer orders move with it
  unitCostChange?: number; // what each unit costs to buy or make
  volumeChange?: number; // orders for any other reason: demand, a launch, the season
  operatingCostChange?: number;
  elasticity?: number; // an assumption about price, not a lever; DEFAULT_PRICE_ELASTICITY when left out
}

export interface ScenarioResult {
  baseline: EbitdaLines & { orders: number };
  scenario: EbitdaLines & { orders: number };
  deltaEbitdaCents: number;
  // Each lever that was set, applied alone to the baseline. Levers interact, so these need not add up to deltaEbitdaCents.
  impacts: { lever: Exclude<keyof Levers, "elasticity">; deltaEbitdaCents: number }[];
}

// The levers in the order the Levers type declares them, which is the order impacts come back in.
const LEVER_KEYS: readonly Exclude<keyof Levers, "elasticity">[] = ["priceChange", "adSpendChange", "unitCostChange", "volumeChange", "operatingCostChange"];

// What a bridge needs from a period. Orders can be a fraction here, because a scenario scales the count.
type Amounts = Pick<ScenarioBase, "netSalesCents" | "orders" | "costOfGoodsCents" | "adSpendCents" | "operatingCostsCents">;

// Rounds to a whole number, never to negative zero: a line that scales down to nothing would otherwise carry a -0 into the result.
const whole = (x: number): number => Math.round(x) + 0;

// A rate is a fraction of net sales, so it has no meaning without sales. A month of refunds can leave net sales below zero too, and
// a rate over a negative base would read the wrong way round.
const rateOf = (cents: number, netSalesCents: number): number | null => (netSalesCents > 0 ? cents / netSalesCents : null);

// The six lines of the bridge before rounding. Card fees and fulfilment are costed on the order count as given, which in a scenario is
// usually a fraction of an order: a half order is not rounded up before it is costed, only the count that is shown.
function bridgeOf(b: Amounts, a: CostAssumptions) {
  return {
    netSalesCents: b.netSalesCents,
    costOfGoodsCents: b.costOfGoodsCents,
    cardFeesCents: (a.cardFeeBps / 10_000) * b.netSalesCents + a.cardFeeFixedCents * b.orders,
    fulfilmentCents: a.fulfilmentCentsPerOrder * b.orders,
    adSpendCents: b.adSpendCents,
    operatingCostsCents: b.operatingCostsCents,
  };
}

export function ebitdaLines(base: Amounts, a: CostAssumptions): EbitdaLines {
  const raw = bridgeOf(base, a);
  const netSalesCents = whole(raw.netSalesCents);
  const costOfGoodsCents = whole(raw.costOfGoodsCents);
  const cardFeesCents = whole(raw.cardFeesCents);
  const fulfilmentCents = whole(raw.fulfilmentCents);
  const adSpendCents = whole(raw.adSpendCents);
  const operatingCostsCents = whole(raw.operatingCostsCents);
  const profitAfterVariableCostsCents = netSalesCents - costOfGoodsCents - cardFeesCents - fulfilmentCents - adSpendCents;
  const ebitdaCents = profitAfterVariableCostsCents - operatingCostsCents;
  return {
    netSalesCents,
    costOfGoodsCents,
    cardFeesCents,
    fulfilmentCents,
    adSpendCents,
    profitAfterVariableCostsCents,
    operatingCostsCents,
    ebitdaCents,
    ebitdaRate: rateOf(ebitdaCents, netSalesCents),
    profitAfterVariableCostsRate: rateOf(profitAfterVariableCostsCents, netSalesCents),
  };
}

// A change as a multiplier on an amount. A fall of 100% or more leaves nothing; it never makes the amount negative.
const grow = (change = 0): number => Math.max(0, 1 + change);

// What the levers do to the number of orders, as a multiplier: volume, price through the elasticity, and ads. Each is floored at zero
// on its own, so two negative factors can never multiply into a positive one.
//
// The ad rule is the one guess worth stating plainly: cutting ads loses new-customer orders in proportion, at today's cost per new
// customer, and leaves returning-customer orders alone. Without it, cutting ads would always look free.
function orderFactorOf(base: ScenarioBase, levers: Levers): number {
  const elasticity = levers.elasticity ?? DEFAULT_PRICE_ELASTICITY;
  const newCustomerShare = base.orders > 0 ? Math.min(Math.max(base.newCustomerOrders / base.orders, 0), 1) : 0;
  return grow(levers.volumeChange) * grow(elasticity * (levers.priceChange ?? 0)) * grow((levers.adSpendChange ?? 0) * newCustomerShare);
}

// The period's amounts at a given order factor. Orders, net sales and cost of goods move with it; ads and operating costs do not.
function scaled(base: ScenarioBase, levers: Levers, orderFactor: number): Amounts {
  return {
    netSalesCents: base.netSalesCents * orderFactor * grow(levers.priceChange),
    orders: base.orders * orderFactor,
    costOfGoodsCents: base.costOfGoodsCents * orderFactor * grow(levers.unitCostChange),
    adSpendCents: base.adSpendCents * grow(levers.adSpendChange),
    operatingCostsCents: base.operatingCostsCents * grow(levers.operatingCostChange),
  };
}

const withOrders = (b: Amounts, a: CostAssumptions): EbitdaLines & { orders: number } => ({ ...ebitdaLines(b, a), orders: whole(b.orders) });

export function runScenario(base: ScenarioBase, a: CostAssumptions, levers: Levers): ScenarioResult {
  const baseline = withOrders(base, a);
  const scenario = withOrders(scaled(base, levers, orderFactorOf(base, levers)), a);
  const impacts = LEVER_KEYS.filter((lever) => levers[lever] !== undefined).map((lever) => {
    // The elasticity goes along with each lever because it is how a price change reaches the orders.
    const alone: Levers = { elasticity: levers.elasticity };
    alone[lever] = levers[lever];
    const result = withOrders(scaled(base, alone, orderFactorOf(base, alone)), a);
    return { lever, deltaEbitdaCents: result.ebitdaCents - baseline.ebitdaCents };
  });
  return { baseline, scenario, deltaEbitdaCents: scenario.ebitdaCents - baseline.ebitdaCents, impacts };
}

// EBITDA before rounding. The solve below works on this, so that rounding each line to a cent cannot bend its straight line.
function unroundedEbitda(b: Amounts, a: CostAssumptions): number {
  const l = bridgeOf(b, a);
  return l.netSalesCents - l.costOfGoodsCents - l.cardFeesCents - l.fulfilmentCents - l.adSpendCents - l.operatingCostsCents;
}

// The volume change that reaches a target EBITDA, and the order count it comes to. With the other levers held, EBITDA is a straight
// line in the order factor (net sales, cost of goods, card fees and fulfilment all scale with it; ads and operating costs do not),
// so two points fix the line and the answer needs no search. Any volumeChange already in the levers is ignored, since it is what
// this solves for. The change is relative to the orders left once the other levers are applied: feed it back into runScenario with
// those same levers and the scenario lands on the target, give or take the rounding of the lines. The change is exact; the order
// count is rounded to a whole order, so at that count EBITDA can fall short of the target by up to half an order's profit.
// The target is for the same period as the base: for a base that sums three months, ask for three months' EBITDA.
//
// There is no answer (null) when each extra order loses money, so no volume change gets there; when the other levers have already
// taken every order away, so there is nothing for a percentage to scale; or when the target is below what no orders at all would
// earn, which would take a volume change under -100%.
export function volumeChangeForTarget(
  base: ScenarioBase,
  a: CostAssumptions,
  levers: Levers,
  targetEbitdaCents: number,
): { volumeChange: number; ordersNeeded: number } | null {
  const ebitdaAt = (orderFactor: number) => unroundedEbitda(scaled(base, levers, orderFactor), a);
  const atNoOrders = ebitdaAt(0); // minus the ads and the operating costs
  const perFactor = ebitdaAt(1) - atNoOrders; // what the orders add, per 1.0 of order factor
  if (!(perFactor > 0)) return null;
  const otherFactor = orderFactorOf(base, { ...levers, volumeChange: 0 });
  if (!(otherFactor > 0)) return null;
  const neededFactor = (targetEbitdaCents - atNoOrders) / perFactor;
  const volumeChange = neededFactor / otherFactor - 1;
  if (volumeChange < -1) return null;
  return { volumeChange, ordersNeeded: whole(base.orders * neededFactor) };
}

// The part of a month's amount that has gone by: a month that is half over carries half of its rent, not all of it. Never more than
// the whole amount or less than none.
export function prorate(amountCents: number, elapsedDays: number, daysInMonth: number): number {
  if (!(daysInMonth > 0)) return 0;
  const elapsed = Math.min(Math.max(elapsedDays, 0), daysInMonth);
  return whole((amountCents * elapsed) / daysInMonth);
}
