import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Db } from "../db/client";
import { tenants } from "../db/schema";
import { createTestDb } from "../db/test-db";
import { queryMetric, queryMetricInputSchema } from "../metrics/query";
import type { TenantContext } from "../tenancy/context";
import { getCohortsInputSchema } from "../tools/cohorts";
import { getPromoPostmortemInputSchema } from "../tools/promo-postmortem";
import { VIEW_COMPONENTS } from "../views/types";
import { loadDataset, readFixture } from "../../scripts/fixtures/load-db";
import { loadPlan as loadPlanFixture, readFixtureFile } from "../../scripts/fixtures/load-pace";
import { STORES } from "../../scripts/seed/stores.js";
import { PLAYBOOK_IDS, type PlaybookId, type PlaybookParams } from "./definitions";
import { loadNumbers, numbersRecipes, type NumbersRun } from "./numbers";

// The live numbers above a playbook's write-up (layer B of the Playbooks page): for each playbook, the views (the same ones the chat can
// draw) that show the figures its write-up is about, read from the synced data when the page opens. A recipe is a view component and
// the tool inputs behind it, never a number: the numbers come from the tools, as in a pinned view.

const NY = "America/New_York";
const run = (playbook: PlaybookId, createdAt = "2026-11-03T15:30:00Z", params: PlaybookParams = {}): NumbersRun => ({ playbook, createdAt: new Date(createdAt), params });
const recipes = (playbook: PlaybookId, createdAt?: string, params?: PlaybookParams, tz = NY) => numbersRecipes(playbook, run(playbook, createdAt, params), tz);
const inputOf = (playbook: PlaybookId, key: string, createdAt?: string, params?: PlaybookParams, tz = NY) => {
  const r = recipes(playbook, createdAt, params, tz).find((x) => x.key === key);
  if (!r) throw new Error(`no recipe ${key} for ${playbook}`);
  return r.sources[0]!.input as Record<string, unknown>;
};

