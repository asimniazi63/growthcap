import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setTestNow } from "@/lib/clock";
import type { Db } from "@/lib/db/client";
import { costAssumptions, operatingCosts } from "@/lib/db/schema";
import { createTestDb } from "@/lib/db/test-db";
import type { EbitdaMonth } from "@/lib/ebitda/types";
import type { TenantContext } from "@/lib/tenancy/context";
import { getEbitda } from "@/lib/tools/ebitda";
import { loadCostAssumptions, loadCosts } from "@/scripts/fixtures/load-costs";
import { seedTwoStores } from "@/scripts/fixtures/load-db";
import { loadAdSpend, readFixtureFile } from "@/scripts/fixtures/load-pace";
import { PUT } from "./route";

// A real (in-memory) database with both stores loaded; only the session is faked, and the route is handed the test database in place of
// the Neon one. What is checked is what the route decides on its own (who may edit, what a body may say, which months it takes) and
// that an edit lands where get_ebitda, the one reader of the cost sheet, sees it, and only for the brand in the session.
const m = vi.hoisted(() => ({ ctx: vi.fn<() => Promise<TenantContext>>(), db: { current: undefined as unknown as Db } }));
vi.mock("@/lib/tenancy/context", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/tenancy/context")>()), getTenantContext: m.ctx }));
vi.mock("@/lib/db/client", () => ({ getDb: () => m.db.current }));

let db: Db;
let solenne: TenantContext;
let tidepool: TenantContext;

// Both stores' sheets are put back to the checked-in files before every test, because a reload never overwrites an edited cell.
async function resetSheets() {
  await db.delete(operatingCosts);
  await db.delete(costAssumptions);
  for (const [store, ctx] of [["solenne", solenne], ["tidepool", tidepool]] as const) {
    await loadCosts(db, ctx.tenantId, readFixtureFile(store, "costs.csv"));
    await loadCostAssumptions(db, ctx.tenantId, readFixtureFile(store, "cost-assumptions.csv"));
  }
}

beforeAll(async () => {
  setTestNow("2026-11-02T12:00:00-05:00"); // the data ends on 2026-10-31, so "today" is the day after: the current month is 2026-11
  db = await createTestDb();
  m.db.current = db;
  const seeded = await seedTwoStores(db);
  solenne = seeded.ctxs.solenne;
  tidepool = seeded.ctxs.tidepool;
  for (const [store, ctx] of [["solenne", solenne], ["tidepool", tidepool]] as const) await loadAdSpend(db, ctx.tenantId, readFixtureFile(store, "ad-spend.csv"));
}, 240_000);

beforeEach(async () => {
  vi.clearAllMocks();
  m.ctx.mockResolvedValue(as(solenne, "gc_partner"));
  await resetSheets();
});

afterAll(() => setTestNow(null));

const as = (ctx: TenantContext, role: TenantContext["role"], over: Partial<TenantContext> = {}): TenantContext => ({ ...ctx, role, userId: `user_${role}`, ...over });
const send = (raw: string) => PUT(new Request("https://x.test/api/ebitda/costs", { method: "PUT", headers: { "content-type": "application/json" }, body: raw }));
const put = (body: unknown) => send(JSON.stringify(body));

const RANGE = { from: "2026-05-01", to: "2026-10-31" };
const monthOf = async (ctx: TenantContext, month: string): Promise<EbitdaMonth> => {
  const { data } = await getEbitda(ctx, RANGE, { db });
  return data.months.find((x) => x.month === month)!;
};
const sheet = (tenantId: string) => db.select().from(operatingCosts).where(eq(operatingCosts.tenantId, tenantId)).orderBy(operatingCosts.month, operatingCosts.category);
const rates = (tenantId: string) => db.select().from(costAssumptions).where(eq(costAssumptions.tenantId, tenantId));
const cell = (month: string, category: string, amountCents: unknown) => ({ kind: "cell", month, category, amountCents });
const softwareOf = (x: EbitdaMonth) => x.operatingCosts.find((c) => c.category === "software")!.amountCents;

describe("PUT /api/ebitda/costs: a cost cell", () => {
  it.each(["gc_partner", "gc_admin"] as const)("a %s edit changes the next getEbitda for that month, marks the cell manual and stamps who made it", async (role) => {
    m.ctx.mockResolvedValue(as(solenne, role));
    const before = await monthOf(solenne, "2026-08");
    const julyBefore = await monthOf(solenne, "2026-07");
    const was = softwareOf(before);

    const res = await put(cell("2026-08", "software", was + 10_000));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const after = await monthOf(solenne, "2026-08");
    expect(softwareOf(after)).toBe(was + 10_000);
    expect(after.operatingCostsCents).toBe(before.operatingCostsCents + 10_000);
    expect(after.ebitdaCents).toBe(before.ebitdaCents - 10_000); // the bridge still adds up: only the operating-cost line moved
    expect(after.netSalesCents).toBe(before.netSalesCents);
    expect(after.adSpendCents).toBe(before.adSpendCents);
    expect(await monthOf(solenne, "2026-07")).toEqual(julyBefore); // no other month is touched

    const row = (await sheet(solenne.tenantId)).find((r) => r.month === "2026-08" && r.category === "software")!;
    expect(row).toMatchObject({ amountCents: was + 10_000, source: "manual", updatedBy: `user_${role}` });
  });

  it("saves a second edit of the same cell over the first, and keeps the other cells", async () => {
    const rowsBefore = (await sheet(solenne.tenantId)).length;
    await put(cell("2026-08", "software", 11_100));
    await put(cell("2026-08", "software", 22_200));
    const rows = await sheet(solenne.tenantId);
    expect(rows).toHaveLength(rowsBefore);
    expect(rows.filter((r) => r.month === "2026-08" && r.category === "software")).toMatchObject([{ amountCents: 22_200, source: "manual" }]);
  });

  it("can add a category the month did not have, and a zero is a real amount", async () => {
    const before = await monthOf(solenne, "2026-08");
    expect(before.operatingCosts.some((c) => c.category === "rent")).toBe(false);
    expect((await put(cell("2026-08", "rent", 50_000))).status).toBe(200);
    expect((await put(cell("2026-08", "other", 0))).status).toBe(200);
    const after = await monthOf(solenne, "2026-08");
    expect(after.operatingCosts.find((c) => c.category === "rent")?.amountCents).toBe(50_000);
    expect(after.operatingCostsCents).toBe(before.operatingCostsCents + 50_000);
  });

  it("refuses a client viewer, and a request with no session, with 403 and writes nothing", async () => {
    const rowsBefore = await sheet(solenne.tenantId);
    const ratesBefore = await rates(solenne.tenantId);
    m.ctx.mockResolvedValue(as(solenne, "client_viewer"));
    const res = await put(cell("2026-08", "software", 1));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "FORBIDDEN" });
    expect((await put({ kind: "assumptions", cardFeeBps: 100, cardFeeFixedCents: 10, fulfilmentCentsPerOrder: 100 })).status).toBe(403);
    m.ctx.mockRejectedValue(new Error("no session"));
    expect((await put(cell("2026-08", "software", 1))).status).toBe(403);
    expect(await sheet(solenne.tenantId)).toEqual(rowsBefore);
    expect(await rates(solenne.tenantId)).toEqual(ratesBefore);
  });

  it("checks the role before it reads the body: a viewer who sends garbage still gets 403, not 400", async () => {
    m.ctx.mockResolvedValue(as(solenne, "client_viewer"));
    expect((await send("this is not json")).status).toBe(403);
    expect((await put({ kind: "cell", tenantId: "someone-else" })).status).toBe(403);
  });

  it.each([
    ["a tenant id", { ...cell("2026-08", "software", 100), tenantId: "tenant-b" }],
    ["an org id", { ...cell("2026-08", "software", 100), orgId: "org_tidepool" }],
    ["an unknown category", cell("2026-08", "marketing", 100)],
    ["a negative amount", cell("2026-08", "software", -100)],
    ["a decimal amount", cell("2026-08", "software", 100.5)],
    ["an amount written as text", cell("2026-08", "software", "100")],
    ["an amount above the cap", cell("2026-08", "software", 100_000_001)],
    ["a tenant id on a removal", { ...cell("2026-08", "software", null), tenantId: "tenant-b" }],
    ["an org id on a removal", { ...cell("2026-08", "software", null), orgId: "org_tidepool" }],
    ["no amount at all, which is not a removal", { kind: "cell", month: "2026-08", category: "software" }],
    ["the text null for the amount", cell("2026-08", "software", "null")],
    ["a removal of an unknown category", cell("2026-08", "marketing", null)],
    ["a removal for a month 13", cell("2026-13", "software", null)],
    ["a month 13", cell("2026-13", "software", 100)],
    ["a full date for the month", cell("2026-08-01", "software", 100)],
    ["no kind", { month: "2026-08", category: "software", amountCents: 100 }],
    ["an unknown kind", { ...cell("2026-08", "software", 100), kind: "delete" }],
    ["an empty object", {}],
    ["null", null],
  ])("rejects %s with 400 INVALID_INPUT and writes nothing", async (_label, body) => {
    const rowsBefore = await sheet(solenne.tenantId);
    const otherBefore = await sheet(tidepool.tenantId);
    const res = await put(body);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("INVALID_INPUT");
    expect(await sheet(solenne.tenantId)).toEqual(rowsBefore);
    expect(await sheet(tidepool.tenantId)).toEqual(otherBefore);
  });

  it("says what is wrong in a sentence the cost sheet can show beside the cell", async () => {
    const message = async (body: unknown) => (await (await put(body)).json()).message;
    expect(await message(cell("2026-08", "software", 100_000_001))).toBe("A cost can be at most $1,000,000.00 in a month.");
    expect(await message(cell("2025-08", "software", 100))).toBe("Costs can be entered from September 2025 to November 2026; August 2025 is outside that.");
    expect(await message(cell("2025-08", "software", null))).toBe("Costs can be entered from September 2025 to November 2026; August 2025 is outside that.");
    expect(await message({ kind: "assumptions", cardFeeBps: 1001, cardFeeFixedCents: 30, fulfilmentCentsPerOrder: 450 })).toBe("The card fee rate can be at most 10%.");
    expect(await message({ kind: "delete" })).toBe("The edit must be a cost cell or the assumptions.");
    expect(await message({ ...cell("2026-08", "software", 100), tenantId: "tenant-b" })).toMatch(/Unrecognized key/);
  });

  it("rejects a body that is not JSON, and one that is far too large", async () => {
    const res = await send("amount=100");
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("INVALID_INPUT");
    const big = new Request("https://x.test/api/ebitda/costs", { method: "PUT", headers: { "content-type": "application/json", "content-length": "200000" }, body: "{}" });
    expect((await PUT(big)).status).toBe(400);
  });

  it("rejects a month outside the data window and writes nothing; the first synced month and the current month are inside it", async () => {
    const rowsBefore = await sheet(solenne.tenantId);
    for (const month of ["2025-08", "2020-01", "2026-12", "2027-06"]) {
      const res = await put(cell(month, "software", 100));
      expect(res.status, month).toBe(400);
      expect((await res.json()).error).toBe("INVALID_INPUT");
    }
    expect(await sheet(solenne.tenantId)).toEqual(rowsBefore);
    expect((await put(cell("2025-09", "other", 100))).status).toBe(200); // Solenne's first order is in 2025-09
    expect((await put(cell("2026-11", "other", 100))).status).toBe(200); // today is 2026-11-01 on the demo clock
  });

  it("refuses an edit, of a cell or of the rates, when the store is disconnected or the brand has none, and writes nothing", async () => {
    const rowsBefore = await sheet(solenne.tenantId);
    const ratesBefore = await rates(solenne.tenantId);
    const edits = [cell("2026-08", "software", 100), { kind: "assumptions", cardFeeBps: 100, cardFeeFixedCents: 10, fulfilmentCentsPerOrder: 100 }];
    for (const shop of [{ ...solenne.shop!, status: "disconnected" as const }, null]) {
      m.ctx.mockResolvedValue(as(solenne, "gc_partner", { shop }));
      for (const edit of edits) expect((await (await put(edit)).json()).error).toBe("STORE_DISCONNECTED");
    }
    expect(await sheet(solenne.tenantId)).toEqual(rowsBefore);
    expect(await rates(solenne.tenantId)).toEqual(ratesBefore);
  });
});

