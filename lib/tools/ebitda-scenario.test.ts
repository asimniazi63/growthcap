import { and, eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setTestNow } from "../clock";
import type { Db } from "../db/client";
import { costAssumptions, operatingCosts, orders } from "../db/schema";
import { createTestDb } from "../db/test-db";
import { seedTwoStores } from "../../scripts/fixtures/load-db";
import { loadCostAssumptions, loadCosts, parseCosts } from "../../scripts/fixtures/load-costs";
import { loadAdSpend, readFixtureFile } from "../../scripts/fixtures/load-pace";
import type { StoreKey, Truth } from "../../scripts/seed/types.js";
import { ledgerFromToolResults } from "../agent/checker";
import { SYSTEM_PROMPT } from "../agent/prompt";
import { TOOL_DEFS } from "../agent/tools";
import { loadEbitdaMonths, scenarioBaseOf } from "../ebitda/actuals";
import { DEFAULT_PRICE_ELASTICITY, runScenario, volumeChangeForTarget } from "../metrics/ebitda";
import type { TenantContext } from "../tenancy/context";
import { getEbitda } from "./ebitda";
import { getEbitdaScenario, getEbitdaScenarioTool } from "./ebitda-scenario";

let db: Db;
let ctx: TenantContext;
let tCtx: TenantContext;
let truth: Truth;

beforeAll(async () => {
  setTestNow("2026-11-02T12:00:00-05:00");
  db = await createTestDb();
  const seeded = await seedTwoStores(db);
  ctx = seeded.ctxs.solenne;
  tCtx = seeded.ctxs.tidepool;
  truth = seeded.fixtures.solenne.truth;
  for (const store of ["solenne", "tidepool"] as const) {
    const { tenantId } = seeded.ctxs[store];
    await loadAdSpend(db, tenantId, readFixtureFile(store, "ad-spend.csv"));
    await loadCosts(db, tenantId, readFixtureFile(store, "costs.csv"));
    await loadCostAssumptions(db, tenantId, readFixtureFile(store, "cost-assumptions.csv"));
  }
}, 240_000);

afterAll(() => setTestNow(null));

// One test deletes a cost-sheet row; each test starts from the files as they were loaded.
let restore: () => Promise<void>;
beforeEach(async () => {
  const costs = await db.select().from(operatingCosts).where(eq(operatingCosts.tenantId, ctx.tenantId));
  const rates = await db.select().from(costAssumptions).where(eq(costAssumptions.tenantId, ctx.tenantId));
  restore = async () => {
    await db.delete(operatingCosts).where(eq(operatingCosts.tenantId, ctx.tenantId));
    await db.delete(costAssumptions).where(eq(costAssumptions.tenantId, ctx.tenantId));
    if (costs.length > 0) await db.insert(operatingCosts).values(costs);
    if (rates.length > 0) await db.insert(costAssumptions).values(rates);
  };
});
afterEach(() => restore());

const run = (input: Record<string, unknown>, c: TenantContext = ctx) => getEbitdaScenario(c, input as never, { db });
const AUG_TO_OCT = ["2026-08", "2026-09", "2026-10"];
const LEVERS = ["priceChange", "adSpendChange", "unitCostChange", "volumeChange", "operatingCostChange"];

// Every number anywhere in a value, so a test can say none of them is NaN or infinite.
function numbersOf(node: unknown): number[] {
  if (typeof node === "number") return [node];
  if (Array.isArray(node)) return node.flatMap(numbersOf);
  if (node && typeof node === "object") return Object.values(node).flatMap(numbersOf);
  return [];
}

