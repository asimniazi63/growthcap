import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setTestNow } from "../clock";
import type { Db } from "../db/client";
import { costAssumptions, operatingCosts, variants } from "../db/schema";
import { createTestDb } from "../db/test-db";
import { seedTwoStores } from "../../scripts/fixtures/load-db";
import { loadCostAssumptions, loadCosts, parseCosts } from "../../scripts/fixtures/load-costs";
import { loadAdSpend, parseAdSpend, readFixtureFile } from "../../scripts/fixtures/load-pace";
import { metricValue } from "../../scripts/seed/truth.js";
import type { Dataset, StoreKey, Truth } from "../../scripts/seed/types.js";
import { checkClaims, ledgerFromToolResults } from "../agent/checker";
import { scenarioBaseOf } from "../ebitda/actuals";
import { deleteCostCell, upsertAssumptions, upsertCostCell } from "../ebitda/store";
import { prorate } from "../metrics/ebitda";
import type { TenantContext } from "../tenancy/context";
import { getEbitda } from "./ebitda";
import { getUnitEconomics } from "./unit-economics";

let db: Db;
let ctx: TenantContext;
let tCtx: TenantContext;
let ds: Dataset;
let truth: Truth;

beforeAll(async () => {
  setTestNow("2026-11-02T12:00:00-05:00");
  db = await createTestDb();
  const seeded = await seedTwoStores(db);
  ctx = seeded.ctxs.solenne;
  tCtx = seeded.ctxs.tidepool;
  ds = seeded.fixtures.solenne.dataset;
  truth = seeded.fixtures.solenne.truth;
  for (const store of ["solenne", "tidepool"] as const) {
    const { tenantId } = seeded.ctxs[store];
    await loadAdSpend(db, tenantId, readFixtureFile(store, "ad-spend.csv"));
    await loadCosts(db, tenantId, readFixtureFile(store, "costs.csv"));
    await loadCostAssumptions(db, tenantId, readFixtureFile(store, "cost-assumptions.csv"));
  }
}, 240_000);

afterAll(() => setTestNow(null));

// Some tests change Solenne's cost sheet or rates; each one starts from the files as they were loaded.
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

const run = (input: Record<string, unknown>, c: TenantContext = ctx) => getEbitda(c, input as never, { db });
const WINDOW = { from: "2025-09-01", to: "2026-10-31" };

// What the files say, read straight from the checked-in CSVs.
const costsIn = (store: StoreKey, month: string) => parseCosts(readFixtureFile(store, "costs.csv")).filter((r) => r.month === month);
const costSum = (store: StoreKey, month: string) => costsIn(store, month).reduce((s, r) => s + r.amountCents, 0);
const adSum = (store: StoreKey, from: string, to: string) => parseAdSpend(readFixtureFile(store, "ad-spend.csv")).filter((r) => r.date >= from && r.date <= to).reduce((s, r) => s + r.spendCents, 0);

