import { beforeEach, describe, expect, it } from "vitest";
import { and, count, eq, sql } from "drizzle-orm";
import type { Db } from "../../lib/db/client";
import { adSpend, planTargets, plans, tenants } from "../../lib/db/schema";
import { createTestDb } from "../../lib/db/test-db";
import { loadAdSpend, loadPlan, parseAdSpend, parsePlan, readFixtureFile } from "./load-pace";

const SAMPLE = "# FICTIONAL SAMPLE: not a Growth Capital document. All brands, people and figures are invented.";

describe("parseAdSpend", () => {
  it("skips the FICTIONAL SAMPLE line and blank lines, and reads one row per day and channel", () => {
    const rows = parseAdSpend(`${SAMPLE}\ndate,channel,spend\n2025-09-01,meta,4615\n\n2025-09-01,google,2610\n`);
    expect(rows).toEqual([
      { date: "2025-09-01", channel: "meta", spendCents: 4615 },
      { date: "2025-09-01", channel: "google", spendCents: 2610 },
    ]);
  });

  it.each([
    ["a date that is not a day", "2025-02-30,meta,100", /Line 3/],
    ["a date in the wrong shape", "09/01/2025,meta,100", /Line 3/],
    ["a channel we don't know", "2025-09-01,snapchat,100", /Line 3/],
    ["a negative spend", "2025-09-01,meta,-5", /Line 3/],
    ["a spend with cents in it", "2025-09-01,meta,12.5", /Line 3/],
    ["a missing column", "2025-09-01,meta", /Line 3/],
  ])("rejects %s, naming the line", (_what, row, message) => {
    expect(() => parseAdSpend(`date,channel,spend\n2025-09-01,meta,1\n${row}\n`)).toThrow(message);
  });

  it("rejects the same day and channel twice, so a total can't be doubled by accident", () => {
    expect(() => parseAdSpend("date,channel,spend\n2025-09-01,meta,1\n2025-09-01,meta,2\n")).toThrow(/twice/);
  });

  it("rejects a file with the wrong header", () => {
    expect(() => parseAdSpend("day,platform,amount\n2025-09-01,meta,1\n")).toThrow(/header/);
  });
});

describe("parsePlan", () => {
  it("reads one row per month into targets, with money in cents and the rate as a fraction", () => {
    const plan = parsePlan(`${SAMPLE}\nmonth,net_sales,orders,new_customer_orders,aov,returning_customer_rate\n2026-10,650688,92,44,7436,0.5217\n`);
    expect(plan).toEqual([
      { month: "2026-10", metric: "net_sales", value: 650688 },
      { month: "2026-10", metric: "orders", value: 92 },
      { month: "2026-10", metric: "new_customer_orders", value: 44 },
      { month: "2026-10", metric: "aov", value: 7436 },
      { month: "2026-10", metric: "returning_customer_rate", value: 0.5217 },
    ]);
  });

  it.each([
    ["a month in the wrong shape", "2026-10-01,1,1,1,1,0.1"],
    ["a rate above 100%", "2026-10,1,1,1,1,1.5"],
    ["a negative target", "2026-10,-1,1,1,1,0.1"],
    ["a target that is not a number", "2026-10,lots,1,1,1,0.1"],
  ])("rejects %s", (_what, row) => {
    expect(() => parsePlan(`month,net_sales,orders,new_customer_orders,aov,returning_customer_rate\n${row}\n`)).toThrow(/Line 2/);
  });

  it("rejects the same month twice", () => {
    const row = "2026-10,1,1,1,1,0.1";
    expect(() => parsePlan(`month,net_sales,orders,new_customer_orders,aov,returning_customer_rate\n${row}\n${row}\n`)).toThrow(/twice/);
  });
});