describe("PUT /api/ebitda/costs: removing a cell (a null amount)", () => {
  it.each(["gc_partner", "gc_admin"] as const)("a %s removes the cell: the month's costs drop by its amount, and nothing else moves", async (role) => {
    m.ctx.mockResolvedValue(as(solenne, role));
    const before = await monthOf(solenne, "2026-08");
    const julyBefore = await monthOf(solenne, "2026-07");
    const rowsBefore = await sheet(solenne.tenantId);
    const gone = softwareOf(before);

    const res = await put(cell("2026-08", "software", null));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const after = await monthOf(solenne, "2026-08");
    expect(after.operatingCosts.some((c) => c.category === "software")).toBe(false);
    expect(after.operatingCostsCents).toBe(before.operatingCostsCents - gone);
    expect(after.ebitdaCents).toBe(before.ebitdaCents + gone); // the bridge still adds up: only the operating-cost line moved
    expect(after).toMatchObject({ operatingCostsEntered: true, ebitdaIsCeiling: false }); // the contractors cell is still there
    expect(await monthOf(solenne, "2026-07")).toEqual(julyBefore);
    expect(await sheet(solenne.tenantId)).toEqual(rowsBefore.filter((r) => !(r.month === "2026-08" && r.category === "software")));
  });

  it("removes a cell a person edited as well as a seeded one", async () => {
    await put(cell("2026-08", "software", 99_900));
    expect((await sheet(solenne.tenantId)).find((r) => r.month === "2026-08" && r.category === "software")).toMatchObject({ amountCents: 99_900, source: "manual" });
    expect((await put(cell("2026-08", "software", null))).status).toBe(200);
    expect((await sheet(solenne.tenantId)).some((r) => r.month === "2026-08" && r.category === "software")).toBe(false);
  });

  it("puts a month back to nothing entered once every cell is removed, which a zero would not", async () => {
    const before = await monthOf(solenne, "2026-08");
    for (const c of before.operatingCosts) expect((await put(cell("2026-08", c.category, null))).status).toBe(200);
    expect(await monthOf(solenne, "2026-08")).toMatchObject({ operatingCostsEntered: false, operatingCosts: [], operatingCostsCents: 0, ebitdaIsCeiling: true });

    // A zero is an amount: the same month typed in as 0 is firm, so it takes a removal to get back to a ceiling.
    expect((await put(cell("2026-08", "software", 0))).status).toBe(200);
    expect(await monthOf(solenne, "2026-08")).toMatchObject({ operatingCostsEntered: true, operatingCostsCents: 0, ebitdaIsCeiling: false });
    expect((await put(cell("2026-08", "software", null))).status).toBe(200);
    expect(await monthOf(solenne, "2026-08")).toMatchObject({ operatingCostsEntered: false, ebitdaIsCeiling: true });
  });

  it("lets a reload of the seed file bring a removed cell back, which an edit alone could never do", async () => {
    const seeded = softwareOf(await monthOf(solenne, "2026-08"));
    await put(cell("2026-08", "software", seeded + 5_000));
    await loadCosts(db, solenne.tenantId, readFixtureFile("solenne", "costs.csv"));
    expect(softwareOf(await monthOf(solenne, "2026-08"))).toBe(seeded + 5_000); // a reload never overwrites an edited cell

    await put(cell("2026-08", "software", null));
    await loadCosts(db, solenne.tenantId, readFixtureFile("solenne", "costs.csv"));
    expect(softwareOf(await monthOf(solenne, "2026-08"))).toBe(seeded);
    expect((await sheet(solenne.tenantId)).find((r) => r.month === "2026-08" && r.category === "software")).toMatchObject({ amountCents: seeded, source: "fixture" });
  });

  it("removing a cell that is not there succeeds and changes nothing", async () => {
    const rowsBefore = await sheet(solenne.tenantId);
    expect((await monthOf(solenne, "2026-08")).operatingCosts.some((c) => c.category === "rent")).toBe(false);
    const res = await put(cell("2026-08", "rent", null));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(await sheet(solenne.tenantId)).toEqual(rowsBefore);
  });

  it("refuses a client viewer, and a request with no session, with 403 and deletes nothing", async () => {
    const rowsBefore = await sheet(solenne.tenantId);
    m.ctx.mockResolvedValue(as(solenne, "client_viewer"));
    const res = await put(cell("2026-08", "software", null));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "FORBIDDEN" });
    m.ctx.mockRejectedValue(new Error("no session"));
    expect((await put(cell("2026-08", "software", null))).status).toBe(403);
    expect(await sheet(solenne.tenantId)).toEqual(rowsBefore);
  });

  it("takes the same month window as a save: a removal outside it is refused and the cell stays", async () => {
    await db.insert(operatingCosts).values({ tenantId: solenne.tenantId, month: "2020-01", category: "software", amountCents: 100, source: "fixture" });
    const rowsBefore = await sheet(solenne.tenantId);
    for (const month of ["2020-01", "2026-12", "2027-06"]) {
      const res = await put(cell(month, "software", null));
      expect(res.status, month).toBe(400);
      expect((await res.json()).error).toBe("INVALID_INPUT");
    }
    expect(await sheet(solenne.tenantId)).toEqual(rowsBefore);
  });

  it("refuses a removal when the store is disconnected or the brand has none, and deletes nothing", async () => {
    const rowsBefore = await sheet(solenne.tenantId);
    for (const shop of [{ ...solenne.shop!, status: "disconnected" as const }, null]) {
      m.ctx.mockResolvedValue(as(solenne, "gc_partner", { shop }));
      expect((await (await put(cell("2026-08", "software", null))).json()).error).toBe("STORE_DISCONNECTED");
    }
    expect(await sheet(solenne.tenantId)).toEqual(rowsBefore);
  });

  it("a removal for Solenne never touches Tidepool's cell for the same month and category, and the other way round", async () => {
    const tidepoolBefore = (await getEbitda(tidepool, RANGE, { db })).data;
    const tidepoolRows = await sheet(tidepool.tenantId);
    expect(tidepoolRows.some((r) => r.month === "2026-08" && r.category === "software")).toBe(true);

    expect((await put(cell("2026-08", "software", null))).status).toBe(200);
    expect((await getEbitda(tidepool, RANGE, { db })).data).toEqual(tidepoolBefore);
    expect(await sheet(tidepool.tenantId)).toEqual(tidepoolRows);

    const solenneRows = await sheet(solenne.tenantId);
    const solenneBefore = (await getEbitda(solenne, RANGE, { db })).data;
    m.ctx.mockResolvedValue(as(tidepool, "gc_partner"));
    expect((await put(cell("2026-08", "software", null))).status).toBe(200);
    expect((await sheet(tidepool.tenantId)).some((r) => r.month === "2026-08" && r.category === "software")).toBe(false);
    expect(await sheet(solenne.tenantId)).toEqual(solenneRows);
    expect((await getEbitda(solenne, RANGE, { db })).data).toEqual(solenneBefore);
  });
});