describe("numbersRecipes", () => {
  it("gives every playbook two views, each a legal component with inputs the tools' own strict schemas accept", () => {
    const schemas = { query_metric: queryMetricInputSchema, get_cohorts: getCohortsInputSchema, get_promo_postmortem: getPromoPostmortemInputSchema } as const;
    for (const playbook of PLAYBOOK_IDS) {
      for (const createdAt of ["2026-11-03T15:30:00Z", "2026-12-05T10:00:00Z", "2027-02-10T10:00:00Z"]) {
        const list = recipes(playbook, createdAt, playbook === "monthly-review" ? { month: "2026-10" } : {});
        expect(list.map((r) => r.key), playbook).toHaveLength(2);
        expect(new Set(list.map((r) => r.key)).size).toBe(2);
        for (const r of list) {
          expect(VIEW_COMPONENTS as readonly string[], `${playbook}/${r.key}`).toContain(r.component);
          expect(r.title.length).toBeGreaterThan(0);
          for (const s of r.sources) {
            const schema = schemas[s.tool as keyof typeof schemas];
            expect(schema, `${playbook}/${r.key}: ${s.tool}`).toBeDefined();
            expect(() => schema.parse(s.input), `${playbook}/${r.key}`).not.toThrow();
          }
        }
      }
    }
  });

  it("draws the Black Friday review for the weekend the review was about, with the change on the days before", () => {
    const weekend = inputOf("bfcm-review", "weekend");
    expect(weekend).toMatchObject({ from: "2025-11-28", to: "2025-12-01", compareTo: "previous_period" });
    expect(weekend.metrics).toEqual(["net_sales", "orders", "aov", "new_customer_orders", "discounted_order_share"]);
    expect(inputOf("bfcm-review", "weekend", "2026-12-05T10:00:00Z")).toMatchObject({ from: "2026-11-27", to: "2026-11-30" }); // this year's, once it is over
    const codes = inputOf("bfcm-review", "codes");
    expect(codes).toMatchObject({ from: "2025-11-28", to: "2025-12-01", groupBy: ["discount_code"] });
    expect((codes.metrics as string[])[0]).toBe("orders"); // a bar is drawn from the first metric
    expect(recipes("bfcm-review").map((r) => r.component)).toEqual(["kpi", "bar"]);
  });

  it("draws the Monthly business review for the month asked for, or for the month before the run in the store's own time zone", () => {
    expect(inputOf("monthly-review", "month", "2026-11-03T15:30:00Z", { month: "2026-10" })).toMatchObject({ from: "2026-10-01", to: "2026-10-31" });
    expect(inputOf("monthly-review", "month", "2026-11-03T15:30:00Z")).toMatchObject({ from: "2026-10-01", to: "2026-10-31" });
    // 03:00 UTC on November 1 is still October 31 in New York, so "last month" there is September.
    expect(inputOf("monthly-review", "month", "2026-11-01T03:00:00Z")).toMatchObject({ from: "2026-09-01", to: "2026-09-30" });
    expect(inputOf("monthly-review", "month", "2026-11-01T03:00:00Z", {}, "UTC")).toMatchObject({ from: "2026-10-01", to: "2026-10-31" });
    const month = inputOf("monthly-review", "month");
    expect(month.metrics).toEqual(["net_sales", "orders", "aov", "new_customer_orders", "refund_rate"]);
    expect(month.groupBy).toBeUndefined(); // ungrouped, so the net sales row carries the gap to plan
    expect(inputOf("monthly-review", "daily", "2026-11-03T15:30:00Z", { month: "2026-10" })).toMatchObject({ from: "2026-10-01", to: "2026-10-31", groupBy: ["day"], metrics: ["net_sales"] });
    expect(recipes("monthly-review").map((r) => r.component)).toEqual(["kpi", "line"]);
  });

  it("draws the Retention check as the cohort grid for the 60-day window and the returning-customer rate for the last 30 days", () => {
    expect(inputOf("retention-check", "cohorts")).toEqual({ windowDays: 60 });
    // The 30 days that end on the day of the run (in the store's time zone), as the write-up's own query did, so the figures match it.
    expect(inputOf("retention-check", "returning")).toEqual({ metrics: ["returning_customer_rate", "new_customer_orders"], from: "2026-10-05", to: "2026-11-03", compareTo: "previous_period" });
    expect(inputOf("retention-check", "returning", "2026-11-01T03:00:00Z")).toMatchObject({ from: "2026-10-02", to: "2026-10-31" }); // still October 31 in New York
    expect(recipes("retention-check").map((r) => r.component)).toEqual(["kpi", "cohort"]); // the open figures first, the fold after
  });

  it("draws the Creative briefs as last year's Black Friday weekend (the one a customer has had 180 days to come back from) and the best sellers", () => {
    const lift = inputOf("creative-briefs", "lastYear");
    expect(lift).toEqual({ from: "2025-11-28", to: "2025-12-01", repeatWindowDays: 180 });
    expect(inputOf("creative-briefs", "lastYear", "2026-12-05T10:00:00Z")).toMatchObject({ from: "2025-11-28", to: "2025-12-01" });
    expect(inputOf("creative-briefs", "lastYear", "2027-07-01T10:00:00Z")).toMatchObject({ from: "2026-11-27", to: "2026-11-30" });
    // The question's own query: the 90 days before the day of the run, the eight best sellers by units.
    expect(inputOf("creative-briefs", "bestSellers")).toEqual({ metrics: ["units", "net_sales"], from: "2026-08-05", to: "2026-11-02", groupBy: ["product"], limit: 8 });
    expect(recipes("creative-briefs").map((r) => r.component)).toEqual(["bar", "lift_dip"]);
  });

  it("folds the three big charts (the cohort grid, the daily line, the lift and dip) behind a Show row, and leaves the compact ones open", () => {
    const folds = Object.fromEntries(PLAYBOOK_IDS.flatMap((p) => recipes(p).map((r) => [`${p}/${r.key}`, r.fold])));
    expect(Object.entries(folds).filter(([, f]) => f !== null).map(([k]) => k).sort()).toEqual(["creative-briefs/lastYear", "monthly-review/daily", "retention-check/cohorts"]);
    for (const f of Object.values(folds).filter((x): x is string => x !== null)) expect(f).toMatch(/^Show /);
  });

  it("marks which views are wide: the grid, the line and the lift and dip take the full width; the weekend pair sits side by side", () => {
    expect(recipes("bfcm-review").map((r) => r.wide)).toEqual([false, false]);
    for (const playbook of ["retention-check", "monthly-review", "creative-briefs"] as const) expect(recipes(playbook).map((r) => r.wide), playbook).toEqual([true, true]);
  });
});

describe("loadNumbers: one view that cannot be drawn does not take the others with it", () => {
  const ctx: TenantContext = { tenantId: "t1", orgId: "org", userId: "u", role: "gc_partner", shop: { domain: "s.myshopify.com", timezone: NY, currency: "USD", status: "connected" } };

  it("returns every view in order, each drawn or failed, and never throws", async () => {
    const data = { component: "bar", metric: "orders", label: "Orders", unit: "count", dimension: "discount_code", bars: [], queryIds: ["q1"], range: { from: "2025-11-28", to: "2025-12-01" }, asOf: "2026-11-03T00:00:00.000Z" };
    const rebuild = vi.fn(async (_ctx: TenantContext, view: { component: string }) => {
      if (view.component === "kpi") throw new Error("no data in that range");
      return data;
    });
    const items = await loadNumbers(ctx, run("bfcm-review"), { rebuild: rebuild as never });
    expect(items.map((i) => i.key)).toEqual(["weekend", "codes"]);
    expect(items.map((i) => i.view.ok)).toEqual([false, true]);
    expect(items[1]!.view.ok && items[1]!.view.data).toBe(data);
    expect(items[0]!.title).toBe("The weekend in numbers");
    expect(items.map((i) => i.fold)).toEqual([null, null]);
    expect(rebuild).toHaveBeenCalledTimes(2);
    // each view is built for the signed-in brand
    expect(rebuild.mock.calls.every((c) => c[0] === ctx)).toBe(true);
  });

  it("returns a failed view, not an error, even when every view fails", async () => {
    const items = await loadNumbers(ctx, run("retention-check"), { rebuild: (async () => Promise.reject(new Error("db down"))) as never });
    expect(items.map((i) => i.view.ok)).toEqual([false, false]);
    expect(items.map((i) => i.fold)).toEqual([null, expect.stringMatching(/^Show /)]); // the fold is kept on a failed view too
  });
});

