import { z } from "zod";
import type { Db } from "../db/client";
import { DIMENSIONS } from "../metrics/query";
import { CORE_METRIC_IDS, METRICS, type MetricDef } from "../metrics/registry";
import { asOfOf, dbFor, loadWindow, parseInput, PERIODS, queryIdFor, todayFor, type Ctx } from "./common";
import { requireConnectedShop, type ToolResult } from "./result";

export const describeMetricsInputSchema = z.strictObject({
  metrics: z.array(z.enum(CORE_METRIC_IDS)).min(1).optional(),
});
export type DescribeMetricsInput = z.input<typeof describeMetricsInputSchema>;

export interface MetricsDescription {
  metrics: MetricDef[];
  groupBy: readonly string[];
  periods: readonly string[];
  units: string;
}

// What each metric means and how results are written, straight from the registry that computes them.
export async function describeMetrics(ctx: Ctx, rawInput: DescribeMetricsInput, deps: { db?: Db } = {}): Promise<ToolResult<MetricsDescription>> {
  const shop = requireConnectedShop(ctx);
  const input = parseInput(describeMetricsInputSchema, rawInput);
  const db = await dbFor(deps);
  const win = await loadWindow(db, ctx.tenantId);
  const wanted = input.metrics ? [...new Set(input.metrics)] : [...CORE_METRIC_IDS];
  const today = todayFor(shop.timezone, win);
  const asOf = asOfOf(win);
  return {
    data: {
      metrics: wanted.map((m) => METRICS[m]),
      groupBy: DIMENSIONS,
      periods: PERIODS,
      units: "Money is in integer cents (2800 means $28.00). Rates are fractions (0.18 means 18%). Counts are whole numbers.",
    },
    queryId: queryIdFor("describe_metrics", ctx.tenantId, input, asOf),
    range: { from: win.first ?? today, to: win.last ?? today },
    definitions: Object.fromEntries(wanted.map((m) => [m, METRICS[m].definition])),
    asOf,
  };
}