describe("PUT /api/ebitda/costs: the assumptions", () => {
  it("saving assumptions changes the card fees and the fulfilment on the next getEbitda, and marks them manual", async () => {
    const before = await monthOf(solenne, "2026-08");
    const res = await put({ kind: "assumptions", cardFeeBps: 350, cardFeeFixedCents: 40, fulfilmentCentsPerOrder: 500 });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const { data } = await getEbitda(solenne, RANGE, { db });
    const after = data.months.find((x) => x.month === "2026-08")!;
    expect(after.cardFeesCents).toBe(Math.round((350 / 10_000) * after.netSalesCents + 40 * after.orders));
    expect(after.fulfilmentCents).toBe(500 * after.orders);
    expect(after.cardFeesCents).not.toBe(before.cardFeesCents);
    expect(after.netSalesCents).toBe(before.netSalesCents);
    expect(data.cardFeeRate).toBeCloseTo(0.035, 10);
    expect(data.cardFeeFixedCents).toBe(40);
    expect(data.fulfilmentCentsPerOrder).toBe(500);
    expect(data.assumptionsSource).toBe("manual");
    expect(await rates(solenne.tenantId)).toMatchObject([{ cardFeeBps: 350, cardFeeFixedCents: 40, fulfilmentCentsPerOrder: 500, source: "manual", updatedBy: "user_gc_partner" }]);
  });

  it("takes zero for every rate", async () => {
    expect((await put({ kind: "assumptions", cardFeeBps: 0, cardFeeFixedCents: 0, fulfilmentCentsPerOrder: 0 })).status).toBe(200);
    expect(await rates(solenne.tenantId)).toMatchObject([{ cardFeeBps: 0, cardFeeFixedCents: 0, fulfilmentCentsPerOrder: 0 }]);
  });

  it.each([
    ["a tenant id", { kind: "assumptions", cardFeeBps: 290, cardFeeFixedCents: 30, fulfilmentCentsPerOrder: 450, tenantId: "tenant-b" }],
    ["a card fee above 10%", { kind: "assumptions", cardFeeBps: 1001, cardFeeFixedCents: 30, fulfilmentCentsPerOrder: 450 }],
    ["a fixed fee above $5.00", { kind: "assumptions", cardFeeBps: 290, cardFeeFixedCents: 501, fulfilmentCentsPerOrder: 450 }],
    ["fulfilment above $100.00 an order", { kind: "assumptions", cardFeeBps: 290, cardFeeFixedCents: 30, fulfilmentCentsPerOrder: 10_001 }],
    ["a negative rate", { kind: "assumptions", cardFeeBps: -1, cardFeeFixedCents: 30, fulfilmentCentsPerOrder: 450 }],
    ["a decimal rate", { kind: "assumptions", cardFeeBps: 2.9, cardFeeFixedCents: 30, fulfilmentCentsPerOrder: 450 }],
    ["a missing rate", { kind: "assumptions", cardFeeBps: 290, cardFeeFixedCents: 30 }],
  ])("rejects %s with 400 INVALID_INPUT and leaves the rates as they were", async (_label, body) => {
    const ratesBefore = await rates(solenne.tenantId);
    const res = await put(body);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("INVALID_INPUT");
    expect(await rates(solenne.tenantId)).toEqual(ratesBefore);
  });
});

