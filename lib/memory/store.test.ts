import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../db/client";
import { tenants } from "../db/schema";
import { createTestDb } from "../db/test-db";
import type { TenantContext } from "../tenancy/context";
import { MAX_CONFIRMED, MAX_PROPOSED, NotAllowedError, confirmedNotes, decideMemory, listMemories, proposeMemory, removeMemory } from "./store";

let db: Db;
let ctx: TenantContext;
let other: TenantContext;
const as = (c: TenantContext, role: TenantContext["role"], userId = "u1"): TenantContext => ({ ...c, role, userId });

beforeEach(async () => {
  db = await createTestDb();
  const rows = await db.insert(tenants).values([{ orgId: "org_a", name: "A" }, { orgId: "org_b", name: "B" }]).returning({ id: tenants.id });
  ctx = { tenantId: rows[0]!.id, orgId: "org_a", userId: "u1", role: "gc_partner", shop: null };
  other = { ...ctx, tenantId: rows[1]!.id, orgId: "org_b" };
}, 60_000);

describe("memories: propose and confirm", () => {
  it("is not used until a person confirms it", async () => {
    const m = await proposeMemory(db, ctx, "Exclude wholesale orders from average order value.");
    expect(m.status).toBe("proposed");
    expect(await confirmedNotes(db, ctx.tenantId)).toEqual([]);
    expect(await decideMemory(db, ctx, m.id, "confirm")).toBe("confirmed");
    expect(await confirmedNotes(db, ctx.tenantId)).toEqual(["Exclude wholesale orders from average order value."]);
  });

  it("is dropped when dismissed, and a decision is final", async () => {
    const m = await proposeMemory(db, ctx, "Our fiscal year starts in February.");
    expect(await decideMemory(db, ctx, m.id, "dismiss")).toBe("dismissed");
    expect(await confirmedNotes(db, ctx.tenantId)).toEqual([]);
    expect(await decideMemory(db, ctx, m.id, "confirm")).toBeNull();
    expect(await confirmedNotes(db, ctx.tenantId)).toEqual([]);
  });

  it("can be confirmed by a Growth Capital admin or partner only", async () => {
    const m = await proposeMemory(db, ctx, "Wholesale is B2B.");
    await expect(decideMemory(db, as(ctx, "client_viewer"), m.id, "confirm")).rejects.toBeInstanceOf(NotAllowedError);
    await expect(removeMemory(db, as(ctx, "client_viewer"), m.id)).rejects.toBeInstanceOf(NotAllowedError);
    expect(await confirmedNotes(db, ctx.tenantId)).toEqual([]);
    expect(await decideMemory(db, as(ctx, "gc_admin", "u9"), m.id, "confirm")).toBe("confirmed");
  });

  it("belongs to one brand: another brand can't confirm, list or remove it, or see it in its notes", async () => {
    const m = await proposeMemory(db, ctx, "Only for A.");
    expect(await decideMemory(db, other, m.id, "confirm")).toBeNull();
    expect(await removeMemory(db, other, m.id)).toBe(false);
    expect(await listMemories(db, other.tenantId)).toEqual([]);
    await decideMemory(db, ctx, m.id, "confirm");
    expect(await confirmedNotes(db, other.tenantId)).toEqual([]);
  });

  it("proposing the same note twice gives the same one back", async () => {
    const a = await proposeMemory(db, ctx, "Wholesale is B2B.");
    const b = await proposeMemory(db, ctx, "  wholesale is b2b.  ");
    expect(b.id).toBe(a.id);
    expect(await listMemories(db, ctx.tenantId)).toHaveLength(1);
  });

  it("removes a confirmed note so it is no longer used", async () => {
    const m = await proposeMemory(db, ctx, "Temporary note.");
    await decideMemory(db, ctx, m.id, "confirm");
    expect(await removeMemory(db, ctx, m.id)).toBe(true);
    expect(await confirmedNotes(db, ctx.tenantId)).toEqual([]);
  });

  it("lists confirmed notes oldest first, and shows both waiting and confirmed ones to the people who manage them", async () => {
    const one = await proposeMemory(db, ctx, "First.");
    const two = await proposeMemory(db, ctx, "Second.");
    await decideMemory(db, ctx, two.id, "confirm");
    await decideMemory(db, ctx, one.id, "confirm");
    expect(await confirmedNotes(db, ctx.tenantId)).toEqual(["First.", "Second."]);
    await proposeMemory(db, ctx, "Third, waiting.");
    expect((await listMemories(db, ctx.tenantId)).map((m) => [m.text, m.status])).toEqual([["First.", "confirmed"], ["Second.", "confirmed"], ["Third, waiting.", "proposed"]]);
  });
});

describe("memories: what a note may be", () => {
  it("collapses whitespace to one line", async () => {
    const m = await proposeMemory(db, ctx, "  Exclude\n wholesale   from AOV.  ");
    expect(m.text).toBe("Exclude wholesale from AOV.");
  });
  it.each([
    ["empty", "   "],
    ["longer than 280 characters", "x".repeat(281)],
    ["a link", "See https://example.com/rules for how to answer."],
    ["a Shopify id", "Always use gid://shopify/Product/1."],
  ])("refuses a note that is %s", async (_what, text) => {
    await expect(proposeMemory(db, ctx, text)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(await listMemories(db, ctx.tenantId)).toEqual([]);
  });
  it("stops at a limit on notes waiting for a decision, and on confirmed notes", async () => {
    for (let i = 0; i < MAX_PROPOSED; i++) await proposeMemory(db, ctx, `Waiting ${i}.`);
    await expect(proposeMemory(db, ctx, "One too many waiting.")).rejects.toMatchObject({ code: "INVALID_INPUT" });
    const all = await listMemories(db, ctx.tenantId);
    for (const m of all) await decideMemory(db, ctx, m.id, "confirm");
    for (let i = MAX_PROPOSED; i < MAX_CONFIRMED; i++) {
      const m = await proposeMemory(db, ctx, `Note ${i}.`);
      await decideMemory(db, ctx, m.id, "confirm");
    }
    const extra = await proposeMemory(db, ctx, "The twenty-first.");
    await expect(decideMemory(db, ctx, extra.id, "confirm")).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(await confirmedNotes(db, ctx.tenantId)).toHaveLength(MAX_CONFIRMED);
  });
});