describe("Solenne's months", () => {
  it("2026-08 matches its sources", async () => {
    const res = await run({ from: "2026-08-01", to: "2026-08-31" });
    expect(res.data.months.map((m) => m.month)).toEqual(["2026-08"]);
    const m = res.data.months[0]!;
    const want = truth.monthly["2026-08"]!;
    expect(m.netSalesCents).toBe(want.net_sales);
    expect(m.orders).toBe(want.orders);
    expect(m.newCustomerOrders).toBe(want.new_customer_orders);
    expect(m.adSpendCents).toBe(adSum("solenne", "2026-08-01", "2026-08-31"));
    expect(m.adSpendCents).toBeGreaterThan(0);
    expect(m.operatingCostsCents).toBe(costSum("solenne", "2026-08"));
    expect(m.operatingCostsCents).toBeGreaterThan(0);
    expect(m.operatingCosts.reduce((s, c) => s + c.amountCents, 0)).toBe(m.operatingCostsCents);
    expect(m).toMatchObject({ partial: false, operatingCostsEntered: true });
    // Cost of goods is the same figure unit economics gives for the month: today's unit cost times units kept.
    const ue = await getUnitEconomics(ctx, { from: "2026-08-01", to: "2026-08-31", payback: false }, { db });
    expect(m.costOfGoodsCents).toBe(ue.data.months[0]!.costOfGoodsCents);
    expect(m.costOfGoodsCents).toBeGreaterThan(0);
    expect(m.unitsWithoutCost).toBe(ue.data.months[0]!.unitsWithoutCost);
  });

  it("every month's bridge adds up, and the total is the sum of the months", async () => {
    const res = await run(WINDOW);
    expect(res.data.months).toHaveLength(14);
    for (const m of res.data.months) {
      expect(m.profitAfterVariableCostsCents, m.month).toBe(m.netSalesCents - m.costOfGoodsCents - m.cardFeesCents - m.fulfilmentCents - m.adSpendCents);
      expect(m.ebitdaCents, m.month).toBe(m.profitAfterVariableCostsCents - m.operatingCostsCents);
      expect(m.ebitdaRate, m.month).toBe(m.netSalesCents > 0 ? m.ebitdaCents / m.netSalesCents : null);
      expect(m.profitAfterVariableCostsRate, m.month).toBe(m.netSalesCents > 0 ? m.profitAfterVariableCostsCents / m.netSalesCents : null);
    }
    const t = res.data.total;
    const sum = (f: (m: (typeof res.data.months)[number]) => number) => res.data.months.reduce((s, m) => s + f(m), 0);
    expect(t.netSalesCents).toBe(sum((m) => m.netSalesCents));
    expect(t.cardFeesCents).toBe(sum((m) => m.cardFeesCents));
    expect(t.operatingCostsCents).toBe(sum((m) => m.operatingCostsCents));
    expect(t.ebitdaCents).toBe(sum((m) => m.ebitdaCents));
    expect(t.orders).toBe(sum((m) => m.orders));
    expect(t.profitAfterVariableCostsCents).toBe(t.netSalesCents - t.costOfGoodsCents - t.cardFeesCents - t.fulfilmentCents - t.adSpendCents);
    expect(t.ebitdaCents).toBe(t.profitAfterVariableCostsCents - t.operatingCostsCents);
    expect(t.ebitdaRate).toBeCloseTo(t.ebitdaCents / t.netSalesCents, 12);
  });

  it("card fees and fulfilment use the assumptions row", async () => {
    const range = { from: "2026-08-01", to: "2026-09-30" };
    const res = await run(range);
    for (const m of res.data.months) {
      expect(m.cardFeesCents, m.month).toBe(Math.round(0.029 * m.netSalesCents + 30 * m.orders));
      expect(m.fulfilmentCents, m.month).toBe(450 * m.orders);
    }
    expect(res.data).toMatchObject({ cardFeeRate: 0.029, cardFeeFixedCents: 30, fulfilmentCentsPerOrder: 450, assumptionsSource: "fixture" });

    // A person's rates replace them in the next answer.
    await upsertAssumptions(db, ctx.tenantId, "user_1", { cardFeeBps: 310, cardFeeFixedCents: 35, fulfilmentCentsPerOrder: 600 });
    const edited = await run(range);
    for (const m of edited.data.months) {
      expect(m.cardFeesCents, m.month).toBe(Math.round(0.031 * m.netSalesCents + 35 * m.orders));
      expect(m.fulfilmentCents, m.month).toBe(600 * m.orders);
    }
    expect(edited.data).toMatchObject({ cardFeeRate: 0.031, cardFeeFixedCents: 35, fulfilmentCentsPerOrder: 600, assumptionsSource: "manual" });
  });

  it("no assumptions row uses the defaults and says so", async () => {
    await db.delete(costAssumptions).where(eq(costAssumptions.tenantId, ctx.tenantId));
    const res = await run({ from: "2026-08-01", to: "2026-08-31" });
    expect(res.data).toMatchObject({ assumptionsSource: "default", cardFeeRate: 0.029, cardFeeFixedCents: 30, fulfilmentCentsPerOrder: 450 });
    const m = res.data.months[0]!;
    expect(m.cardFeesCents).toBe(Math.round(0.029 * m.netSalesCents + 30 * m.orders));
    expect(m.fulfilmentCents).toBe(450 * m.orders);
  });

  it("the sign mix is believable", async () => {
    const res = await run(WINDOW);
    const ebitda = res.data.months.map((m) => m.ebitdaCents);
    expect(ebitda.some((e) => e > 0), `Solenne: ${ebitda.join(", ")}`).toBe(true);
    expect(ebitda.some((e) => e < 0), `Solenne: ${ebitda.join(", ")}`).toBe(true);
    const tide = await run(WINDOW, tCtx);
    expect(tide.data.months.every((m) => m.ebitdaCents <= 0), `Tidepool: ${tide.data.months.map((m) => m.ebitdaCents).join(", ")}`).toBe(true);
  });
});