describe("loadNumbers: against real store data (the Solenne demo dataset)", () => {
  let db: Db;
  let ctx: TenantContext;

  beforeAll(async () => {
    db = await createTestDb();
    const [t] = await db.insert(tenants).values({ orgId: "org_sol", name: "Solenne" }).returning();
    await loadDataset(db, t!.id, "solenne", readFixture("solenne").dataset);
    await loadPlanFixture(db, t!.id, readFixtureFile("solenne", "plan.csv"), "Solenne plan");
    ctx = { tenantId: t!.id, orgId: "org_sol", userId: "user_a", role: "gc_partner", shop: { domain: "solenne.myshopify.com", timezone: STORES.solenne.timezone, currency: "USD", status: "connected" } };
  }, 300_000);

  const drawn = async (playbook: PlaybookId, params: PlaybookParams = {}) => (await loadNumbers(ctx, run(playbook, "2026-11-03T15:30:00Z", params), { db })).map((i) => ({ key: i.key, view: i.view }));

  it("draws last year's Black Friday weekend: the five figures with their change, and the orders by code, from the same query the agent runs", async () => {
    const [weekend, codes] = await drawn("bfcm-review");
    if (!weekend!.view.ok || !codes!.view.ok) throw new Error("expected both views to draw");
    const kpi = weekend!.view.data;
    if (kpi.component !== "kpi") throw new Error();
    const direct = await queryMetric(ctx, inputOf("bfcm-review", "weekend") as never, { db });
    expect(kpi.cards.map((c) => c.metric)).toEqual(["net_sales", "orders", "aov", "new_customer_orders", "discounted_order_share"]);
    expect(kpi.cards[0]!.value).toBe(direct.data[0]!.values.net_sales);
    expect(kpi.cards[0]!.value).toBeGreaterThan(0);
    expect(kpi.cards[0]!.pctChange).not.toBeUndefined();
    expect(kpi.range).toEqual({ from: "2025-11-28", to: "2025-12-01" });
    const bar = codes!.view.data;
    if (bar.component !== "bar") throw new Error();
    expect(bar.bars.map((b) => b.label)).toContain("BFCM25");
  });

  it("draws the Retention check: the cohort grid and the returning-customer figures", async () => {
    const [returning, cohorts] = await drawn("retention-check");
    if (!cohorts!.view.ok || !returning!.view.ok) throw new Error("expected both views to draw");
    expect(cohorts!.view.data.component).toBe("cohort");
    const kpi = returning!.view.data;
    if (kpi.component !== "kpi") throw new Error();
    expect(kpi.cards.map((c) => c.metric)).toEqual(["returning_customer_rate", "new_customer_orders"]);
  });

  it("draws the Monthly business review: the month's figures with its gap to plan, and net sales by day", async () => {
    const [month, daily] = await drawn("monthly-review", { month: "2026-10" });
    if (!month!.view.ok || !daily!.view.ok) throw new Error("expected both views to draw");
    const kpi = month!.view.data;
    if (kpi.component !== "kpi") throw new Error();
    expect(kpi.cards.map((c) => c.metric)).toEqual(["net_sales", "orders", "aov", "new_customer_orders", "refund_rate"]);
    expect(kpi.cards[0]!.plan).toBeDefined(); // October has a net sales target
    const line = daily!.view.data;
    if (line.component !== "line") throw new Error();
    expect(line.points.length).toBeGreaterThan(20);
  });

  it("draws the Creative briefs: last year's weekend as lift and dip, and the best sellers", async () => {
    const [best, lastYear] = await drawn("creative-briefs");
    if (!lastYear!.view.ok || !best!.view.ok) throw new Error("expected both views to draw");
    expect(lastYear!.view.data.component).toBe("lift_dip");
    const bar = best!.view.data;
    if (bar.component !== "bar") throw new Error();
    expect(bar.bars.length).toBeGreaterThan(0);
    expect(bar.bars.length).toBeLessThanOrEqual(8);
  });

  it("returns a failed view, with no error, for a period the store has no data for", async () => {
    const items = await loadNumbers(ctx, run("monthly-review", "2026-11-03T15:30:00Z", { month: "2019-01" }), { db });
    expect(items.map((i) => i.view.ok)).toEqual([false, false]);
  });
});
