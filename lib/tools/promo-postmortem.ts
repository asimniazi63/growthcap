import { z } from "zod";
import type { Db } from "../db/client";
import { AppError } from "../errors";
import { loadCustomerHistories } from "../metrics/cohorts";
import { addDays } from "../metrics/dates";
import { cohortStats, codeUsage, daysIn, liftOf, repeatGap, totalsFor, type CohortStats, type Range, type Totals } from "../metrics/postmortem";
import { METRICS } from "../metrics/registry";
import type { TenantContext } from "../tenancy/context";
import { assertInWindow, asOfOf, dateString, dbFor, loadWindow, parseInput, queryIdFor, resolveRange, todayFor } from "./common";
import { requireConnectedShop, type ToolResult } from "./result";

// strictObject: an unknown key (a tenant, a shop, anything the model invents) is an error, not ignored.
export const getPromoPostmortemInputSchema = z.strictObject({
  code: z.string().min(1).max(100).optional(), // a discount code; without from and to, the window is its first to its last day of use
  from: dateString.optional(), // the event window; give both or neither
  to: dateString.optional(),
  baselineDays: z.union([z.literal(14), z.literal(28), z.literal(56)]).optional(), // days before the window for the baseline, and after it for the dip; default 28
  repeatWindowDays: z.union([z.literal(30), z.literal(60), z.literal(180)]).optional(), // default 30
  compareFrom: dateString.optional(), // first-order dates of the comparison customers; give both or neither; default the baseline range
  compareTo: dateString.optional(),
});
export type GetPromoPostmortemInput = z.input<typeof getPromoPostmortemInputSchema>;

export interface PromoPostmortemData {
  code?: string;
  window: { from: string; to: string; days: number };
  during: Totals; // the whole store in the window
  baseline: { from: string; to: string; days: number; orders: number; netSalesCents: number; ordersPerDay: number; netSalesPerDayCents: number };
  expected: Totals; // the baseline's daily rate times the window's days
  extra: Totals & { pctOfExpected: number | null; ordersPctOfExpected: number | null }; // during - expected; the shares are fractions of expected net sales and expected orders
  after: {
    from: string;
    to: string;
    daysObserved: number; // days of the after range that are in the data
    fullyObserved: boolean;
    orders: number;
    netSalesCents: number;
    expectedOrders: number;
    expectedNetSalesCents: number;
    pulledForwardOrders: number; // expected - actual in the after range, never below 0
    pulledForwardNetSalesCents: number;
  };
  netLift: Totals; // extra - pulled forward; negative if the promo only moved sales earlier, or lost them
  codeOrders?: { orders: number; netSalesCents: number; discountCents: number }; // only with a code: the orders that used it in the window
  customers: {
    repeatWindowDays: number;
    promoCohort: CohortStats & { firstOrderCode?: string };
    comparison: CohortStats & { excludedCode?: string };
    repeatRateGap: number | null; // promoCohort.repeatRate - comparison.repeatRate, a fraction; null if either has no rate
  };
  caveats?: string[];
}

const DEFINITIONS = {
  baseline:
    "The N days immediately before the window (baselineDays, default 28; fewer if the data starts later), at their average daily orders and net sales. expected is that daily rate times the window's days. It is an estimate, not proof of cause: a seasonal week, a price change, an ad push or a stockout in the baseline or the window can fake or hide a lift, and a window much longer than the baseline compares a long stretch with a short one.",
  extra: "during minus expected, for the whole store: orders and net sales (net sales are after discounts and refunds). pctOfExpected is extra net sales as a fraction of expected net sales and ordersPctOfExpected is extra orders as a fraction of expected orders; both are null when expected is 0.",
  pulledForward:
    "The N days right after the window, at the baseline's daily rate: expected minus actual, never below 0. A promotion often just moves sales earlier, so a shortfall after it is sales the promo took from later. after is cut to the last day of the data: daysObserved says how many of its days exist and fullyObserved whether all do. The dip is the same estimate as the baseline and can have other causes.",
  netLift: "extra minus pulled forward: what the promotion added once the dip after it is taken back. It can be negative.",
  cohorts:
    "promoCohort is the customers whose FIRST order falls in the window (and, with a code, used that code). comparison is the customers whose first order falls in the comparison range (default the baseline range), leaving out those whose first order used the code. repeatRateGap is promoCohort.repeatRate minus comparison.repeatRate, a fraction; negative means the promo's customers came back less. Customers whose first order is not yet repeatWindowDays old are left out (notYetObserved).",
  repeat_rate: METRICS.repeat_rate.definition,
};
const CODE_DEFINITION = "The orders that used the code in the window: orders, net sales after discounts, and discountCents, the discounts they were given (the cost of the offer). Counted as query_metric does with a discount-code filter.";

