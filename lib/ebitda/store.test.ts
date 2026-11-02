import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../db/client";
import { costAssumptions, operatingCosts, tenants } from "../db/schema";
import { createTestDb } from "../db/test-db";
import { loadCosts } from "../../scripts/fixtures/load-costs";
import { deleteCostCell, loadAssumptions, loadCostSheet, upsertAssumptions, upsertCostCell } from "./store";
import { DEFAULT_ASSUMPTIONS } from "./types";

let db: Db;
let a: string;
let b: string;

beforeEach(async () => {
  db = await createTestDb();
  const rows = await db.insert(tenants).values([{ orgId: "org_a", name: "A" }, { orgId: "org_b", name: "B" }]).returning({ id: tenants.id });
  a = rows[0]!.id;
  b = rows[1]!.id;
}, 60_000);

const fixtureRow = (tenantId: string, month: string, category: "payroll" | "software" | "rent" | "contractors" | "other", amountCents: number) =>
  ({ tenantId, month, category, amountCents, source: "fixture" as const });

describe("loadAssumptions", () => {
  it("falls back to DEFAULT_ASSUMPTIONS with source 'default' when the tenant has no row", async () => {
    const res = await loadAssumptions(db, a);
    expect(res).toEqual({ assumptions: DEFAULT_ASSUMPTIONS, source: "default" });
    expect(res.assumptions).not.toBe(DEFAULT_ASSUMPTIONS); // a copy, so a caller can't change the shared defaults
  });

  it("returns the row the tenant has, with its source, and not another tenant's", async () => {
    await db.insert(costAssumptions).values([
      { tenantId: a, cardFeeBps: 250, cardFeeFixedCents: 25, fulfilmentCentsPerOrder: 600, source: "fixture" },
      { tenantId: b, cardFeeBps: 400, cardFeeFixedCents: 10, fulfilmentCentsPerOrder: 100, source: "manual" },
    ]);
    expect(await loadAssumptions(db, a)).toEqual({ assumptions: { cardFeeBps: 250, cardFeeFixedCents: 25, fulfilmentCentsPerOrder: 600 }, source: "fixture" });
    expect(await loadAssumptions(db, b)).toEqual({ assumptions: { cardFeeBps: 400, cardFeeFixedCents: 10, fulfilmentCentsPerOrder: 100 }, source: "manual" });
  });
});

describe("upsertAssumptions", () => {
  it("writes the rates as manual with who typed them, then replaces them, for that tenant only", async () => {
    await db.insert(costAssumptions).values({ tenantId: a, cardFeeBps: 290, cardFeeFixedCents: 30, fulfilmentCentsPerOrder: 450, source: "fixture" });
    await upsertAssumptions(db, a, "user_1", { cardFeeBps: 310, cardFeeFixedCents: 35, fulfilmentCentsPerOrder: 500 });
    expect(await loadAssumptions(db, a)).toEqual({ assumptions: { cardFeeBps: 310, cardFeeFixedCents: 35, fulfilmentCentsPerOrder: 500 }, source: "manual" });
    await upsertAssumptions(db, a, "user_2", { cardFeeBps: 300, cardFeeFixedCents: 30, fulfilmentCentsPerOrder: 500 });
    const rows = await db.select().from(costAssumptions);
    expect(rows).toHaveLength(1); // an upsert, not a second row
    expect(rows[0]).toMatchObject({ tenantId: a, cardFeeBps: 300, updatedBy: "user_2", source: "manual" });
    expect(await loadAssumptions(db, b)).toMatchObject({ source: "default" });
  });
});

describe("loadCostSheet", () => {
  it("returns the months in the range, by month and then in category order, with each source", async () => {
    await db.insert(operatingCosts).values([
      fixtureRow(a, "2026-02", "other", 500),
      fixtureRow(a, "2026-02", "payroll", 4_000),
      fixtureRow(a, "2026-01", "software", 2_500),
      fixtureRow(a, "2026-02", "contractors", 3_000),
      fixtureRow(a, "2025-12", "software", 2_500), // before the range
      fixtureRow(a, "2026-04", "software", 2_500), // after it
      fixtureRow(b, "2026-02", "software", 9_999), // another brand
    ]);
    const rows = await loadCostSheet(db, a, { from: "2026-01", to: "2026-03" });
    expect(rows.map((r) => `${r.month} ${r.category} ${r.amountCents} ${r.source}`)).toEqual([
      "2026-01 software 2500 fixture",
      "2026-02 payroll 4000 fixture",
      "2026-02 contractors 3000 fixture",
      "2026-02 other 500 fixture",
    ]);
    expect(await loadCostSheet(db, a, { from: "2027-01", to: "2027-03" })).toEqual([]);
  });
});

describe("upsertCostCell", () => {
  it("marks the cell manual and stamps updatedBy; tenant B's sheet is unchanged", async () => {
    await db.insert(operatingCosts).values([fixtureRow(a, "2026-03", "software", 27_500), fixtureRow(b, "2026-03", "software", 12_000)]);
    await upsertCostCell(db, a, "user_1", { month: "2026-03", category: "software", amountCents: 31_000 });

    expect(await loadCostSheet(db, a, { from: "2026-03", to: "2026-03" })).toEqual([{ month: "2026-03", category: "software", amountCents: 31_000, source: "manual" }]);
    const [stamped] = await db.select().from(operatingCosts).where(eq(operatingCosts.tenantId, a));
    expect(stamped).toMatchObject({ updatedBy: "user_1", source: "manual", amountCents: 31_000 });
    expect(await loadCostSheet(db, b, { from: "2026-03", to: "2026-03" })).toEqual([{ month: "2026-03", category: "software", amountCents: 12_000, source: "fixture" }]);
  });

  it("adds a cell that was not there, including a zero, which is entered and not missing", async () => {
    await upsertCostCell(db, a, "user_1", { month: "2026-04", category: "rent", amountCents: 0 });
    expect(await loadCostSheet(db, a, { from: "2026-04", to: "2026-04" })).toEqual([{ month: "2026-04", category: "rent", amountCents: 0, source: "manual" }]);
    expect(await db.select().from(operatingCosts)).toHaveLength(1);
  });
});