describe("the baseline", () => {
  it("with no levers the delta is 0 and the scenario equals the baseline", async () => {
    const res = await run({});
    expect(res.data.baselineMonths).toEqual(AUG_TO_OCT);
    expect(res.data.baselineMonthCount).toBe(3);
    expect(res.data.deltaEbitdaCents).toBe(0);
    expect(res.data.scenario).toEqual(res.data.baseline);
    expect(res.data.scenarioEbitdaPerMonthCents).toBe(res.data.baselineEbitdaPerMonthCents);
    expect(res.data.deltaEbitdaPerMonthCents).toBe(0);
    expect(res.data.impacts).toEqual([]);
    expect(res.data.target).toBeNull();
    expect(res.data).toMatchObject({ elasticity: -1.5, elasticityIsDefault: true, baselineIsCeiling: false });
    for (const key of LEVERS) expect(res.data, key).not.toHaveProperty(key);
    expect(res.range).toEqual({ from: "2026-08-01", to: "2026-10-31" });
    expect(res.queryId).toMatch(/^q_[0-9a-f]{12}$/);
    expect(res.asOf).toEqual(expect.any(String));
    expect(await run({})).toEqual(res);
  });

  it("the baseline is the sum of the last 3 complete months of get_ebitda", async () => {
    const res = await run({});
    const ebitda = await getEbitda(ctx, { from: "2026-08-01", to: "2026-10-31" }, { db });
    const t = ebitda.data.total;
    const b = res.data.baseline;
    expect(ebitda.data.months.map((m) => m.month)).toEqual(res.data.baselineMonths);
    expect(ebitda.data.months.every((m) => !m.partial)).toBe(true);
    // The lines that are sums of whole cents match exactly.
    expect(b).toMatchObject({
      netSalesCents: t.netSalesCents,
      costOfGoodsCents: t.costOfGoodsCents,
      fulfilmentCents: t.fulfilmentCents,
      adSpendCents: t.adSpendCents,
      operatingCostsCents: t.operatingCostsCents,
      orders: t.orders,
    });
    // Card fees are a rate: rounded once here and once a month there, so they can differ by a cent a month, and EBITDA with them.
    expect(Math.abs(b.cardFeesCents - t.cardFeesCents)).toBeLessThanOrEqual(3);
    expect(Math.abs(b.ebitdaCents - t.ebitdaCents)).toBeLessThanOrEqual(3);
    expect(b.ebitdaCents).toBe(b.profitAfterVariableCostsCents - b.operatingCostsCents);
    // And the figures agree with the dataset's own monthly truth.
    expect(b.netSalesCents).toBe(AUG_TO_OCT.reduce((s, m) => s + truth.monthly[m]!.net_sales, 0));
    expect(b.orders).toBe(AUG_TO_OCT.reduce((s, m) => s + truth.monthly[m]!.orders, 0));
    // Per month is the total over the months, to the cent.
    expect(res.data.baselineEbitdaPerMonthCents).toBe(Math.round(b.ebitdaCents / 3));
  });

  it("takes the last N complete months, and only as many as the data has", async () => {
    expect((await run({ months: 1 })).data.baselineMonths).toEqual(["2026-10"]);
    const year = await run({ months: 12 });
    expect(year.data.baselineMonths).toHaveLength(12);
    expect(year.data.baselineMonths[0]).toBe("2025-11");
    expect(year.data.baselineMonths.at(-1)).toBe("2026-10");
    expect(year.data.baselineMonthCount).toBe(12);
    // Tidepool's orders start on 2025-11-01 and stop on 2026-10-26, so October is not a complete month for it.
    const tide = await run({ months: 12 }, tCtx);
    expect(tide.data.baselineMonths).toHaveLength(11);
    expect(tide.data.baselineMonths[0]).toBe("2025-11");
    expect(tide.data.baselineMonths.at(-1)).toBe("2026-09");
    expect(tide.range).toEqual({ from: "2025-11-01", to: "2026-09-30" });
    expect((await run({}, tCtx)).data.baselineMonths).toEqual(["2026-07", "2026-08", "2026-09"]);
  });

  it("uses no month the clock or the data has not reached the end of, and says NO_DATA when no month is complete", async () => {
    try {
      // The clock is in October 2025, so September 2025 is the only month that is over, however much data lies after it.
      setTestNow("2025-10-02T12:00:00-04:00");
      const early = await run({});
      expect(early.data.baselineMonths).toEqual(["2025-09"]);
      expect(early.data.baselineMonthCount).toBe(1);
      setTestNow("2025-09-15T12:00:00-04:00");
      await expect(run({})).rejects.toMatchObject({ code: "NO_DATA" });
      // A month counts as complete once the clock and the data have both reached its last day, which is when get_ebitda stops flagging it partial.
      setTestNow("2026-10-31T23:00:00-04:00");
      expect((await run({})).data.baselineMonths).toEqual(AUG_TO_OCT);
      setTestNow("2026-10-30T12:00:00-04:00");
      expect((await run({})).data.baselineMonths).toEqual(["2026-07", "2026-08", "2026-09"]);
    } finally {
      setTestNow("2026-11-02T12:00:00-05:00");
    }
  });

  it("a baseline month with no operating costs entered makes the baseline a ceiling", async () => {
    await db.delete(operatingCosts).where(and(eq(operatingCosts.tenantId, ctx.tenantId), eq(operatingCosts.month, "2026-09")));
    const res = await run({ adSpendChange: -0.2 });
    expect(res.data.baselineIsCeiling).toBe(true);
    expect(res.definitions.ceiling).toMatch(/ceiling/i);
    expect(res.data.baseline.operatingCostsCents).toBeGreaterThan(0); // the other two months' costs are still in it
  });
});