describe("what a figure can be missing", () => {
  it("a month with no cost-sheet rows is a ceiling", async () => {
    await db.delete(operatingCosts).where(and(eq(operatingCosts.tenantId, ctx.tenantId), eq(operatingCosts.month, "2026-09")));
    const res = await run({ from: "2026-08-01", to: "2026-10-31" });
    const [aug, sep, oct] = res.data.months;
    expect(sep).toMatchObject({ month: "2026-09", operatingCostsEntered: false, operatingCosts: [], operatingCostsCents: 0, ebitdaIsCeiling: true });
    expect(sep!.ebitdaCents).toBe(sep!.profitAfterVariableCostsCents); // shown as a ceiling, never as a firm profit
    expect(aug).toMatchObject({ operatingCostsEntered: true, unitsWithoutCost: 0, ebitdaIsCeiling: false });
    expect(oct).toMatchObject({ operatingCostsEntered: true, unitsWithoutCost: 0, ebitdaIsCeiling: false });
    expect(res.data.total.ebitdaIsCeiling).toBe(true);
    expect(res.definitions.ceiling).toMatch(/ceiling/i);
  });

  it("a month whose cells were all removed is a ceiling again, and a month that lost only some of them is not", async () => {
    const range = { from: "2026-08-01", to: "2026-08-31" };
    const [first, ...rest] = costsIn("solenne", "2026-08"); // software and contractors
    expect(rest.length).toBeGreaterThan(0);
    await deleteCostCell(db, ctx.tenantId, { month: "2026-08", category: first!.category });
    const some = (await run(range)).data.months[0]!;
    expect(some).toMatchObject({ operatingCostsEntered: true, ebitdaIsCeiling: false, operatingCostsCents: costSum("solenne", "2026-08") - first!.amountCents });
    expect(some.operatingCosts.map((c) => c.category)).not.toContain(first!.category);

    for (const r of rest) await deleteCostCell(db, ctx.tenantId, { month: "2026-08", category: r.category });
    const none = (await run(range)).data;
    expect(none.months[0]).toMatchObject({ operatingCostsEntered: false, operatingCosts: [], operatingCostsCents: 0, ebitdaIsCeiling: true });
    expect(none.months[0]!.ebitdaCents).toBe(none.months[0]!.profitAfterVariableCostsCents); // shown as a ceiling, never as a firm profit
    expect(none.total.ebitdaIsCeiling).toBe(true);
    expect(none.sources.operatingCosts).toBe("Cost sheet: nothing entered");
  });

  it("a partial month prorates operating costs", async () => {
    const range = { from: "2026-10-01", to: "2026-10-15" };
    const res = await run(range);
    expect(res.range).toEqual(range);
    const oct = res.data.months[0]!;
    expect(res.data.months).toHaveLength(1);
    expect(oct).toMatchObject({ month: "2026-10", partial: true, operatingCostsEntered: true });
    expect(oct.operatingCostsCents).toBe(prorate(costSum("solenne", "2026-10"), 15, 31));
    expect(oct.operatingCostsCents).toBeLessThan(costSum("solenne", "2026-10"));
    expect(oct.operatingCosts.reduce((s, c) => s + c.amountCents, 0)).toBe(oct.operatingCostsCents);
    // Sales and ad spend stop on the same day as the costs do.
    expect(oct.netSalesCents).toBe(metricValue(ds, "net_sales", {}, range));
    expect(oct.adSpendCents).toBe(adSum("solenne", range.from, range.to));
    expect(res.definitions.partialMonth).toMatch(/prorated/i);

    // The whole month, and a range that runs past the last day of data, are not partial.
    for (const to of ["2026-10-31", "2026-12-31"]) {
      const whole = await run({ from: "2026-10-01", to });
      expect(whole.range).toEqual({ from: "2026-10-01", to: "2026-10-31" });
      expect(whole.data.months[0]).toMatchObject({ partial: false, operatingCostsCents: costSum("solenne", "2026-10") });
    }
  });

  it("a partial month's categories add up to its prorated total to the cent", async () => {
    // 35,000 x 15/31 = 16,935.48 and 30,000 x 15/31 = 14,516.13 round to 31,451; their sum, 65,000 x 15/31 = 31,451.6, rounds to 31,452.
    await db.delete(operatingCosts).where(and(eq(operatingCosts.tenantId, ctx.tenantId), eq(operatingCosts.month, "2026-10")));
    await upsertCostCell(db, ctx.tenantId, "user_1", { month: "2026-10", category: "software", amountCents: 35_000 });
    await upsertCostCell(db, ctx.tenantId, "user_1", { month: "2026-10", category: "contractors", amountCents: 30_000 });
    const oct = (await run({ from: "2026-10-01", to: "2026-10-15" })).data.months[0]!;
    expect(oct.operatingCostsCents).toBe(31_452);
    expect(oct.operatingCosts).toEqual([
      { category: "software", amountCents: 16_936 },
      { category: "contractors", amountCents: 14_516 },
    ]);
  });

  it("units without a unit cost make the month a ceiling", async () => {
    const saved = await db.select({ id: variants.id, cost: variants.unitCostCents }).from(variants).where(eq(variants.tenantId, ctx.tenantId));
    try {
      await db.update(variants).set({ unitCostCents: null }).where(eq(variants.tenantId, ctx.tenantId));
      const res = await run({ from: "2026-08-01", to: "2026-08-31" });
      const m = res.data.months[0]!;
      expect(m.unitsWithoutCost).toBeGreaterThan(0);
      expect(m.costOfGoodsCents).toBe(0);
      expect(m).toMatchObject({ operatingCostsEntered: true, ebitdaIsCeiling: true });
      expect(res.data.total).toMatchObject({ unitsWithoutCost: m.unitsWithoutCost, ebitdaIsCeiling: true });
    } finally {
      for (const v of saved) await db.update(variants).set({ unitCostCents: v.cost }).where(and(eq(variants.tenantId, ctx.tenantId), eq(variants.id, v.id)));
    }
  });
});

