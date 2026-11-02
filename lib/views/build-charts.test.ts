import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setTestNow } from "../clock";
import type { Db } from "../db/client";
import { createTestDb } from "../db/test-db";
import { seedTwoStores } from "../../scripts/fixtures/load-db";
import type { TenantContext } from "../tenancy/context";
import { getBundleCandidates } from "../tools/bundles";
import { getLaunchCurves } from "../tools/launch-curves";
import { getPromoPostmortem } from "../tools/promo-postmortem";
import { buildView } from "./build";
import { BUNDLE_MAX_PRODUCTS, BUNDLE_THIN_ORDERS } from "./types";

// The three charts built from what the real tools return on the two seeded stores, so the payloads are checked against the
// results the agent would hold, not against hand-made ones.

let db: Db;
let solenne: TenantContext;
let tidepool: TenantContext;

beforeAll(async () => {
  setTestNow("2026-11-02T12:00:00-05:00");
  db = await createTestDb();
  const seeded = await seedTwoStores(db);
  solenne = seeded.ctxs.solenne;
  tidepool = seeded.ctxs.tidepool;
}, 240_000);

afterAll(() => setTestNow(null));

describe("lift_dip from get_promo_postmortem", () => {
  it("Tidepool's BFCM25: the labelled figures are the result's, and the dip after the window is there to draw", async () => {
    const input = { code: "BFCM25" };
    const result = await getPromoPostmortem(tidepool, input, { db });
    const v = buildView("lift_dip", [{ tool: "get_promo_postmortem", input, result }]);
    if (v.component !== "lift_dip") throw new Error();
    const d = result.data;
    expect(v.code).toBe("BFCM25");
    expect(v.extraNetSalesCents).toBe(d.extra.netSalesCents);
    expect(v.pulledForwardNetSalesCents).toBe(d.after.pulledForwardNetSalesCents);
    expect(v.netLiftNetSalesCents).toBe(d.netLift.netSalesCents);
    expect(v.pulledForwardNetSalesCents).toBeGreaterThan(0);
    expect(v.baseline.perDayCents).toBe(d.baseline.netSalesPerDayCents);
    expect(v.window.netSalesCents).toBe(d.during.netSalesCents);
    expect(v.window.days).toBe(d.window.days);
    expect(v.after.netSalesCents).toBe(d.after.netSalesCents);
    expect(v.after.perDayCents).toBeLessThan(v.baseline.perDayCents); // the dip: the days after sold below the baseline rate
    expect(v.customers.repeatRateGap).toBe(d.customers.repeatRateGap);
    expect(v.caveats).toEqual(d.caveats); // the thin baseline is said on the chart
    expect(v.queryIds).toEqual([result.queryId]);
    expect(v.range).toEqual(result.range);
  });

  it("Solenne's BFCM25 kept selling after the window: nothing pulled forward, and the net lift is the extra", async () => {
    const input = { code: "BFCM25" };
    const result = await getPromoPostmortem(solenne, input, { db });
    const v = buildView("lift_dip", [{ tool: "get_promo_postmortem", input, result }]);
    if (v.component !== "lift_dip") throw new Error();
    expect(v.pulledForwardNetSalesCents).toBe(0);
    expect(v.netLiftNetSalesCents).toBe(v.extraNetSalesCents);
    expect(v.after.perDayCents).toBeGreaterThanOrEqual(v.baseline.perDayCents);
    expect(v.customers.promo.repeatRate).toBe(result.data.customers.promoCohort.repeatRate);
  });
});