describe("the levers", () => {
  it("ads -20% cuts ad spend by a fifth and orders by 20% of the new-customer orders", async () => {
    const res = await run({ adSpendChange: -0.2 });
    const { baseline: b, scenario: s } = res.data;
    const newCustomerOrders = AUG_TO_OCT.reduce((sum, m) => sum + truth.monthly[m]!.new_customer_orders, 0);
    expect(newCustomerOrders).toBeGreaterThan(0);
    expect(s.adSpendCents).toBe(Math.round(0.8 * b.adSpendCents));
    expect(s.orders).toBe(Math.round(b.orders - 0.2 * newCustomerOrders));
    expect(s.orders).toBeLessThan(b.orders);
    expect(s.netSalesCents).toBeLessThan(b.netSalesCents);
    expect(s.operatingCostsCents).toBe(b.operatingCostsCents);
    expect(res.data.adSpendChange).toBe(-0.2);
    expect(res.data.deltaEbitdaCents).toBe(s.ebitdaCents - b.ebitdaCents);
    expect(res.data.scenarioEbitdaPerMonthCents).toBe(Math.round(s.ebitdaCents / 3));
    // The change a month is the difference of the two figures a month, so an answer that quotes all three adds up; and it is the total change over three, give or take a cent.
    expect(res.data.deltaEbitdaPerMonthCents).toBe(res.data.scenarioEbitdaPerMonthCents - res.data.baselineEbitdaPerMonthCents);
    expect(Math.abs(res.data.deltaEbitdaPerMonthCents - res.data.deltaEbitdaCents / 3)).toBeLessThanOrEqual(1);
    // One lever, so its impact on its own is the whole change.
    expect(res.data.impacts).toEqual([{ lever: "adSpendChange", deltaEbitdaCents: res.data.deltaEbitdaCents }]);
  });

  it("echoes the levers that were given, and only those", async () => {
    const res = await run({ priceChange: 0.05, unitCostChange: 0.1, volumeChange: 0, operatingCostChange: -0.1 });
    expect(res.data).toMatchObject({ priceChange: 0.05, unitCostChange: 0.1, volumeChange: 0, operatingCostChange: -0.1 });
    expect(res.data).not.toHaveProperty("adSpendChange");
    expect(res.data.impacts.map((i) => i.lever)).toEqual(["priceChange", "unitCostChange", "volumeChange", "operatingCostChange"]);
    expect(res.data.impacts.find((i) => i.lever === "volumeChange")!.deltaEbitdaCents).toBe(0); // set to 0, so it does nothing
    expect(res.data.scenario.operatingCostsCents).toBe(Math.round(0.9 * res.data.baseline.operatingCostsCents));
  });

  it("elasticityIsDefault is true when omitted and false when given", async () => {
    const omitted = await run({ priceChange: 0.05 });
    expect(omitted.data).toMatchObject({ elasticity: DEFAULT_PRICE_ELASTICITY, elasticityIsDefault: true, priceChange: 0.05 });
    const steeper = await run({ priceChange: 0.05, elasticity: -2 });
    expect(steeper.data).toMatchObject({ elasticity: -2, elasticityIsDefault: false });
    expect(steeper.data.scenario.orders).toBeLessThan(omitted.data.scenario.orders); // a 5% rise loses 10% of orders, not 7.5%
    // Given counts as given, even when it equals the default; and the figures are the same either way.
    const same = await run({ priceChange: 0.05, elasticity: -1.5 });
    expect(same.data.elasticityIsDefault).toBe(false);
    expect(same.data.scenario).toEqual(omitted.data.scenario);
    // An elasticity of 0 means price does not move orders.
    const flat = await run({ priceChange: 0.05, elasticity: 0 });
    expect(flat.data.scenario.orders).toBe(flat.data.baseline.orders);
  });

  it("extreme levers give finite figures and never a negative order count", async () => {
    const extremes: Record<string, unknown>[] = [
      { adSpendChange: -1 },
      { adSpendChange: 2, unitCostChange: 1, operatingCostChange: 2, volumeChange: 3 },
      { priceChange: -0.5, elasticity: -5, volumeChange: 3 },
      { priceChange: 1, elasticity: -5 }, // the orders factor would be negative: it stops at no orders
      { volumeChange: -1, targetEbitdaPerMonthCents: 0 },
      { unitCostChange: -0.5, operatingCostChange: -1, targetEbitdaPerMonthCents: -1_000_000_000 },
    ];
    for (const input of extremes) {
      const res = await run(input);
      for (const n of numbersOf(res.data)) expect(Number.isFinite(n), JSON.stringify(input)).toBe(true);
      expect(res.data.scenario.orders, JSON.stringify(input)).toBeGreaterThanOrEqual(0);
      expect(res.data.scenario.netSalesCents, JSON.stringify(input)).toBeGreaterThanOrEqual(0);
    }
  });

  it("an all-new-customer baseline with adSpendChange -1 stays finite", async () => {
    // Make every one of Tidepool's orders its own customer's first, then put the customers back.
    const saved = await db.select({ id: orders.id, customerId: orders.customerId }).from(orders).where(eq(orders.tenantId, tCtx.tenantId));
    try {
      await db.update(orders).set({ customerId: sql`${orders.id}` }).where(eq(orders.tenantId, tCtx.tenantId));
      const ebitda = await getEbitda(tCtx, { from: "2026-07-01", to: "2026-09-30" }, { db });
      expect(ebitda.data.months.every((m) => m.orders > 0 && m.newCustomerOrders === m.orders)).toBe(true);

      const res = await run({ adSpendChange: -1, targetEbitdaPerMonthCents: 0 }, tCtx);
      const { baseline: b, scenario: s } = res.data;
      for (const n of numbersOf(res.data)) expect(Number.isFinite(n)).toBe(true);
      expect(b.orders).toBeGreaterThan(0);
      // Every order was won with ads, so with none there are no orders: no sales, no costs that follow orders, no ads.
      expect(s).toMatchObject({ orders: 0, netSalesCents: 0, costOfGoodsCents: 0, cardFeesCents: 0, fulfilmentCents: 0, adSpendCents: 0, ebitdaRate: null });
      expect(s.ebitdaCents).toBe(-b.operatingCostsCents);
      // With no orders left there is nothing for a volume change to scale, so no target can be reached that way.
      expect(res.data.target).toBeNull();
    } finally {
      for (const o of saved) await db.update(orders).set({ customerId: o.customerId }).where(and(eq(orders.tenantId, tCtx.tenantId), eq(orders.id, o.id)));
    }
  });
});

