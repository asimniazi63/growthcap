import { readFileSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../db/client";
import { documents, planTargets, plans, tenants } from "../db/schema";
import { createTestDb } from "../db/test-db";
import { NotAllowedError } from "../memory/store";
import { loadPlan } from "../pace/gap";
import type { TenantContext } from "../tenancy/context";
import { loadPlan as loadPlanFixture, readFixtureFile } from "../../scripts/fixtures/load-pace";
import { MAX_BYTES, confirmDocument, discardDocument, getDocument, listDocuments, readDocument, uploadDocument } from "./store";
import { SOLENNE_PASS1, SOLENNE_PASS2, scriptedReader } from "./test-support";

let db: Db;
let ctx: TenantContext;
let other: TenantContext;
const as = (c: TenantContext, role: TenantContext["role"], userId = "u1"): TenantContext => ({ ...c, role, userId });
const sowBytes = () => new Uint8Array(readFileSync(new URL("../../fixtures/solenne/sow.pdf", import.meta.url)));
const text = (s: string) => new TextEncoder().encode(s);
const upload = (c = ctx, kind = "sow", label = "sow.pdf", bytes: Uint8Array = sowBytes()) => uploadDocument(db, c, { kind, label, bytes });

beforeEach(async () => {
  db = await createTestDb();
  const rows = await db.insert(tenants).values([{ orgId: "org_a", name: "A" }, { orgId: "org_b", name: "B" }]).returning({ id: tenants.id });
  ctx = { tenantId: rows[0]!.id, orgId: "org_a", userId: "u1", role: "gc_partner", shop: null };
  other = { ...ctx, tenantId: rows[1]!.id, orgId: "org_b" };
  await loadPlanFixture(db, ctx.tenantId, readFixtureFile("solenne", "plan.csv"), "Fixture plan");
}, 60_000);

describe("upload: type, size and magic-byte limits", () => {
  it("keeps the text of each page and not the file", async () => {
    const doc = await upload();
    expect(doc).toMatchObject({ kind: "sow", status: "uploaded", pageCount: 2, targetCount: null });
    const [row] = await db.select().from(documents).where(eq(documents.id, doc.id));
    expect(row!.pages[0]).toContain("Key performance targets");
    expect(Object.keys(row!)).not.toContain("bytes");
  });

  it("accepts a plan sheet as one page of text", async () => {
    const doc = await upload(ctx, "plan_sheet", "plan.csv", text(readFixtureFile("solenne", "plan.csv")));
    expect(doc.pageCount).toBe(1);
  });

  it("checks what the file is, not only its name", async () => {
    const bad = (kind: string, label: string, bytes: Uint8Array) => expect(upload(ctx, kind, label, bytes)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await bad("sow", "sow.pdf", text("just some text, not a PDF")); // a PDF name, no %PDF- header
    await bad("sow", "sow.docx", sowBytes()); // a PDF, but not named like one
    await bad("plan_sheet", "plan.csv", sowBytes()); // a PDF passed off as a CSV
    await bad("plan_sheet", "plan.csv", new Uint8Array([0x6d, 0x6f, 0x6e, 0x74, 0x68, 0x00, 0xff])); // not text
    await bad("sow", "sow.pdf", new Uint8Array(0));
    await bad("image", "x.png", sowBytes());
  });

  it("refuses a file over 4 MB", async () => {
    const big = new Uint8Array(MAX_BYTES + 1);
    big.set(text("%PDF-1.4"));
    await expect(upload(ctx, "sow", "big.pdf", big)).rejects.toMatchObject({ code: "INVALID_INPUT", message: expect.stringContaining("4 MB") });
    expect(await listDocuments(db, ctx)).toEqual([]);
  });
});

describe("roles and brands", () => {
  it("lets a Growth Capital admin or partner in and nobody else", async () => {
    const viewer = as(ctx, "client_viewer");
    const doc = await upload();
    await expect(upload(viewer)).rejects.toBeInstanceOf(NotAllowedError);
    await expect(listDocuments(db, viewer)).rejects.toBeInstanceOf(NotAllowedError);
    await expect(getDocument(db, viewer, doc.id)).rejects.toBeInstanceOf(NotAllowedError);
    await expect(readDocument(db, viewer, doc.id, { model: scriptedReader({}) })).rejects.toBeInstanceOf(NotAllowedError);
    await expect(confirmDocument(db, viewer, doc.id)).rejects.toBeInstanceOf(NotAllowedError);
    await expect(discardDocument(db, viewer, doc.id)).rejects.toBeInstanceOf(NotAllowedError);
    expect(await upload(as(ctx, "gc_admin", "u2"))).toMatchObject({ status: "uploaded" });
  });

  it("belongs to one brand: another brand can't read, confirm or discard it", async () => {
    const doc = await upload();
    expect(await getDocument(db, other, doc.id)).toBeNull();
    expect(await readDocument(db, other, doc.id, { model: scriptedReader({}) })).toBeNull();
    expect(await confirmDocument(db, other, doc.id)).toBeNull();
    expect(await discardDocument(db, other, doc.id)).toBe(false);
    expect(await listDocuments(db, other)).toEqual([]);
  });
});

describe("read, review and confirm", () => {
  async function readOne() {
    const doc = await upload();
    const detail = await readDocument(db, ctx, doc.id, { model: scriptedReader(SOLENNE_PASS1, SOLENNE_PASS2) });
    return { doc, detail: detail! };
  }

  it("shows the proposal as changes against the active plan", async () => {
    const { detail } = await readOne();
    expect(detail.status).toBe("read");
    expect(detail.currentPlan?.label).toBe("Fixture plan");
    const oct = detail.changes.find((c) => c.month === "2026-10" && c.metric === "net_sales")!;
    expect(oct).toMatchObject({ current: 650688, proposed: 650700, page: 1 });
    expect(detail.changes.find((c) => c.month === "2026-11" && c.metric === "returning_customer_rate")).toMatchObject({ current: 0.3643, proposed: 0.45 });
    expect(detail.proposal!.unapplied).toHaveLength(3);
  });

  it("swaps the active plan, laying the targets over the old ones, and keeps the old plan inactive", async () => {
    const before = await loadPlan(db, ctx.tenantId);
    const { doc } = await readOne();
    const done = await confirmDocument(db, as(ctx, "gc_admin", "u7"), doc.id);
    expect(done).not.toBeNull();

    const all = await db.select().from(plans).where(eq(plans.tenantId, ctx.tenantId));
    expect(all.filter((p) => p.active).map((p) => p.id)).toEqual([done!.planId]);
    expect(all.find((p) => p.id === before!.id)!.active).toBe(false);
    expect(all.find((p) => p.id === done!.planId)).toMatchObject({ source: "upload", label: "sow.pdf" });
    // the old plan's own targets are untouched
    expect(await db.select().from(planTargets).where(eq(planTargets.planId, before!.id))).toHaveLength(80);

    const now = await loadPlan(db, ctx.tenantId);
    expect(now!.id).toBe(done!.planId);
    expect(now!.targets.get("2026-11")).toMatchObject({ net_sales: 1043300, returning_customer_rate: 0.45, orders: 130 }); // changed, changed, kept
    expect(now!.targets.get("2026-09")).toEqual(before!.targets.get("2026-09")); // a month the SOW doesn't mention
    const [row] = await db.select().from(documents).where(eq(documents.id, doc.id));
    expect(row).toMatchObject({ status: "confirmed", planId: done!.planId, decidedBy: "u7" });
    expect(row!.decidedAt).toBeInstanceOf(Date);
  });

  it("does nothing the second time, and a decided document can't be discarded or read again", async () => {
    const { doc } = await readOne();
    expect(await confirmDocument(db, ctx, doc.id)).not.toBeNull();
    expect(await confirmDocument(db, ctx, doc.id)).toBeNull();
    expect(await discardDocument(db, ctx, doc.id)).toBe(false);
    await expect(readDocument(db, ctx, doc.id, { model: scriptedReader({}) })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(await db.select().from(plans).where(eq(plans.tenantId, ctx.tenantId))).toHaveLength(2);
    expect(await db.select().from(plans).where(and(eq(plans.tenantId, ctx.tenantId), eq(plans.active, true)))).toHaveLength(1);
  });

  it("a discarded document never changes the plan, and can't be confirmed", async () => {
    const { doc } = await readOne();
    expect(await discardDocument(db, ctx, doc.id)).toBe(true);
    expect(await confirmDocument(db, ctx, doc.id)).toBeNull();
    expect((await loadPlan(db, ctx.tenantId))!.label).toBe("Fixture plan");
  });

  it("a document that hasn't been read can't be confirmed", async () => {
    const doc = await upload();
    expect(await confirmDocument(db, ctx, doc.id)).toBeNull();
  });

  it("confirms a plan sheet read without a model", async () => {
    const doc = await upload(ctx, "plan_sheet", "q4.csv", text("month,net_sales,orders,new_customer_orders,aov,returning_customer_rate\n2026-12,1000000,100,50,9000,0.5\n"));
    const detail = await readDocument(db, ctx, doc.id);
    expect(detail!.changes).toHaveLength(5);
    await confirmDocument(db, ctx, doc.id);
    expect((await loadPlan(db, ctx.tenantId))!.targets.get("2026-12")).toMatchObject({ net_sales: 1000000, aov: 9000 });
  });
});
