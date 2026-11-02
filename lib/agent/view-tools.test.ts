import { describe, expect, it } from "vitest";
import type { BundleCandidatesData } from "../tools/bundles";
import type { LaunchCurvesData } from "../tools/launch-curves";
import type { PromoPostmortemData } from "../tools/promo-postmortem";
import type { ToolResult } from "../tools/result";
import { buildRenderViewTool, renderViewInput, type TurnCall } from "./view-tools";

const envelope = <T>(data: T, queryId: string): ToolResult<T> => ({ data, queryId, range: { from: "2025-11-28", to: "2025-12-01" }, definitions: {}, asOf: "2026-10-31T10:00:00.000Z" });
const promo: PromoPostmortemData = {
  window: { from: "2025-11-28", to: "2025-12-01", days: 4 },
  during: { orders: 5, netSalesCents: 28_200 },
  baseline: { from: "2025-11-01", to: "2025-11-27", days: 27, orders: 4, netSalesCents: 48_300, ordersPerDay: 0.15, netSalesPerDayCents: 1_789 },
  expected: { orders: 1, netSalesCents: 7_156 },
  extra: { orders: 4, netSalesCents: 21_044, pctOfExpected: 2.94, ordersPctOfExpected: 4 },
  after: { from: "2025-12-02", to: "2025-12-29", daysObserved: 28, fullyObserved: true, orders: 7, netSalesCents: 31_440, expectedOrders: 4, expectedNetSalesCents: 50_089, pulledForwardOrders: 0, pulledForwardNetSalesCents: 18_649 },
  netLift: { orders: 4, netSalesCents: 2_395 },
  customers: { repeatWindowDays: 30, promoCohort: { range: { from: "2025-11-28", to: "2025-12-01" }, cohortCustomers: 5, customers: 5, repeaters: 0, repeatRate: 0, notYetObserved: 0 }, comparison: { range: { from: "2025-11-01", to: "2025-11-27" }, cohortCustomers: 4, customers: 4, repeaters: 0, repeatRate: 0, notYetObserved: 0 }, repeatRateGap: 0 },
};
const launches: LaunchCurvesData = { benchmark: [], launches: [] };
const bundles: BundleCandidatesData = { ordersInRange: 100, ordersWithTwoOrMoreProducts: 20, pairs: [] };
const IDS = { promo: "q_000000000001", launches: "q_000000000002", bundles: "q_000000000003", metric: "q_000000000004", stock: "q_000000000005" };

function setup() {
  const calls = new Map<string, TurnCall>([
    [IDS.promo, { tool: "get_promo_postmortem", input: { code: "BFCM25" }, result: envelope(promo, IDS.promo) }],
    [IDS.launches, { tool: "get_launch_curves", input: { weeks: 4 }, result: envelope(launches, IDS.launches) }],
    [IDS.bundles, { tool: "get_bundle_candidates", input: {}, result: envelope(bundles, IDS.bundles) }],
    [IDS.stock, { tool: "get_inventory", input: {}, result: envelope([], IDS.stock) }],
    [IDS.metric, { tool: "query_metric", input: { metrics: ["orders"], groupBy: ["channel"] }, result: envelope([{ group: { channel: "web" }, values: { orders: 3 } }], IDS.metric) }],
  ]);
  const written: { type: string; data: { component: string; title: string; sources: { tool: string; input: unknown }[] } }[] = [];
  const steps: { tool: string; ok: boolean; errorCode?: string }[] = [];
  const t = buildRenderViewTool({ calls, write: (c) => written.push(c as never), titleProblems: () => [], onStep: (e) => steps.push(e) });
  const draw = (input: unknown) => (t.execute as unknown as (i: unknown, o: unknown) => Promise<{ rendered?: boolean; error?: { code: string; message: string } }>)(input, { toolCallId: "t", messages: [] });
  return { draw, written, steps };
}

describe("render_view: the lift, launch and bundle charts", () => {
  it.each([
    ["lift_dip", IDS.promo, "get_promo_postmortem", { code: "BFCM25" }],
    ["launch_curves", IDS.launches, "get_launch_curves", { weeks: 4 }],
    ["bundle_matrix", IDS.bundles, "get_bundle_candidates", {}],
  ])("draws a %s from its own tool's result, and sends the tool and its input to pin it again", async (component, queryId, tool, input) => {
    const { draw, written, steps } = setup();
    expect(await draw({ component, title: "A few words", queryRefs: [queryId] })).toMatchObject({ rendered: true, component });
    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({ type: "data-view", data: { component, title: "A few words", sources: [{ tool, input }] } });
    expect(steps).toEqual([expect.objectContaining({ tool: "render_view", ok: true })]);
  });

  it.each([
    ["a lift_dip from a bundle result", "lift_dip", IDS.bundles, /get_promo_postmortem/],
    ["a launch_curves from a promo result", "launch_curves", IDS.promo, /get_launch_curves/],
    ["a bundle_matrix from a query_metric result", "bundle_matrix", IDS.metric, /get_bundle_candidates/],
    ["a bar from a launch result", "bar", IDS.launches, /query_metric/],
  ])("tells the model when it asks for %s, and draws nothing", async (_what, component, queryId, message) => {
    const { draw, written, steps } = setup();
    const out = await draw({ component, title: "x", queryRefs: [queryId] });
    expect(out.error).toMatchObject({ code: "INVALID_INPUT" });
    expect(out.error!.message).toMatch(message);
    expect(written).toHaveLength(0);
    expect(steps[0]).toMatchObject({ ok: false, errorCode: "INVALID_INPUT" });
  });

  it("still refuses a query id from another turn, and a tool a view cannot be drawn from", async () => {
    const { draw } = setup();
    expect((await draw({ component: "lift_dip", title: "x", queryRefs: ["q_ffffffffffff"] })).error?.message).toMatch(/not a query id from this turn/);
    expect((await draw({ component: "table", title: "x", queryRefs: [IDS.stock] })).error?.message).toMatch(/Views are drawn from query_metric, get_cohorts, get_promo_postmortem, get_launch_curves, get_bundle_candidates results only/);
  });

  it("offers the three new components in the schema, and rejects anything else", () => {
    for (const component of ["lift_dip", "launch_curves", "bundle_matrix"]) expect(renderViewInput.safeParse({ component, title: "x", queryRefs: ["q_000000000001"] }).success).toBe(true);
    expect(renderViewInput.safeParse({ component: "pie", title: "x", queryRefs: ["q_000000000001"] }).success).toBe(false);
  });
});
