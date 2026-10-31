import { MockLanguageModelV4, convertArrayToReadableStream } from "ai/test";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import type { Db } from "../db/client";
import { agentRuns, briefs, shopConnections, tenants } from "../db/schema";
import { createTestDb } from "../db/test-db";
import { AppError } from "../errors";
import { NotAllowedError } from "../memory/store";
import type { TenantContext } from "../tenancy/context";
import { deliverBrief } from "./deliver";
import { briefQuestion, generateBrief, mondayOf, type BriefTenant } from "./generate";
import { generateAllBriefs } from "./run";
import { approveBrief, listBriefs } from "./store";

let db: Db;
let tenant: BriefTenant;
let ctx: TenantContext;
const WEEK = "2026-10-26";
const as = (role: TenantContext["role"], userId = "user_gc"): TenantContext => ({ ...ctx, role, userId });

const usage = { inputTokens: { total: 100, noCache: 100, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 20, text: 20, reasoning: undefined } };
const say = (text: string) => ({
  stream: convertArrayToReadableStream([
    { type: "stream-start" as const, warnings: [] },
    { type: "text-start" as const, id: "t" },
    { type: "text-delta" as const, id: "t", delta: text },
    { type: "text-end" as const, id: "t" },
    { type: "finish" as const, finishReason: { unified: "stop" as const, raw: "end_turn" }, usage },
  ]),
});
const scripted = (...results: unknown[]) => new MockLanguageModelV4({ doStream: results as never });

const shop = { domain: "a.myshopify.com", timezone: "America/New_York", currency: "USD", status: "connected" as const };
const insertBrief = async (status: "draft" | "blocked" | "approved", week = WEEK, tenantId = tenant.id) => {
  const [row] = await db.insert(briefs).values({ tenantId, weekStart: week, status, body: "A short brief.", unmatched: status === "blocked" ? ["$9,999"] : [] }).returning();
  return row!;
};
const stored = async (id: string) => (await db.select().from(briefs).where(eq(briefs.id, id)))[0]!;

let info: MockInstance;
beforeEach(async () => {
  db = await createTestDb();
  const [t] = await db.insert(tenants).values({ orgId: "org_a", name: "Alpha" }).returning();
  tenant = { id: t!.id, orgId: "org_a", name: "Alpha", shop };
  ctx = { tenantId: t!.id, orgId: "org_a", userId: "user_gc", role: "gc_partner", shop };
  info = vi.spyOn(console, "info").mockImplementation(() => undefined);
}, 60_000);
afterEach(() => vi.restoreAllMocks());

describe("drafting a brief through the agent loop", () => {
  it("stores a draft when the number checker finds nothing unmatched, as the cron user", async () => {
    const model = scripted(say("A steady week. Watch stock on the best sellers."));
    const res = await generateBrief(db, tenant, WEEK, { model, env: {} });
    expect(res.outcome).toBe("draft");
    expect(await stored(res.briefId!)).toMatchObject({ status: "draft", weekStart: WEEK, unmatched: [], delivered: false, approvedAt: null });
    expect(JSON.stringify(model.doStreamCalls[0]!.prompt)).toContain("Monday brief for the week starting October 26, 2026");
    const [run] = await db.select().from(agentRuns);
    expect(run).toMatchObject({ tenantId: tenant.id, userId: "cron", role: "client_viewer" });
  });

  it("stores a blocked brief with the unmatched figures when the repair turn does not fix them", async () => {
    const model = scripted(say("Net sales were $9,999 this month."), say("Net sales were $9,999 so far."));
    const res = await generateBrief(db, tenant, WEEK, { model, env: {} });
    expect(res.outcome).toBe("blocked");
    expect(model.doStreamCalls).toHaveLength(2); // the one repair turn
    expect(await stored(res.briefId!)).toMatchObject({ status: "blocked", unmatched: ["$9,999"] });
  });

  it("writes one brief per brand per week: a second run skips without calling the model", async () => {
    await generateBrief(db, tenant, WEEK, { model: scripted(say("A steady week.")), env: {} });
    const again = scripted();
    expect((await generateBrief(db, tenant, WEEK, { model: again, env: {} })).outcome).toBe("exists");
    expect(again.doStreamCalls).toHaveLength(0);
    expect(await db.select().from(briefs)).toHaveLength(1);
  });

  it("asks a fixed question for the Monday of the week the job ran", () => {
    expect(mondayOf(new Date("2026-11-02T06:00:00Z"))).toBe("2026-11-02");
    expect(mondayOf(new Date("2026-11-04T06:00:00Z"))).toBe("2026-11-02");
    expect(briefQuestion("2026-11-02")).toContain("Under 150 words");
  });
});