const noun = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

// How much extra a promotion sold against the days before it, how much of that was pulled forward from the days after, and how
// good its customers were. The tenant is the session's; every figure is computed here, not by the model.
export async function getPromoPostmortem(ctx: TenantContext, rawInput: GetPromoPostmortemInput, deps: { db?: Db } = {}): Promise<ToolResult<PromoPostmortemData>> {
  const shop = requireConnectedShop(ctx);
  const input = parseInput(getPromoPostmortemInputSchema, rawInput);
  const db = await dbFor(deps);
  const win = await loadWindow(db, ctx.tenantId);
  const baselineDays = input.baselineDays ?? 28;
  const repeatWindowDays = input.repeatWindowDays ?? 30;

  const hasEvent = input.from !== undefined || input.to !== undefined;
  if (!hasEvent && !input.code) throw new AppError("INVALID_INPUT", "Give a code, or both from and to.");
  if ((input.compareFrom === undefined) !== (input.compareTo === undefined)) throw new AppError("INVALID_INPUT", "Give both compareFrom and compareTo, or neither.");
  if (input.compareFrom !== undefined && input.compareTo !== undefined && input.compareFrom > input.compareTo)
    throw new AppError("INVALID_INPUT", `compareFrom (${input.compareFrom}) is after compareTo (${input.compareTo}).`);
  const asked = hasEvent ? resolveRange(input, todayFor(shop.timezone, win)) : null;
  const used = input.code ? await codeUsage(db, ctx.tenantId, input.code) : null;
  if (input.code && !used) throw new AppError("NO_DATA", `No order in this store used the code ${input.code}.`);
  const requested: Range = asked ?? used!;
  assertInWindow(requested, win);

  const first = win.first!;
  const last = win.last!;
  const caveats: string[] = [];

  // The window is cut to the data: a promotion still running has only the days so far.
  const window: Range = { from: requested.from, to: requested.to > last ? last : requested.to };
  if (requested.to > last) caveats.push(`The window runs past the last day of data (${last}), so it is cut to ${window.from} to ${window.to}.`);
  const windowDays = daysIn(window);

  const baselineFrom = addDays(window.from, -baselineDays);
  const baselineRange: Range = { from: baselineFrom < first ? first : baselineFrom, to: addDays(window.from, -1) };
  if (daysIn(baselineRange) === 0) throw new AppError("NO_DATA", `There are no days before the window to use as a baseline: this store's orders start on ${first}.`);
  if (daysIn(baselineRange) < baselineDays) caveats.push(`Only ${noun(daysIn(baselineRange), "day")} of the ${baselineDays}-day baseline are in the data (it starts on ${first}), so the baseline is thinner than asked.`);

  if (windowDays > 2 * baselineDays) caveats.push(`The window is ${windowDays} days, much longer than the ${baselineDays}-day baseline, so the baseline may not represent it. Give from and to for the burst you mean.`);

  const afterEnd = addDays(window.to, baselineDays);
  const afterRange: Range = { from: addDays(window.to, 1), to: afterEnd > last ? last : afterEnd };
  const afterDays = daysIn(afterRange);
  if (afterDays < baselineDays) caveats.push(`Only ${noun(afterDays, "day")} of the ${baselineDays} days after the window are in the data (it ends on ${last}), so a dip after the promotion is only partly visible.`);

  const baseline = await totalsFor(ctx, db, baselineRange);
  const during = await totalsFor(ctx, db, window);
  const after = afterDays > 0 ? await totalsFor(ctx, db, afterRange) : { orders: 0, netSalesCents: 0, discountCents: 0 };
  const lift = liftOf({ baselineDays: daysIn(baselineRange), baseline, windowDays, during, afterDays, after });

  const codeOrders = input.code ? await totalsFor(ctx, db, window, input.code) : null;
  if (codeOrders && codeOrders.orders === 0) caveats.push(`No order used ${input.code} inside this window.`);

  const histories = await loadCustomerHistories(db, ctx.tenantId);
  const compareRange: Range = input.compareFrom !== undefined && input.compareTo !== undefined ? { from: input.compareFrom, to: input.compareTo } : baselineRange;
  const promoCohort = cohortStats(histories, { ...window, ...(input.code ? { firstOrderCode: input.code } : {}) }, repeatWindowDays, last);
  const comparison = cohortStats(histories, { ...compareRange, ...(input.code ? { excludeFirstOrderCode: input.code } : {}) }, repeatWindowDays, last);
  for (const [name, c] of [["promo cohort", promoCohort], ["comparison", comparison]] as const) {
    if (c.customers === 0) {
      caveats.push(c.cohortCustomers === 0 ? `The ${name} has no customers (no first orders in ${c.range.from} to ${c.range.to}), so it has no repeat rate.` : `No customer in the ${name} is old enough yet to count for the ${repeatWindowDays}-day repeat rate.`);
    }
  }

  const syncedAt = asOfOf(win);
  const data: PromoPostmortemData = {
    ...(input.code ? { code: input.code } : {}),
    window: { ...window, days: windowDays },
    during: { orders: during.orders, netSalesCents: during.netSalesCents },
    baseline: { ...baselineRange, days: daysIn(baselineRange), orders: baseline.orders, netSalesCents: baseline.netSalesCents, ordersPerDay: lift.ordersPerDay, netSalesPerDayCents: lift.netSalesPerDayCents },
    expected: lift.expected,
    extra: lift.extra,
    after: {
      ...afterRange,
      daysObserved: afterDays,
      fullyObserved: afterDays === baselineDays,
      orders: after.orders,
      netSalesCents: after.netSalesCents,
      expectedOrders: lift.afterExpected.orders,
      expectedNetSalesCents: lift.afterExpected.netSalesCents,
      pulledForwardOrders: lift.pulledForward.orders,
      pulledForwardNetSalesCents: lift.pulledForward.netSalesCents,
    },
    netLift: lift.netLift,
    ...(codeOrders ? { codeOrders: { orders: codeOrders.orders, netSalesCents: codeOrders.netSalesCents, discountCents: codeOrders.discountCents } } : {}),
    customers: {
      repeatWindowDays,
      promoCohort: { ...promoCohort, ...(input.code ? { firstOrderCode: input.code } : {}) },
      comparison: { ...comparison, ...(input.code ? { excludedCode: input.code } : {}) },
      repeatRateGap: repeatGap(promoCohort.repeatRate, comparison.repeatRate),
    },
    ...(caveats.length > 0 ? { caveats } : {}),
  };

  return {
    data,
    queryId: queryIdFor("get_promo_postmortem", ctx.tenantId, input, syncedAt),
    range: window,
    definitions: input.code ? { ...DEFINITIONS, codeOrders: CODE_DEFINITION } : DEFINITIONS,
    asOf: syncedAt,
  };
}