// The /ebitda page's what-if (app/(app)/ebitda/page.tsx and components/ebitda/scenario-panel.tsx) is built from the same engine, so what
// it shows for a set of levers and what the agent says must be the same to the cent. These are the page's steps done again here.
describe("the /ebitda page's what-if", () => {
  it("starts from the same months as the page: the last 3 complete months of get_ebitda's default range", async () => {
    try {
      for (const clock of ["2026-11-02T12:00:00-05:00", "2026-10-31T23:00:00-04:00", "2026-10-30T12:00:00-04:00"]) {
        setTestNow(clock);
        for (const c of [ctx, tCtx]) {
          const page = (await getEbitda(c, {}, { db })).data.months.filter((m) => !m.partial).slice(-3).map((m) => m.month);
          expect((await run({}, c)).data.baselineMonths, `${clock} ${c.orgId}`).toEqual(page);
        }
      }
    } finally {
      setTestNow("2026-11-02T12:00:00-05:00");
    }
  });

  it("rounds a month's worth the way the panel does, and solves the target the way it does", async () => {
    // The panel adds the months (scenarioBaseOf), runs the engine, shows a month's worth as Math.round(total / months) + 0, and
    // multiplies the target by the months before solving it. A month's change is the difference of the two rounded months.
    const levers = { priceChange: 0.05, adSpendChange: -0.2, volumeChange: 0.1, elasticity: -2 };
    const targetPerMonth = 120_000;
    let solved = 0;
    for (const c of [ctx, tCtx]) {
      for (const months of [1, 2, 3, 4, 5, 7, 12]) {
        const label = `${c.orgId}, months ${months}`;
        const tool = await run({ months, ...levers, targetEbitdaPerMonthCents: targetPerMonth }, c);
        const loaded = await loadEbitdaMonths(c, tool.range, { db });
        const n = loaded.months.length;
        const each = (cents: number) => Math.round(cents / n) + 0;
        const base = scenarioBaseOf(loaded.months);
        const panel = runScenario(base, loaded.assumptions, levers);
        expect(tool.data.baselineMonthCount, label).toBe(n);
        expect(tool.data.baseline, label).toEqual(panel.baseline);
        expect(tool.data.scenario, label).toEqual(panel.scenario);
        expect(tool.data.baselineEbitdaPerMonthCents, label).toBe(each(panel.baseline.ebitdaCents));
        expect(tool.data.scenarioEbitdaPerMonthCents, label).toBe(each(panel.scenario.ebitdaCents));
        expect(tool.data.deltaEbitdaPerMonthCents, label).toBe(each(panel.scenario.ebitdaCents) - each(panel.baseline.ebitdaCents));
        const found = volumeChangeForTarget(base, loaded.assumptions, levers, targetPerMonth * n);
        if (found === null) {
          expect(tool.data.target, label).toBeNull();
          continue;
        }
        solved += 1;
        expect(tool.data.target, label).toEqual({
          targetEbitdaPerMonthCents: targetPerMonth,
          volumeChange: found.volumeChange,
          ordersNeededPerMonth: each(found.ordersNeeded),
          baselineOrdersPerMonth: each(base.orders),
        });
      }
    }
    expect(solved).toBeGreaterThan(0);
  });
});

