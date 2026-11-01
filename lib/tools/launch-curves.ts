import { z } from "zod";
import type { Db } from "../db/client";
import { AppError } from "../errors";
import { benchmarkOf, compareWithBenchmark, firstSalesByProduct, LAUNCH_LEAD_DAYS, launchCurve, productTitles, splitFirstSales, unitsByProductDay, type BenchmarkWeek, type ComparedWeek } from "../metrics/launch";
import type { TenantContext } from "../tenancy/context";
import { assertInWindow, asOfOf, capLimit, dateString, dbFor, idList, limitField, loadWindow, parseInput, queryIdFor } from "./common";
import { requireConnectedShop, type ToolResult } from "./result";

const DEFAULT_WEEKS = 8;
const THIN_BENCHMARK = 3; // fewer launches than this behind a week's median and the comparison is a rough guide

// strictObject: an unknown key (a tenant, a shop, anything the model invents) is an error, not ignored.
export const getLaunchCurvesInputSchema = z.strictObject({
  productIds: idList.optional(), // list only these launches; the benchmark is still every launch in the range
  launchedFrom: dateString.optional(), // first-sale dates of the launches to use; give both or neither; default every launch in the data
  launchedTo: dateString.optional(),
  weeks: z.number().int().min(1).max(12).optional(), // weeks of each curve; default 8
  limit: limitField,
});
export type GetLaunchCurvesInput = z.input<typeof getLaunchCurvesInputSchema>;

export interface LaunchRow {
  productId: string;
  launchDate: string; // the store-local date of the product's first sale
  daysObserved: number; // launch day to the last day of the data, capped at weeks * 7
  fullyObserved: boolean; // all the asked weeks are complete
  totalUnits: number; // over the observed days
  weeks: ComparedWeek[];
  untrusted: { product: string | null }; // store text
}

export interface LaunchCurvesData {
  benchmark: BenchmarkWeek[]; // the median curve of every launch in the range, for each week that at least one launch fully saw
  launches: LaunchRow[]; // newest launch first
  caveats?: string[];
}

const DEFINITIONS = {
  launch: `The products table has no publish date, so a launch is a product's first sale: the store-local date of its first non-cancelled order line. A product already selling when the data begins has no knowable launch, so only products whose first sale is at least ${LAUNCH_LEAD_DAYS} days after the first order in the store's data count as launches; the caveats say how many were left out.`,
  week: "A week is seven days starting on the launch date: week 1 is the launch day and the six after it, week 2 the next seven, and so on. The week the data ends in is cut to the last day of data: daysObserved says how many of its days exist (7 means the week is complete), and a week that starts after the data ends is not listed.",
  units: "Units are order-line quantity before refunds, with cancelled orders left out (the same as zero_sales_days). cumulativeUnits adds the weeks so far; totalUnits is the sum over the observed days.",
  benchmark: "For each week, the median of units, and of cumulativeUnits, across the launches whose week is complete (launches says how many). It covers every launch in the launchedFrom to launchedTo range (default all), whatever productIds lists, so a product is compared with its peers. The median of an even count is the mean of the two middle values.",
  comparison: "vsMedianUnits is a launch week's units minus that week's medianUnits; pctOfMedianUnits is its units as a fraction of medianUnits (1 equals the median, 0.5 is half of it). Both are null for a week that is not complete, and pctOfMedianUnits is also null when the median is 0.",
};