describe("each brand's own sheet", () => {
  it("each brand sees only its own cost sheet", async () => {
    const mine = await run({ from: "2026-08-01", to: "2026-08-31" });
    const theirs = await run({ from: "2026-08-01", to: "2026-08-31" }, tCtx);
    expect(theirs.data.months[0]!.operatingCostsCents).toBe(costSum("tidepool", "2026-08"));
    expect(theirs.data.months[0]!.operatingCostsCents).not.toBe(mine.data.months[0]!.operatingCostsCents);
    expect(theirs.data.months[0]!.adSpendCents).toBe(adSum("tidepool", "2026-08-01", "2026-08-31"));
    // An edit to Solenne's sheet leaves Tidepool's figures where they were.
    await upsertCostCell(db, ctx.tenantId, "user_1", { month: "2026-08", category: "rent", amountCents: 123_456 });
    expect((await run({ from: "2026-08-01", to: "2026-08-31" }, tCtx)).data).toEqual(theirs.data);
    expect((await run({ from: "2026-08-01", to: "2026-08-31" })).data.months[0]!.operatingCostsCents).toBe(mine.data.months[0]!.operatingCostsCents + 123_456);
  });

  it("names the source of every line, and of the cost sheet as it stands", async () => {
    const range = { from: "2026-08-01", to: "2026-08-31" };
    const seeded = await run(range);
    expect(seeded.data.sources).toEqual({
      netSales: "Shopify orders (synced)",
      costOfGoods: "Unit costs in Shopify × units sold",
      adSpend: "Ad spend file (not from Shopify)",
      cardFees: "Assumed rate: 2.9% + $0.30 per order",
      fulfilment: "Assumed: $4.50 per order",
      operatingCosts: "Cost sheet (seeded demo data)",
    });
    await upsertCostCell(db, ctx.tenantId, "user_1", { month: "2026-08", category: "rent", amountCents: 100 });
    expect((await run(range)).data.sources.operatingCosts).toBe("Cost sheet (some rows edited by a person)");
    await db.update(operatingCosts).set({ source: "manual" }).where(eq(operatingCosts.tenantId, ctx.tenantId));
    expect((await run(range)).data.sources.operatingCosts).toBe("Cost sheet (edited by a person)");
    await db.delete(operatingCosts).where(eq(operatingCosts.tenantId, ctx.tenantId));
    const none = await run(range);
    expect(none.data.sources.operatingCosts).toBe("Cost sheet: nothing entered");
    expect(none.data.months[0]).toMatchObject({ operatingCostsEntered: false, ebitdaIsCeiling: true });
  });
});