describe("PUT /api/ebitda/costs: one brand at a time", () => {
  it("an edit for Solenne never changes Tidepool's figures, rows or rates", async () => {
    const tidepoolBefore = (await getEbitda(tidepool, RANGE, { db })).data;
    const tidepoolRows = await sheet(tidepool.tenantId);
    const tidepoolRates = await rates(tidepool.tenantId);
    const solenneBefore = await monthOf(solenne, "2026-08");

    await put(cell("2026-08", "software", softwareOf(solenneBefore) + 12_345)); // Tidepool has a software line in the same month
    await put({ kind: "assumptions", cardFeeBps: 400, cardFeeFixedCents: 50, fulfilmentCentsPerOrder: 900 });

    expect((await monthOf(solenne, "2026-08")).operatingCostsCents).toBe(solenneBefore.operatingCostsCents + 12_345); // it did land on Solenne
    expect((await getEbitda(tidepool, RANGE, { db })).data).toEqual(tidepoolBefore);
    expect(await sheet(tidepool.tenantId)).toEqual(tidepoolRows);
    expect(await rates(tidepool.tenantId)).toEqual(tidepoolRates);
  });

  it("and the other way round: a Tidepool partner's edit lands on Tidepool only", async () => {
    const solenneBefore = (await getEbitda(solenne, RANGE, { db })).data;
    const solenneRows = await sheet(solenne.tenantId);
    const tidepoolBefore = await monthOf(tidepool, "2026-08");
    m.ctx.mockResolvedValue(as(tidepool, "gc_partner"));

    expect((await put(cell("2026-08", "software", softwareOf(tidepoolBefore) + 777))).status).toBe(200);

    expect((await monthOf(tidepool, "2026-08")).operatingCostsCents).toBe(tidepoolBefore.operatingCostsCents + 777);
    expect((await getEbitda(solenne, RANGE, { db })).data).toEqual(solenneBefore);
    expect(await sheet(solenne.tenantId)).toEqual(solenneRows);
  });

  it("a body that names another brand is refused, not obeyed: the session decides", async () => {
    const tidepoolRows = await sheet(tidepool.tenantId);
    const solenneRows = await sheet(solenne.tenantId);
    for (const key of ["tenantId", "orgId", "shop", "brand"]) {
      for (const amountCents of [999, null]) {
        const res = await put({ ...cell("2026-08", "software", amountCents), [key]: key === "orgId" ? tidepool.orgId : tidepool.tenantId });
        expect(res.status, `${key} with ${amountCents}`).toBe(400);
      }
    }
    expect(await sheet(tidepool.tenantId)).toEqual(tidepoolRows);
    expect(await sheet(solenne.tenantId)).toEqual(solenneRows);
  });
});
