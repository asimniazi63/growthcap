import { beforeEach, describe, expect, it } from "vitest";
import { count, eq, sql } from "drizzle-orm";
import type { Db } from "../../lib/db/client";
import { costAssumptions, operatingCosts, tenants } from "../../lib/db/schema";
import { createTestDb } from "../../lib/db/test-db";
import { loadCostAssumptions, loadCosts, parseCostAssumptions, parseCosts } from "./load-costs";
import { readFixtureFile } from "./load-pace";

const SAMPLE = "# FICTIONAL SAMPLE: not a Growth Capital document. All brands, people and figures are invented.";
const COSTS_HEADER = "month,category,amount";
const RATES = "key,value\ncard_fee_bps,290\ncard_fee_fixed_cents,30\nfulfilment_cents_per_order,450\n";

describe("the cost sheet files", () => {
  it("parseCosts reads cents and skips the FICTIONAL SAMPLE comment line", () => {
    const rows = parseCosts(`${SAMPLE}\n${COSTS_HEADER}\n2026-03,software,27500\n\n2026-03,contractors,30000\n`);
    expect(rows).toEqual([
      { month: "2026-03", category: "software", amountCents: 27500 },
      { month: "2026-03", category: "contractors", amountCents: 30000 },
    ]);
  });

  // The first data row is on line 2, so the bad row under test is always on line 3.
  it.each([
    ["a category that is not in the list", "2026-03,bonus,100", /Line 3: "bonus" is not a cost category/],
    ["a month that is not a month", "2026-13,software,100", /Line 3: "2026-13" is not a month/],
    ["a month in the wrong shape", "2026-03-01,software,100", /Line 3: "2026-03-01" is not a month/],
    ["an amount with cents in it", "2026-03,software,12.5", /Line 3: amount "12.5"/],
    ["a negative amount", "2026-03,software,-1", /Line 3: amount "-1"/],
    ["an amount too big for the database", "2026-03,software,2147483648", /Line 3: amount "2147483648"/],
    ["a missing column", "2026-03,software", /Line 3: expected 3 columns/],
    ["the same month and category twice", "2026-02,software,2", /Line 3: software in 2026-02 appears twice/],
  ])("parseCosts names the line for each bad row: %s", (_what, row, message) => {
    expect(() => parseCosts(`${COSTS_HEADER}\n2026-02,software,1\n${row}\n`)).toThrow(message);
  });

  it("parseCosts accepts the same category in different months, and a file with a header and no rows", () => {
    expect(parseCosts(`${COSTS_HEADER}\n2026-02,software,1\n2026-03,software,1\n`)).toHaveLength(2);
    expect(parseCosts(`${SAMPLE}\n${COSTS_HEADER}\n`)).toEqual([]);
  });

  it("parseCostAssumptions needs all three keys and rejects unknown ones", () => {
    expect(parseCostAssumptions(`${SAMPLE}\n${RATES}`)).toEqual({ cardFeeBps: 290, cardFeeFixedCents: 30, fulfilmentCentsPerOrder: 450 });
    // The order of the rows does not matter.
    expect(parseCostAssumptions("key,value\nfulfilment_cents_per_order,500\ncard_fee_fixed_cents,25\ncard_fee_bps,250\n")).toEqual({
      cardFeeBps: 250,
      cardFeeFixedCents: 25,
      fulfilmentCentsPerOrder: 500,
    });
    expect(() => parseCostAssumptions("key,value\ncard_fee_bps,290\ncard_fee_fixed_cents,30\n")).toThrow(/missing fulfilment_cents_per_order/);
    expect(() => parseCostAssumptions("key,value\n")).toThrow(/missing card_fee_bps, card_fee_fixed_cents, fulfilment_cents_per_order/);
    expect(() => parseCostAssumptions(`${SAMPLE}\n${RATES}shipping_cents,100\n`)).toThrow(/Line 6: "shipping_cents" is not a rate we know/);
    expect(() => parseCostAssumptions(`${RATES}card_fee_bps,300\n`)).toThrow(/Line 5: card_fee_bps appears twice/);
  });

  // The rates sit on lines 2, 3 and 4 in the order of RATES; one of them is replaced by the bad value.
  it.each([
    ["a rate with cents in it", "card_fee_fixed_cents", "0.3", 3],
    ["a negative rate", "fulfilment_cents_per_order", "-450", 4],
    ["a card fee above 100%", "card_fee_bps", "10001", 2],
    ["a rate that is not a number", "card_fee_bps", "2.9%", 2],
  ])("parseCostAssumptions names the line for %s", (_what, key, value, line) => {
    const rate = (k: string, fallback: number) => `${k},${k === key ? value : fallback}`;
    const text = `key,value\n${rate("card_fee_bps", 290)}\n${rate("card_fee_fixed_cents", 30)}\n${rate("fulfilment_cents_per_order", 450)}\n`;
    expect(() => parseCostAssumptions(text)).toThrow(`Line ${line}: ${key} "${value}"`);
  });
});