const noun = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// How each product's sales ramped in the weeks after its first sale, against the median launch in the store. The tenant is the
// session's; every difference and fraction is computed here, not by the model.
export async function getLaunchCurves(ctx: TenantContext, rawInput: GetLaunchCurvesInput, deps: { db?: Db } = {}): Promise<ToolResult<LaunchCurvesData>> {
  requireConnectedShop(ctx);
  const input = parseInput(getLaunchCurvesInputSchema, rawInput);
  if ((input.launchedFrom === undefined) !== (input.launchedTo === undefined)) throw new AppError("INVALID_INPUT", "Give both launchedFrom and launchedTo, or neither.");
  if (input.launchedFrom !== undefined && input.launchedTo !== undefined && input.launchedFrom > input.launchedTo)
    throw new AppError("INVALID_INPUT", `launchedFrom (${input.launchedFrom}) is after launchedTo (${input.launchedTo}).`);
  const db = await dbFor(deps);
  const win = await loadWindow(db, ctx.tenantId);
  const asked = input.launchedFrom !== undefined && input.launchedTo !== undefined ? { from: input.launchedFrom, to: input.launchedTo } : null;
  assertInWindow(asked ?? { from: win.first ?? "", to: win.last ?? "" }, win);
  const first = win.first!;
  const last = win.last!;
  const weeks = input.weeks ?? DEFAULT_WEEKS;
  const inRange = (date: string) => !asked || (date >= asked.from && date <= asked.to);
  const wanted = input.productIds ? new Set(input.productIds) : null;

  const firstSales = await firstSalesByProduct(db, ctx.tenantId);
  const split = splitFirstSales(firstSales, first);
  const group = split.launches.filter((l) => inRange(l.launchDate)); // the benchmark's launches
  const leftOut = split.alreadySelling.filter((id) => inRange(firstSales.get(id)!) && (!wanted || wanted.has(id)));

  const perDay = group.length > 0 ? await unitsByProductDay(db, ctx.tenantId, group.map((l) => l.productId), { from: group[0]!.launchDate, to: last }) : new Map<string, Map<string, number>>();
  const curves = group.map((l) => launchCurve(l.productId, l.launchDate, perDay.get(l.productId) ?? new Map<string, number>(), weeks, last));
  const benchmark = benchmarkOf(curves);

  const listed = curves.filter((c) => !wanted || wanted.has(c.productId)).sort((a, b) => b.launchDate.localeCompare(a.launchDate) || a.productId.localeCompare(b.productId));
  const shown = listed.slice(0, capLimit(input.limit));
  const titles = await productTitles(db, ctx.tenantId, shown.map((c) => c.productId));
  const rows: LaunchRow[] = shown.map((c) => ({
    productId: c.productId,
    launchDate: c.launchDate,
    daysObserved: c.daysObserved,
    fullyObserved: c.fullyObserved,
    totalUnits: c.totalUnits,
    weeks: compareWithBenchmark(c, benchmark),
    untrusted: { product: titles.get(c.productId) ?? null },
  }));

  const caveats: string[] = [];
  const where = asked ? `with a first sale from ${asked.from} to ${asked.to}` : "in the data";
  if (group.length === 0) caveats.push(`No product launched ${where}: a launch is a product whose first sale comes at least ${LAUNCH_LEAD_DAYS} days after the store's first order (${first}).`);
  if (leftOut.length > 0)
    caveats.push(`${noun(leftOut.length, "product was", "products were")} left out because ${leftOut.length === 1 ? "it was" : "they were"} already selling when the data begins (a first sale within ${LAUNCH_LEAD_DAYS} days of the store's first order on ${first}), so ${leftOut.length === 1 ? "its launch" : "their launches"} cannot be known.`);
  if (wanted) {
    const inGroup = new Set(group.map((l) => l.productId));
    const missing = [...wanted].filter((id) => !inGroup.has(id) && !leftOut.includes(id));
    if (missing.length > 0) caveats.push(`${missing.length} of the ${wanted.size} products asked for ${missing.length === 1 ? "is" : "are"} not listed: ${missing.length === 1 ? "it has" : "they have"} no sales in the data, or a first sale outside ${asked ? `${asked.from} to ${asked.to}` : "the data"}.`);
  }
  const thin = benchmark.filter((b) => b.launches < THIN_BENCHMARK).map((b) => b.week);
  if (thin.length > 0) caveats.push(`The benchmark for week${thin.length === 1 ? "" : "s"} ${thin.join(", ")} rests on fewer than ${THIN_BENCHMARK} launches, so the comparison there is a rough guide.`);
  const partial = rows.filter((r) => !r.fullyObserved).length;
  if (partial > 0) caveats.push(`${partial} of the ${rows.length} launches listed ${partial === 1 ? "has" : "have"} less than ${weeks} weeks of data (it ends on ${last}): ${partial === 1 ? "its" : "their"} last week is partial or missing, and a partial week has no comparison with the median.`);

  const asOf = asOfOf(win);
  return {
    data: { benchmark, launches: rows, ...(caveats.length > 0 ? { caveats } : {}) },
    queryId: queryIdFor("get_launch_curves", ctx.tenantId, input, asOf),
    range: { from: group[0]?.launchDate ?? first, to: last },
    definitions: DEFINITIONS,
    asOf,
    ...(listed.length > rows.length ? { truncated: { shown: rows.length, total: listed.length } } : {}),
  };
}

type Run = (ctx: TenantContext, input: never, deps: { db?: Db }) => Promise<ToolResult<unknown>>;

// The shape of an entry of TOOL_DEFS in lib/agent/tools.ts.
export const getLaunchCurvesTool = {
  description:
    "Launch curves: units sold by week since a product's launch, against the median launch in the store. The products table has no publish date, so a launch is a product's first sale, and only products whose first sale is at least 14 days after the store's first order count (a product already selling when the data begins has no knowable launch; caveats says how many were left out). Say it is the first sale, not a publish date. Week 1 is the launch day and the six after it; weeks is how many to show (1 to 12, default 8). Each launch has weeks of units and cumulativeUnits (before refunds, cancelled orders left out) with vsMedianUnits (units minus the median) and pctOfMedianUnits (a fraction of the median, 1 equals it). Both are null for a partial week: daysObserved under 7 means the data ends inside it, and fullyObserved false means the launch has not had all its weeks. benchmark is the median curve (medianUnits, medianCumulativeUnits, and launches, how many launches it rests on) over every launch in launchedFrom to launchedTo (both or neither; default all), not narrowed by productIds, so give productIds to ask how one product's launch compares with its peers. Launches are newest first. Quote every figure as written; never work out a difference, share, total or rate yourself. Read caveats and say them. A chart cannot be drawn from this result: give the weeks in a small table.",
  schema: getLaunchCurvesInputSchema as z.ZodType,
  run: getLaunchCurves as unknown as Run,
};