describe("deleteCostCell", () => {
  it("removes the cell whatever its source, and only that cell", async () => {
    await db.insert(operatingCosts).values([
      fixtureRow(a, "2026-03", "software", 27_500),
      fixtureRow(a, "2026-03", "rent", 90_000),
      fixtureRow(a, "2026-04", "software", 27_500), // the same category in another month
    ]);
    await upsertCostCell(db, a, "user_1", { month: "2026-03", category: "other", amountCents: 1_500 }); // a cell a person typed in
    await deleteCostCell(db, a, { month: "2026-03", category: "software" }); // a cell the file seeded
    await deleteCostCell(db, a, { month: "2026-03", category: "other" });
    expect(await loadCostSheet(db, a, { from: "2026-03", to: "2026-04" })).toEqual([
      { month: "2026-03", category: "rent", amountCents: 90_000, source: "fixture" },
      { month: "2026-04", category: "software", amountCents: 27_500, source: "fixture" },
    ]);
    expect(await db.select().from(operatingCosts)).toHaveLength(2);
  });

  it("removes a cell that was changed to zero, which is not the same as one that was never entered", async () => {
    await upsertCostCell(db, a, "user_1", { month: "2026-03", category: "software", amountCents: 0 });
    expect(await loadCostSheet(db, a, { from: "2026-03", to: "2026-03" })).toHaveLength(1);
    await deleteCostCell(db, a, { month: "2026-03", category: "software" });
    expect(await loadCostSheet(db, a, { from: "2026-03", to: "2026-03" })).toEqual([]);
  });

  it("leaves the other brand's cell alone, even for the same month and category", async () => {
    await db.insert(operatingCosts).values([fixtureRow(a, "2026-03", "software", 27_500), fixtureRow(b, "2026-03", "software", 12_000)]);
    await upsertCostCell(db, b, "user_9", { month: "2026-03", category: "rent", amountCents: 5_000 });
    const theirs = await db.select().from(operatingCosts).where(eq(operatingCosts.tenantId, b));

    await deleteCostCell(db, a, { month: "2026-03", category: "software" });
    expect(await loadCostSheet(db, a, { from: "2026-03", to: "2026-03" })).toEqual([]);
    expect(await db.select().from(operatingCosts).where(eq(operatingCosts.tenantId, b))).toEqual(theirs);

    await deleteCostCell(db, a, { month: "2026-03", category: "rent" }); // a brand that has no such cell removes nothing of another brand's
    expect(await db.select().from(operatingCosts).where(eq(operatingCosts.tenantId, b))).toEqual(theirs);
  });

  it("does nothing, and does not fail, when the cell is not there", async () => {
    await db.insert(operatingCosts).values(fixtureRow(a, "2026-03", "software", 27_500));
    await deleteCostCell(db, a, { month: "2026-03", category: "rent" });
    await deleteCostCell(db, a, { month: "2026-05", category: "software" });
    await deleteCostCell(db, b, { month: "2026-03", category: "software" });
    expect(await loadCostSheet(db, a, { from: "2026-03", to: "2026-05" })).toEqual([{ month: "2026-03", category: "software", amountCents: 27_500, source: "fixture" }]);
  });

  it("leaves a month with no cells, which reads as nothing entered", async () => {
    await db.insert(operatingCosts).values([fixtureRow(a, "2026-03", "software", 27_500), fixtureRow(a, "2026-03", "contractors", 30_000), fixtureRow(a, "2026-04", "software", 27_500)]);
    await deleteCostCell(db, a, { month: "2026-03", category: "software" });
    expect((await loadCostSheet(db, a, { from: "2026-03", to: "2026-03" })).map((r) => r.category)).toEqual(["contractors"]);
    await deleteCostCell(db, a, { month: "2026-03", category: "contractors" });
    expect(await loadCostSheet(db, a, { from: "2026-03", to: "2026-03" })).toEqual([]);
    expect(await loadCostSheet(db, a, { from: "2026-04", to: "2026-04" })).toHaveLength(1); // the next month is untouched
  });

  it("lets a reload of the seed file bring a removed cell back, while a cell a person changed stays as typed until it is removed", async () => {
    const csv = "month,category,amount\n2026-03,software,27500\n2026-03,rent,90000\n";
    await loadCosts(db, a, csv);
    await upsertCostCell(db, a, "user_1", { month: "2026-03", category: "software", amountCents: 31_000 }); // changed to another amount
    await loadCosts(db, a, csv);
    expect(await loadCostSheet(db, a, { from: "2026-03", to: "2026-03" })).toEqual([
      { month: "2026-03", category: "software", amountCents: 31_000, source: "manual" },
      { month: "2026-03", category: "rent", amountCents: 90_000, source: "fixture" },
    ]);

    await deleteCostCell(db, a, { month: "2026-03", category: "software" });
    expect((await loadCostSheet(db, a, { from: "2026-03", to: "2026-03" })).map((r) => r.category)).toEqual(["rent"]);
    await loadCosts(db, a, csv);
    expect(await loadCostSheet(db, a, { from: "2026-03", to: "2026-03" })).toEqual([
      { month: "2026-03", category: "software", amountCents: 27_500, source: "fixture" },
      { month: "2026-03", category: "rent", amountCents: 90_000, source: "fixture" },
    ]);
  });
});