describe("the target", () => {
  it("a target round-trips", async () => {
    const res = await run({ targetEbitdaPerMonthCents: 0 }, tCtx);
    const target = res.data.target!;
    expect(res.data.baselineEbitdaPerMonthCents).toBeLessThan(0); // Tidepool never breaks even
    expect(target).not.toBeNull();
    expect(target.targetEbitdaPerMonthCents).toBe(0);
    expect(target.baselineOrdersPerMonth).toBe(Math.round(res.data.baseline.orders / 3));
    expect(target.ordersNeededPerMonth).toBeGreaterThan(target.baselineOrdersPerMonth);
    expect(target.volumeChange).toBeGreaterThan(0);
    // Asking for a target changes nothing about the scenario, which has no levers.
    expect(res.data.deltaEbitdaCents).toBe(0);
    // Feed the volume change back as a lever and the scenario lands on the target.
    const back = await run({ volumeChange: target.volumeChange }, tCtx);
    expect(Math.abs(back.data.scenarioEbitdaPerMonthCents)).toBeLessThanOrEqual(200);
    expect(back.data.scenario.orders / 3).toBeCloseTo(target.ordersNeededPerMonth, 0);
  });

  it("the volume change comes on top of the other levers", async () => {
    const res = await run({ adSpendChange: -0.3, priceChange: 0.05, targetEbitdaPerMonthCents: 0 }, tCtx);
    const target = res.data.target!;
    expect(target).not.toBeNull();
    const back = await run({ adSpendChange: -0.3, priceChange: 0.05, volumeChange: target.volumeChange }, tCtx);
    expect(Math.abs(back.data.scenarioEbitdaPerMonthCents)).toBeLessThanOrEqual(200);
    // A volume change that was also given is not part of the solve: it is what the target solves for.
    const given = await run({ adSpendChange: -0.3, priceChange: 0.05, volumeChange: 0.5, targetEbitdaPerMonthCents: 0 }, tCtx);
    expect(given.data.target).toEqual(target);
    expect(given.data.volumeChange).toBe(0.5);
  });

  it("takes the target in cents a month, so a target that is not 0 round-trips too, and is null when none was asked for", async () => {
    const asked = await run({ targetEbitdaPerMonthCents: 250_000 });
    const target = asked.data.target!;
    expect(target).toMatchObject({ targetEbitdaPerMonthCents: 250_000 });
    expect(target.ordersNeededPerMonth).toBeGreaterThan(target.baselineOrdersPerMonth); // $2,500 a month is more than the brand makes now
    // 250,000 is one month's worth, not the three months together: fed back as a volume change, a month lands on it.
    const back = await run({ volumeChange: target.volumeChange });
    expect(Math.abs(back.data.scenarioEbitdaPerMonthCents - 250_000)).toBeLessThanOrEqual(200);
    expect((await run({ priceChange: 0.05 })).data.target).toBeNull();
    expect(asked.definitions.target).toMatch(/per month/i);
  });
});