describe("the range and the input", () => {
  it("covers the months from five before this one to the last day of data when no range is given", async () => {
    const res = await run({});
    expect(res.range).toEqual({ from: "2026-06-01", to: "2026-10-31" });
    expect(res.data.months.map((m) => m.month)).toEqual(["2026-06", "2026-07", "2026-08", "2026-09", "2026-10"]);
    expect(res.queryId).toMatch(/^q_[0-9a-f]{12}$/);
    expect(res.asOf).toEqual(expect.any(String));
    expect(Object.keys(res.definitions)).toEqual(expect.arrayContaining(["ebitda", "profitAfterVariableCosts", "cardFees", "fulfilment", "operatingCosts", "partialMonth", "ceiling"]));
    expect(res.definitions.profitAfterVariableCosts).toMatch(/before operating costs/i);
    expect(await run({})).toEqual(res);
  });

  it("takes a named period, and starts at the first month of data when asked for earlier", async () => {
    const res = await run({ period: "last_month" });
    expect(res.data.months.map((m) => m.month)).toEqual(["2026-10"]);
    const early = await run({ from: "2024-01-01", to: "2025-10-31" });
    expect(early.range).toEqual({ from: "2025-09-01", to: "2025-10-31" }); // no rows for months before the store's first order
    expect(early.data.months.map((m) => m.month)).toEqual(["2025-09", "2025-10"]);
  });

  it("rejects an unknown key such as tenantId, a bad range and a store that isn't connected, and says when a range has no data", async () => {
    for (const key of ["tenantId", "shopDomain", "orgId", "shop", "operatingCosts"]) await expect(run({ [key]: "other" }), key).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(run({ from: "2026-03-08", to: "2026-03-02" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(run({ from: "2026-03-02" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(run({ from: "2024-01-01", to: "2024-01-31" })).rejects.toMatchObject({ code: "NO_DATA" });
    await expect(run({}, { ...ctx, shop: { ...ctx.shop!, status: "disconnected" } })).rejects.toMatchObject({ code: "STORE_DISCONNECTED" });
  });

  it("scenarioBaseOf sums the months", async () => {
    const res = await run({ from: "2026-08-01", to: "2026-10-31" });
    const base = scenarioBaseOf(res.data.months);
    expect(base).toEqual({
      netSalesCents: res.data.total.netSalesCents,
      orders: res.data.total.orders,
      newCustomerOrders: res.data.months.reduce((s, m) => s + m.newCustomerOrders, 0),
      costOfGoodsCents: res.data.total.costOfGoodsCents,
      adSpendCents: res.data.total.adSpendCents,
      operatingCostsCents: res.data.total.operatingCostsCents,
    });
    expect(base.newCustomerOrders).toBe(["2026-08", "2026-09", "2026-10"].reduce((s, m) => s + truth.monthly[m]!.new_customer_orders, 0));
    expect(scenarioBaseOf([])).toEqual({ netSalesCents: 0, orders: 0, newCustomerOrders: 0, costOfGoodsCents: 0, adSpendCents: 0, operatingCostsCents: 0 });
  });
});

describe("the number checker", () => {
  it("the checker reads the rates as rates and the cents as money", async () => {
    const res = await run({ from: "2026-08-01", to: "2026-08-31" });
    const m = res.data.months[0]!;
    const entries = ledgerFromToolResults([res]).entries;
    const at = (path: string) => entries.find((e) => e.path === path)!;
    expect(at("data.months[0].ebitdaRate")).toMatchObject({ unit: "rate", value: m.ebitdaRate! * 100 });
    expect(at("data.months[0].profitAfterVariableCostsRate")).toMatchObject({ unit: "rate", value: m.profitAfterVariableCostsRate! * 100 });
    expect(at("data.total.ebitdaRate")).toMatchObject({ unit: "rate", value: res.data.total.ebitdaRate! * 100 });
    expect(at("data.cardFeeRate")).toMatchObject({ unit: "rate" });
    expect(at("data.cardFeeRate").value).toBeCloseTo(2.9, 9);
    expect(at("data.months[0].ebitdaCents")).toMatchObject({ unit: "money", value: m.ebitdaCents / 100 });
    expect(at("data.months[0].operatingCosts[0].amountCents")).toMatchObject({ unit: "money", value: m.operatingCosts[0]!.amountCents / 100 });
    expect(at("data.fulfilmentCentsPerOrder")).toMatchObject({ unit: "money", value: 4.5 });
    expect(at("data.months[0].orders")).toMatchObject({ unit: "count", value: m.orders });
    expect(at("data.months[0].unitsWithoutCost")).toMatchObject({ unit: "count" });
    // The rate in the plan's own example: 0.073 is 7.3%.
    const hand = { data: { months: [{ ebitdaRate: 0.073 }] }, queryId: "q_hand", range: { from: "2026-08-01", to: "2026-08-31" }, definitions: {}, asOf: "" };
    const [entry] = ledgerFromToolResults([hand]).entries;
    expect(entry).toMatchObject({ unit: "rate", path: "data.months[0].ebitdaRate" });
    expect(entry!.value).toBeCloseTo(7.3, 9);
  });

  it("traces an answer that repeats the card-fee and fulfilment receipts, because the fixed fee is written as money and not as a count of cents", async () => {
    const res = await run({ from: "2026-08-01", to: "2026-08-31" });
    const ledger = ledgerFromToolResults([res]);
    const { cardFees, fulfilment } = res.data.sources;
    expect(cardFees).toBe("Assumed rate: 2.9% + $0.30 per order");
    // The result holds the fee only as money (cardFeeFixedCents), so "30 cents" or "30¢" would be read as a count of 30 and flagged.
    for (const said of [cardFees, fulfilment, "Card fees are assumed at 2.9% plus $0.30 an order, and fulfilment at $4.50 an order."]) {
      expect(checkClaims(said, ledger, []).unmatched, said).toEqual([]);
    }
  });

  it("writes the fixed fee and the fulfilment cost from the rates in force, in dollars with two decimals", async () => {
    await upsertAssumptions(db, ctx.tenantId, "user_1", { cardFeeBps: 295, cardFeeFixedCents: 5, fulfilmentCentsPerOrder: 1_250 });
    const { sources } = (await run({ from: "2026-08-01", to: "2026-08-31" })).data;
    expect(sources.cardFees).toBe("Assumed rate: 2.95% + $0.05 per order");
    expect(sources.fulfilment).toBe("Assumed: $12.50 per order");
    await upsertAssumptions(db, ctx.tenantId, "user_1", { cardFeeBps: 300, cardFeeFixedCents: 0, fulfilmentCentsPerOrder: 450 });
    expect((await run({ from: "2026-08-01", to: "2026-08-31" })).data.sources.cardFees).toBe("Assumed rate: 3% + $0.00 per order");
  });
});