describe("launch_curves from get_launch_curves", () => {
  it("Solenne: twelve cards, newest first, each with the result's total and weeks, and the median behind them", async () => {
    const result = await getLaunchCurves(solenne, {}, { db });
    const v = buildView("launch_curves", [{ tool: "get_launch_curves", input: {}, result }]);
    if (v.component !== "launch_curves") throw new Error();
    const rows = result.data.launches;
    expect(rows.length).toBeGreaterThan(12);
    expect(v.launches).toHaveLength(12);
    expect(v.truncated).toEqual({ shown: 12, total: rows.length });
    expect(v.launches.map((l) => l.launchDate)).toEqual(rows.slice(0, 12).map((r) => r.launchDate));
    v.launches.forEach((l, i) => {
      const r = rows[i]!;
      expect(l.title).toBe(r.untrusted.product);
      expect(l.totalUnits).toBe(r.totalUnits);
      expect(l.weeks.map((w) => w.cumulativeUnits)).toEqual(r.weeks.map((w) => w.cumulativeUnits));
    });
    expect(v.benchmark.map((b) => b.medianCumulativeUnits)).toEqual(result.data.benchmark.map((b) => b.medianCumulativeUnits));
    expect(v.caveats).toEqual(result.data.caveats);
    expect(JSON.stringify(v)).not.toContain("gid://");
  });

  it("a window with no launch in it still builds, with the caveat that says why", async () => {
    const input = { launchedFrom: "2025-09-01", launchedTo: "2025-09-05" };
    const result = await getLaunchCurves(solenne, input, { db });
    const v = buildView("launch_curves", [{ tool: "get_launch_curves", input, result }]);
    if (v.component !== "launch_curves") throw new Error();
    expect(v.launches).toEqual([]);
    expect(v.caveats?.join(" ")).toMatch(/No product launched/);
  });
});

describe("bundle_matrix from get_bundle_candidates", () => {
  it("Solenne: at most twelve products, every drawn pair is a pair of the result with its own figures, and the thin ones are marked", async () => {
    const result = await getBundleCandidates(solenne, {}, { db });
    const v = buildView("bundle_matrix", [{ tool: "get_bundle_candidates", input: {}, result }]);
    if (v.component !== "bundle_matrix") throw new Error();
    expect(v.products.length).toBe(BUNDLE_MAX_PRODUCTS);
    expect(v.omitted!.pairs).toBe(result.data.pairs.length - v.pairs.length);
    expect(v.ordersInRange).toBe(result.data.ordersInRange);
    // Axis order: most shared orders first.
    for (let i = 1; i < v.products.length; i++) expect(v.products[i - 1]!.sharedOrders).toBeGreaterThanOrEqual(v.products[i]!.sharedOrders);
    const byTitles = new Map(result.data.pairs.map((p) => [[p.untrusted.productA, p.untrusted.productB].sort().join("|"), p]));
    for (const p of v.pairs) {
      const A = v.products[p.a]!;
      const B = v.products[p.b]!;
      const row = byTitles.get([A.title, B.title].sort().join("|"))!;
      expect(row, `${A.title} + ${B.title}`).toBeDefined();
      expect(p.ordersTogether).toBe(row.ordersTogether);
      expect(p.lift).toBe(row.lift);
      expect(p.thin).toBe(row.ordersTogether < BUNDLE_THIN_ORDERS);
      // The confidence is the share of the first product's orders that also had the second, whichever way round the result had them.
      expect(p.confidenceAtoB).toBeCloseTo(p.ordersTogether / A.orders, 12);
      expect(p.confidenceBtoA).toBeCloseTo(p.ordersTogether / B.orders, 12);
    }
    expect(v.pairs.some((p) => p.thin)).toBe(true);
    // The seeded lifts are weak: nothing here reaches the top of the colour scale (2.0).
    expect(Math.max(...v.pairs.map((p) => p.lift))).toBeLessThan(2);
    expect(JSON.stringify(v)).not.toContain("gid://");
  });

  it("Tidepool: three products and two pairs, nothing left out", async () => {
    const result = await getBundleCandidates(tidepool, {}, { db });
    const v = buildView("bundle_matrix", [{ tool: "get_bundle_candidates", input: {}, result }]);
    if (v.component !== "bundle_matrix") throw new Error();
    expect(v.products).toHaveLength(3);
    expect(v.pairs).toHaveLength(2);
    expect(v.omitted).toBeUndefined();
  });

  it("no pair reaches minOrders: builds an empty matrix with the caveat", async () => {
    const input = { minOrders: 100 };
    const result = await getBundleCandidates(solenne, input, { db });
    const v = buildView("bundle_matrix", [{ tool: "get_bundle_candidates", input, result }]);
    if (v.component !== "bundle_matrix") throw new Error();
    expect(v.pairs).toEqual([]);
    expect(v.caveats?.[0]).toMatch(/No pair of products appeared together/);
  });
});