describe("the weekly job", () => {
  it("drafts for connected brands only, counts the result, and one brand failing does not stop the rest", async () => {
    const [b, off] = await db.insert(tenants).values([{ orgId: "org_b", name: "Beta" }, { orgId: "org_c", name: "Gamma" }]).returning();
    await db.insert(shopConnections).values([
      { tenantId: tenant.id, shopDomain: "a.myshopify.com", timezone: "UTC", currency: "USD" },
      { tenantId: b!.id, shopDomain: "b.myshopify.com", timezone: "UTC", currency: "USD" },
      { tenantId: off!.id, shopDomain: "c.myshopify.com", timezone: "UTC", currency: "USD", status: "disconnected" },
    ]);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    let calls = 0;
    const model = new MockLanguageModelV4({
      doStream: async () => {
        if (++calls === 1) throw new Error("model down");
        return say("A steady week.") as never;
      },
    });
    const counts = await generateAllBriefs(db, { model, env: {}, now: new Date("2026-11-02T06:00:00Z") });
    expect(counts).toEqual({ drafted: 1, blocked: 0, skipped: 0, failed: 1 });
    expect(await db.select().from(briefs)).toHaveLength(1);
  });
});

describe("approval", () => {
  it("is for Growth Capital admins and partners: a client viewer is refused and nothing changes or goes out", async () => {
    const b = await insertBrief("draft");
    await expect(approveBrief(db, as("client_viewer"), b.id, {})).rejects.toBeInstanceOf(NotAllowedError);
    expect(await stored(b.id)).toMatchObject({ status: "draft", delivered: false, approvedBy: null });
    expect(info).not.toHaveBeenCalled();
  });

  it("never delivers a brief that was not approved", async () => {
    const b = await insertBrief("draft");
    await expect(deliverBrief(db, ctx, b, {})).rejects.toBeInstanceOf(AppError);
    expect(await stored(b.id)).toMatchObject({ delivered: false });
    expect(info).not.toHaveBeenCalled();
  });

  it("refuses a blocked brief", async () => {
    const b = await insertBrief("blocked");
    await expect(approveBrief(db, ctx, b.id, {})).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(await stored(b.id)).toMatchObject({ status: "blocked", delivered: false });
    expect(info).not.toHaveBeenCalled();
  });

  it("approves a draft once, delivers it once (the log line, without the body), and ignores a second approval", async () => {
    const b = await insertBrief("draft");
    expect(await approveBrief(db, ctx, b.id, {})).toBe("approved");
    expect(await approveBrief(db, as("gc_admin", "user_other"), b.id, {})).toBe("already_approved");
    expect(await stored(b.id)).toMatchObject({ status: "approved", approvedBy: "user_gc", delivered: true });
    expect(info).toHaveBeenCalledTimes(1);
    const line = String(info.mock.calls[0]!.join(" "));
    expect(line).toContain("Alpha");
    expect(line).toContain(WEEK);
    expect(line).not.toContain("A short brief.");
  });

  it("is a dry run for a reviewer: logged, not delivered, and the brief stays a draft", async () => {
    const b = await insertBrief("draft");
    expect(await approveBrief(db, as("gc_partner", "user_rev"), b.id, { REVIEWER_USER_IDS: "user_rev" })).toBe("approved");
    expect(await stored(b.id)).toMatchObject({ status: "draft", delivered: false }); // still a draft for the real approver
    expect(String(info.mock.calls[0]!.join(" "))).toContain("dry run");
  });

  it("belongs to one brand: another brand's session can't approve or list it", async () => {
    const [o] = await db.insert(tenants).values({ orgId: "org_o", name: "Other" }).returning();
    const other: TenantContext = { ...ctx, tenantId: o!.id, orgId: "org_o" };
    const b = await insertBrief("draft");
    expect(await approveBrief(db, other, b.id, {})).toBeNull();
    expect(await listBriefs(db, other)).toEqual([]);
    expect(await stored(b.id)).toMatchObject({ status: "draft" });
  });

  it("shows a client viewer only approved briefs", async () => {
    await insertBrief("draft", "2026-10-19");
    await insertBrief("blocked", "2026-10-12");
    await insertBrief("approved", WEEK);
    expect((await listBriefs(db, ctx)).map((b) => b.status)).toEqual(["approved", "draft", "blocked"]);
    expect((await listBriefs(db, as("client_viewer"))).map((b) => b.status)).toEqual(["approved"]);
  });
});