describe("loading the fixtures", () => {
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

  // Counted straight from the file, not through the parser under test.
  const fileSpendCents = (store: "solenne" | "tidepool") =>
    readFixtureFile(store, "ad-spend.csv")
      .split("\n")
      .filter((l) => /^\d{4}-\d{2}-\d{2},/.test(l))
      .reduce((s, l) => s + Number(l.split(",")[2]), 0);
  const fileSpendRows = (store: "solenne" | "tidepool") => readFixtureFile(store, "ad-spend.csv").split("\n").filter((l) => /^\d{4}-\d{2}-\d{2},/.test(l)).length;

  it("loads every row of a store's ad-spend.csv for its tenant, and the total matches the file", async () => {
    const res = await loadAdSpend(db, a, readFixtureFile("solenne", "ad-spend.csv"));
    expect(res.rows).toBe(fileSpendRows("solenne"));
    const [row] = await db.select({ n: count(), total: sql<number>`sum(${adSpend.spendCents})::int` }).from(adSpend).where(eq(adSpend.tenantId, a));
    expect(row).toEqual({ n: fileSpendRows("solenne"), total: fileSpendCents("solenne") });
  });

  it("is safe to run again: the second load changes nothing", async () => {
    const csv = readFixtureFile("tidepool", "ad-spend.csv");
    await loadAdSpend(db, a, csv);
    await loadAdSpend(db, a, csv);
    const [row] = await db.select({ n: count() }).from(adSpend).where(eq(adSpend.tenantId, a));
    expect(row!.n).toBe(fileSpendRows("tidepool"));
  });

  it("updates a day's spend when the file changes, and keeps the other days", async () => {
    await loadAdSpend(db, a, "date,channel,spend\n2025-09-01,meta,100\n2025-09-02,meta,200\n");
    await loadAdSpend(db, a, "date,channel,spend\n2025-09-01,meta,150\n");
    const rows = await db.select().from(adSpend).where(eq(adSpend.tenantId, a));
    expect(rows.map((r) => [r.date, r.spendCents]).sort()).toEqual([["2025-09-01", 150], ["2025-09-02", 200]]);
  });

  it("keeps each tenant's spend apart", async () => {
    await loadAdSpend(db, a, readFixtureFile("solenne", "ad-spend.csv"));
    await loadAdSpend(db, b, readFixtureFile("tidepool", "ad-spend.csv"));
    const total = async (t: string) => (await db.select({ total: sql<number>`sum(${adSpend.spendCents})::int` }).from(adSpend).where(eq(adSpend.tenantId, t)))[0]!.total;
    expect(await total(a)).toBe(fileSpendCents("solenne"));
    expect(await total(b)).toBe(fileSpendCents("tidepool"));
  });

  it("stores nothing when one row of the file is bad", async () => {
    await expect(loadAdSpend(db, a, "date,channel,spend\n2025-09-01,meta,100\n2025-09-02,nope,200\n")).rejects.toThrow(/Line 3/);
    const [row] = await db.select({ n: count() }).from(adSpend).where(eq(adSpend.tenantId, a));
    expect(row!.n).toBe(0);
  });

  it("loads a plan as one active plan with a target per month and metric", async () => {
    const csv = readFixtureFile("solenne", "plan.csv");
    const months = csv.split("\n").filter((l) => /^\d{4}-\d{2},/.test(l)).length;
    const res = await loadPlan(db, a, csv, "Solenne plan (fixture)");
    expect(res.months).toBe(months);
    const [p] = await db.select().from(plans).where(eq(plans.tenantId, a));
    expect(p).toMatchObject({ label: "Solenne plan (fixture)", source: "fixture", active: true });
    const [t] = await db.select({ n: count() }).from(planTargets).where(and(eq(planTargets.tenantId, a), eq(planTargets.planId, p!.id)));
    expect(t!.n).toBe(months * 5);
  });

  it("replaces the fixture plan when loaded again, so there is still one plan and no leftover months", async () => {
    await loadPlan(db, a, "month,net_sales,orders,new_customer_orders,aov,returning_customer_rate\n2026-09,100,1,1,100,0\n2026-10,200,2,2,100,0\n", "plan");
    await loadPlan(db, a, "month,net_sales,orders,new_customer_orders,aov,returning_customer_rate\n2026-10,250,2,2,125,0\n", "plan");
    expect(await db.select().from(plans).where(eq(plans.tenantId, a))).toHaveLength(1);
    const rows = await db.select().from(planTargets).where(and(eq(planTargets.tenantId, a), eq(planTargets.metric, "net_sales")));
    expect(rows.map((r) => [r.month, r.value])).toEqual([["2026-10", 250]]);
  });

  it("keeps each tenant's plan apart", async () => {
    await loadPlan(db, a, readFixtureFile("solenne", "plan.csv"), "A");
    await loadPlan(db, b, readFixtureFile("tidepool", "plan.csv"), "B");
    expect(await db.select().from(plans)).toHaveLength(2);
    const aMonths = await db.select().from(planTargets).where(and(eq(planTargets.tenantId, a), eq(planTargets.metric, "net_sales")));
    const bMonths = await db.select().from(planTargets).where(and(eq(planTargets.tenantId, b), eq(planTargets.metric, "net_sales")));
    expect(aMonths.length).not.toBe(bMonths.length);
  });
});