describe("loading the cost sheet", () => {
  let db: Db;
  let a: string;
  let b: string;
  beforeEach(async () => {
    db = await createTestDb();
    [{ id: a }, { id: b }] = (await db
      .insert(tenants)
      .values([
        { orgId: "org_a", name: "A" },
        { orgId: "org_b", name: "B" },
      ])
      .returning({ id: tenants.id })) as [{ id: string }, { id: string }];
  }, 60_000);

  const cells = (tenantId: string) => db.select().from(operatingCosts).where(eq(operatingCosts.tenantId, tenantId)).orderBy(operatingCosts.month, operatingCosts.category);
  // Counted straight from the file, not through the parser under test.
  const dataLines = (csv: string) => csv.split("\n").filter((l) => /^\d{4}-\d{2},/.test(l));
  const fileCents = (csv: string) => dataLines(csv).reduce((s, l) => s + Number(l.split(",")[2]), 0);

  it("loadCosts is repeatable: the same file twice leaves the same rows", async () => {
    const csv = readFixtureFile("solenne", "costs.csv");
    const res = await loadCosts(db, a, csv);
    expect(res.rows).toBe(dataLines(csv).length);
    const first = await cells(a);
    expect(first).toHaveLength(res.rows);
    expect(first.reduce((s, r) => s + r.amountCents, 0)).toBe(fileCents(csv));
    expect(first.every((r) => r.source === "fixture" && r.updatedBy === null)).toBe(true);
    await loadCosts(db, a, csv);
    expect(await cells(a)).toEqual(first); // not even updated_at moves
  });

  it("a reload never overwrites a cell a person edited", async () => {
    await db.insert(operatingCosts).values({ tenantId: a, month: "2026-03", category: "software", amountCents: 99900, source: "manual", updatedBy: "user_1" });
    await loadCosts(db, a, `${COSTS_HEADER}\n2026-03,software,27500\n2026-04,software,27500\n`);
    expect((await cells(a)).map((r) => [r.month, r.category, r.amountCents, r.source, r.updatedBy])).toEqual([
      ["2026-03", "software", 99900, "manual", "user_1"],
      ["2026-04", "software", 27500, "fixture", null],
    ]);
  });

  it("a reload updates a fixture cell the file changed, and keeps a cell the file no longer lists", async () => {
    await loadCosts(db, a, `${COSTS_HEADER}\n2026-03,software,100\n2026-04,software,200\n`);
    await loadCosts(db, a, `${COSTS_HEADER}\n2026-03,software,150\n`);
    expect((await cells(a)).map((r) => [r.month, r.amountCents, r.source])).toEqual([
      ["2026-03", 150, "fixture"],
      ["2026-04", 200, "fixture"],
    ]);
  });

  it("keeps each tenant's cells apart", async () => {
    const solenne = readFixtureFile("solenne", "costs.csv");
    const tidepool = readFixtureFile("tidepool", "costs.csv");
    await loadCosts(db, a, solenne);
    await loadCosts(db, b, tidepool);
    const total = async (tenantId: string) => (await db.select({ n: count(), cents: sql<number>`sum(${operatingCosts.amountCents})::int` }).from(operatingCosts).where(eq(operatingCosts.tenantId, tenantId)))[0]!;
    expect(await total(a)).toEqual({ n: dataLines(solenne).length, cents: fileCents(solenne) });
    expect(await total(b)).toEqual({ n: dataLines(tidepool).length, cents: fileCents(tidepool) });
  });

  it("stores nothing when one row of the file is bad", async () => {
    await expect(loadCosts(db, a, `${COSTS_HEADER}\n2026-03,software,100\n2026-04,bonus,200\n`)).rejects.toThrow(/Line 3/);
    const [row] = await db.select({ n: count() }).from(operatingCosts).where(eq(operatingCosts.tenantId, a));
    expect(row!.n).toBe(0);
  });

  it("loads a header-only file as no rows", async () => {
    expect(await loadCosts(db, a, `${SAMPLE}\n${COSTS_HEADER}\n`)).toEqual({ rows: 0 });
    expect(await cells(a)).toEqual([]);
  });

  it("loadCostAssumptions stores one row for the brand, and a second load leaves it as it was", async () => {
    await loadCostAssumptions(db, a, `${SAMPLE}\n${RATES}`);
    const [first] = await db.select().from(costAssumptions).where(eq(costAssumptions.tenantId, a));
    expect(first).toMatchObject({ cardFeeBps: 290, cardFeeFixedCents: 30, fulfilmentCentsPerOrder: 450, source: "fixture", updatedBy: null });
    await loadCostAssumptions(db, a, `${SAMPLE}\n${RATES}`);
    expect(await db.select().from(costAssumptions).where(eq(costAssumptions.tenantId, a))).toEqual([first]);
    expect(await db.select().from(costAssumptions).where(eq(costAssumptions.tenantId, b))).toEqual([]);
  });

  it("a reload changes fixture rates the file changed, but never rates a person edited", async () => {
    await loadCostAssumptions(db, a, RATES);
    await loadCostAssumptions(db, a, "key,value\ncard_fee_bps,250\ncard_fee_fixed_cents,30\nfulfilment_cents_per_order,450\n");
    expect((await db.select().from(costAssumptions).where(eq(costAssumptions.tenantId, a)))[0]).toMatchObject({ cardFeeBps: 250, source: "fixture" });
    await db.update(costAssumptions).set({ fulfilmentCentsPerOrder: 700, source: "manual", updatedBy: "user_1" }).where(eq(costAssumptions.tenantId, a));
    await loadCostAssumptions(db, a, RATES);
    expect((await db.select().from(costAssumptions).where(eq(costAssumptions.tenantId, a)))[0]).toMatchObject({ cardFeeBps: 250, fulfilmentCentsPerOrder: 700, source: "manual", updatedBy: "user_1" });
  });
});