describe("the input", () => {
  it("rejects elasticity 1, priceChange 2, months 13 and an unknown key such as tenantId", async () => {
    const bad: Record<string, unknown>[] = [
      { elasticity: 1 },
      { elasticity: -6 },
      { priceChange: 2 },
      { priceChange: -0.6 },
      { adSpendChange: -1.5 },
      { adSpendChange: 3 },
      { unitCostChange: 2 },
      { volumeChange: 4 },
      { volumeChange: -1.1 },
      { operatingCostChange: -2 },
      { months: 13 },
      { months: 0 },
      { months: 1.5 },
      { targetEbitdaPerMonthCents: 1.5 },
      { priceChange: "5%" },
      { priceChange: Number.NaN },
      { volumeChange: Number.POSITIVE_INFINITY },
    ];
    for (const input of bad) await expect(run(input), JSON.stringify(input)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    for (const key of ["tenantId", "shopDomain", "orgId", "shop", "operatingCosts"]) await expect(run({ [key]: "other" }), key).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("refuses a store that is not connected", async () => {
    await expect(run({}, { ...ctx, shop: { ...ctx.shop!, status: "disconnected" } })).rejects.toMatchObject({ code: "STORE_DISCONNECTED" });
    await expect(run({}, { ...ctx, shop: null })).rejects.toMatchObject({ code: "STORE_DISCONNECTED" });
  });

  it("each brand gets its own baseline", async () => {
    const mine = await run({ adSpendChange: -0.2 });
    const theirs = await run({ adSpendChange: -0.2 }, tCtx);
    expect(theirs.data.baseline.netSalesCents).not.toBe(mine.data.baseline.netSalesCents);
    expect(theirs.data.baseline.adSpendCents).not.toBe(mine.data.baseline.adSpendCents);
    // Each baseline carries its own brand's cost sheet, for its own months, as the checked-in files give it.
    const sheet = (store: StoreKey, months: string[]) =>
      parseCosts(readFixtureFile(store, "costs.csv"))
        .filter((r) => months.includes(r.month))
        .reduce((sum, r) => sum + r.amountCents, 0);
    expect(mine.data.baseline.operatingCostsCents).toBe(sheet("solenne", mine.data.baselineMonths));
    expect(theirs.data.baseline.operatingCostsCents).toBe(sheet("tidepool", theirs.data.baselineMonths));
    expect(theirs.data.baseline.operatingCostsCents).not.toBe(mine.data.baseline.operatingCostsCents);
  });
});

describe("what the model is told", () => {
  it("the definitions state the ad-spend rule, the elasticity and the per-month units in plain words", async () => {
    const res = await run({ targetEbitdaPerMonthCents: 0 });
    expect(Object.keys(res.definitions)).toEqual(expect.arrayContaining(["baseline", "levers", "adSpendRule", "elasticity", "impacts", "ceiling", "target"]));
    expect(res.definitions.adSpendRule).toMatch(/new-customer orders/i);
    expect(res.definitions.adSpendRule).toMatch(/assumption/i);
    expect(res.definitions.elasticity).toMatch(/assumption/i);
    expect(res.definitions.elasticity).toMatch(/percentage change in orders/i);
    expect(res.definitions.target).toMatch(/per month/i);
    expect(res.definitions.baseline).toMatch(/complete months/i);
    // A figure in a definition is not a tool result, so an answer that quoted one would fail the number check: there are none.
    for (const [key, text] of Object.entries(res.definitions)) expect(text, `definitions.${key}`).not.toMatch(/\d/);
  });

  it("the tool description says to quote the figures, to call the two rules assumptions, and that a ceiling carries over", () => {
    const d = getEbitdaScenarioTool.description;
    expect(d).toMatch(/as written/i);
    expect(d).toMatch(/assumptions/i);
    expect(d).toMatch(/new-customer/i);
    expect(d).toMatch(/baselineIsCeiling/);
    expect(d).toMatch(/ceiling/i);
    expect(d).toMatch(/never work out/i);
  });

  it("is registered as get_ebitda_scenario, after get_ebitda, with its prompt bullet", () => {
    const names = Object.keys(TOOL_DEFS);
    expect(names).toContain("get_ebitda_scenario");
    expect(names.indexOf("get_ebitda_scenario")).toBe(names.indexOf("get_ebitda") + 1);
    expect(TOOL_DEFS.get_ebitda_scenario).toMatchObject({ description: getEbitdaScenarioTool.description });
    expect(SYSTEM_PROMPT).toContain(
      "- For what-if questions about profit (ads, price, product cost, volume, operating costs), use get_ebitda_scenario. Pass changes as fractions (a 20% cut is -0.2). Say that the price elasticity and the rule that fewer ads lose new-customer orders at today's CAC are assumptions, not data. If elasticityIsDefault is true, say the default was used. Never work out a scenario yourself.",
    );
    // The bullet sits right after the get_ebitda one.
    const lines = SYSTEM_PROMPT.split("\n");
    const ebitdaLine = lines.findIndex((l) => l.startsWith("- For EBITDA (profit after operating costs), use get_ebitda."));
    expect(ebitdaLine).toBeGreaterThan(-1);
    expect(lines[ebitdaLine + 1]).toMatch(/^- For what-if questions about profit/);
  });
});

describe("the number checker", () => {
  it("the checker reads the lever echoes as rates and the cents as money", async () => {
    const res = await run({ priceChange: 0.05, adSpendChange: -0.2, targetEbitdaPerMonthCents: 250_000 });
    const entries = ledgerFromToolResults([res]).entries;
    const at = (path: string) => entries.find((e) => e.path === path)!;
    // The plan's own example: priceChange 0.05 is a rate worth 5.
    expect(at("data.priceChange")).toMatchObject({ unit: "rate" });
    expect(at("data.priceChange").value).toBeCloseTo(5, 9);
    expect(at("data.adSpendChange")).toMatchObject({ unit: "rate" });
    expect(at("data.adSpendChange").value).toBeCloseTo(-20, 9);
    expect(at("data.target.volumeChange")).toMatchObject({ unit: "rate" });
    expect(at("data.target.volumeChange").value).toBeCloseTo(res.data.target!.volumeChange * 100, 9);
    expect(at("data.deltaEbitdaCents")).toMatchObject({ unit: "money", value: res.data.deltaEbitdaCents / 100 });
    expect(at("data.baselineEbitdaPerMonthCents")).toMatchObject({ unit: "money", value: res.data.baselineEbitdaPerMonthCents / 100 });
    expect(at("data.deltaEbitdaPerMonthCents")).toMatchObject({ unit: "money", value: res.data.deltaEbitdaPerMonthCents / 100 });
    expect(at("data.target.targetEbitdaPerMonthCents")).toMatchObject({ unit: "money", value: 2500 });
    expect(at("data.impacts[0].deltaEbitdaCents")).toMatchObject({ unit: "money" });
    expect(at("data.baseline.ebitdaRate")).toMatchObject({ unit: "rate" });
    expect(at("data.baseline.orders")).toMatchObject({ unit: "count", value: res.data.baseline.orders });
    expect(at("data.target.ordersNeededPerMonth")).toMatchObject({ unit: "count" });
    expect(at("data.baselineMonthCount")).toMatchObject({ unit: "count", value: 3 });
    expect(at("data.elasticity")).toMatchObject({ unit: "count", value: -1.5 });
  });
});