type Run = (ctx: TenantContext, input: never, deps: { db?: Db }) => Promise<ToolResult<unknown>>;

// The shape of an entry of TOOL_DEFS in lib/agent/tools.ts.
export const getPromoPostmortemTool = {
  description:
    "Was this discount code or event worth it? Give a code (the window is its first to its last day of use) and/or from and to. Compares the whole store in the window with a baseline, the baselineDays (14, 28 or 56; default 28) just before it, at their daily rate. extra is what the window sold above that (orders, netSalesCents, pctOfExpected for net sales, ordersPctOfExpected for orders). after covers the baselineDays right after the window: pulledForwardOrders and pulledForwardNetSalesCents are the sales missing there against the baseline, which the promo took from later (fullyObserved false means the data ends before the dip is fully visible). netLift is extra minus what was pulled forward, and can be negative. With a code, codeOrders is the orders that used it with its discountCents (the cost of the offer). customers compares the repeat rate of the customers whose first order was in the window (and used the code) with those whose first order was in the comparison range (default the baseline; compareFrom and compareTo change it), over repeatWindowDays (30, 60 or 180): repeatRateGap is the promotion's rate minus the comparison's, negative when its customers came back less (state both rates, then the gap as a percentage such as 'a gap of 8.3%'). For a burst inside a longer-running code, give from and to. Read caveats and say them. It is a baseline estimate, not proof of cause. Quote every figure as written; never work out a difference, share, total or rate yourself. A verdict must put the extra, the pulled-forward sales, the cost of the offer and the customer quality together. Draw it with render_view component lift_dip (the average day before, during and after the window, with the extra and the pulled-forward sales marked).",
  schema: getPromoPostmortemInputSchema as z.ZodType,
  run: getPromoPostmortem as unknown as Run,
};
