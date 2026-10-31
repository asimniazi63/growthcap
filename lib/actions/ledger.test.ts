import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { Db } from "../db/client";
import { actions, shopConnections, tenants } from "../db/schema";
import { createTestDb } from "../db/test-db";
import { AppError } from "../errors";
import { NotAllowedError } from "../memory/store";
import type { TenantContext } from "../tenancy/context";
import { approveAction, getAction, hashPayload, listActions, proposeAction, registerExecutor, rejectAction } from "./ledger";
import { getExecutor } from "./registry";
import type { Executor, ProposeInput } from "./types";

const schema = z.strictObject({ note: z.string().min(1), value: z.number() });
type P = z.infer<typeof schema>;

const MUTATION = "mutation Fake($v: Int!) { fake(v: $v) { id userErrors { message } } }";
let runs: P[] = [];

// A stand-in for a real executor: it records what it was asked to run and sends one mutation through env.graphql.
const fake: Executor<P> = {
  kind: "annotation",
  schema,
  diff: async (p) => ({ summary: `Add the note "${p.note}"`, rows: [{ label: "Note", after: p.note }] }),
  mutations: (p) => [{ name: "fake", query: MUTATION, variables: { v: p.value } }],
  run: async (p, env) => {
    runs.push(p);
    return env.graphql(MUTATION, { v: p.value });
  },
};
registerExecutor(fake);

let db: Db;
let ctx: TenantContext;
let other: TenantContext;
const as = (c: TenantContext, role: TenantContext["role"], userId = c.userId): TenantContext => ({ ...c, role, userId });
const ok = () => vi.fn(async () => ({ fake: { id: "gid://shopify/Thing/1", userErrors: [] } }));

const propose = (c: TenantContext = ctx, over: Partial<ProposeInput> = {}) =>
  proposeAction(db, c, { kind: "annotation", title: "Add a note", payload: { note: "Launch week", value: 1 }, hypothesis: "It explains the spike.", metric: "net_sales", checkOn: "2026-11-14", ...over }, { today: "2026-11-01" });

beforeEach(async () => {
  runs = [];
  db = await createTestDb();
  const rows = await db.insert(tenants).values([{ orgId: "org_a", name: "A" }, { orgId: "org_b", name: "B" }]).returning({ id: tenants.id });
  ctx = { tenantId: rows[0]!.id, orgId: "org_a", userId: "u1", role: "gc_partner", shop: null };
  other = { ...ctx, tenantId: rows[1]!.id, orgId: "org_b" };
}, 60_000);

describe("action ledger: propose", () => {
  it("stores a proposal with a diff built on the server and the payload's hash, and runs nothing", async () => {
    const graphql = ok();
    const a = await propose();
    expect(a).toMatchObject({ kind: "annotation", status: "proposed", owner: "u1", dryRun: false, checkOn: "2026-11-14" });
    expect(a.diff.summary).toBe('Add the note "Launch week"');
    const [row] = await db.select().from(actions);
    expect(row!.payloadHash).toBe(hashPayload({ value: 1, note: "Launch week" })); // key order doesn't matter
    expect(runs).toEqual([]);
    expect(graphql).not.toHaveBeenCalled();
  });

  it("caps the title and refuses a payload that fails the strict schema or a bad check date", async () => {
    expect((await propose(ctx, { title: "x".repeat(300) })).title).toHaveLength(120);
    await expect(propose(ctx, { payload: { note: "n", value: 1, extra: true } })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(propose(ctx, { checkOn: "2026-10-31" })).rejects.toMatchObject({ code: "INVALID_INPUT" }); // before today
    await expect(propose(ctx, { checkOn: "2026-02-30" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(propose(ctx, { checkOn: "soon" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect((await propose(ctx, { checkOn: "2026-11-01", payload: { note: "today", value: 2 } })).checkOn).toBe("2026-11-01");
  });

  it("returns the open proposal when the same change is proposed twice", async () => {
    const a = await propose();
    const b = await propose();
    expect(b.id).toBe(a.id);
    expect(await listActions(db, ctx)).toHaveLength(1);
  });

  it("finds executors by kind through the registry", async () => {
    expect(await getExecutor("annotation")).toBe(fake);
  });
});

describe("action ledger: approve", () => {
  it("runs nothing until it is approved, and a rejected proposal never runs", async () => {
    const graphql = ok();
    const a = await propose();
    expect(runs).toEqual([]);
    expect((await rejectAction(db, ctx, a.id)).status).toBe("rejected");
    const again = await approveAction(db, ctx, a.id, { graphql });
    expect(again.status).toBe("rejected");
    expect(runs).toEqual([]);
    expect(graphql).not.toHaveBeenCalled();
  });

  it("runs the executor once on approval and records who approved and the result", async () => {
    const graphql = ok();
    const a = await propose();
    const done = await approveAction(db, as(ctx, "gc_admin", "boss"), a.id, { graphql, env: {} });
    expect(done).toMatchObject({ status: "done", dryRun: false, decidedBy: "boss", error: null });
    expect(done.result).toEqual({ fake: { id: "gid://shopify/Thing/1", userErrors: [] } });
    expect(runs).toEqual([{ note: "Launch week", value: 1 }]);
    expect(graphql).toHaveBeenCalledTimes(1);
  });

  it("refuses a payload that was changed after it was proposed", async () => {
    const graphql = ok();
    const a = await propose();
    await db.update(actions).set({ payload: { note: "Launch week", value: 999 } }).where(eq(actions.id, a.id));
    await expect(approveAction(db, ctx, a.id, { graphql })).rejects.toMatchObject({ code: "INVALID_INPUT", message: expect.stringContaining("changed after it was proposed") });
    await db.update(actions).set({ payload: { note: "Launch week", value: 1, extra: "x" } }).where(eq(actions.id, a.id));
    await expect(approveAction(db, ctx, a.id, { graphql })).rejects.toBeInstanceOf(AppError);
    expect(runs).toEqual([]);
    expect((await getAction(db, ctx, a.id)).status).toBe("proposed");
  });

  it("does nothing the second time, even when two approvals arrive together", async () => {
    const graphql = ok();
    const a = await propose();
    const [x, y] = await Promise.all([approveAction(db, ctx, a.id, { graphql }), approveAction(db, ctx, a.id, { graphql })]);
    expect([x.id, y.id]).toEqual([a.id, a.id]);
    const third = await approveAction(db, ctx, a.id, { graphql });
    expect(third.status).toBe("done");
    expect(runs).toHaveLength(1);
    expect(graphql).toHaveBeenCalledTimes(1);
  });

  it("records a reviewer's approval as a dry run and never calls Shopify", async () => {
    const graphql = ok();
    const a = await propose();
    const done = await approveAction(db, ctx, a.id, { graphql, env: { REVIEWER_USER_IDS: "someone, u1" } });
    expect(done).toMatchObject({ status: "done", dryRun: true });
    expect(done.result).toEqual({ dryRun: true, mutations: [{ name: "fake", query: MUTATION, variables: { v: 1 } }] });
    expect(runs).toEqual([]);
    expect(graphql).not.toHaveBeenCalled();
  });
});

describe("action ledger: who may decide", () => {
  it("lets only a Growth Capital admin or partner propose, approve or reject", async () => {
    const viewer = as(ctx, "client_viewer");
    await expect(propose(viewer)).rejects.toBeInstanceOf(NotAllowedError);
    const a = await propose();
    await expect(approveAction(db, viewer, a.id, { graphql: ok() })).rejects.toBeInstanceOf(NotAllowedError);
    await expect(rejectAction(db, viewer, a.id)).rejects.toBeInstanceOf(NotAllowedError);
    expect((await getAction(db, ctx, a.id)).status).toBe("proposed");
    await expect(listActions(db, viewer)).rejects.toBeInstanceOf(NotAllowedError); // the ledger is the agency's record
    await expect(getAction(db, viewer, a.id)).rejects.toBeInstanceOf(NotAllowedError);
  });

  it("keeps brands apart: another brand's id is not found, and its list is its own", async () => {
    const a = await propose();
    const graphql = ok();
    await expect(approveAction(db, other, a.id, { graphql })).rejects.toMatchObject({ code: "NO_DATA" });
    await expect(rejectAction(db, other, a.id)).rejects.toMatchObject({ code: "NO_DATA" });
    await expect(getAction(db, other, a.id)).rejects.toMatchObject({ code: "NO_DATA" });
    await expect(getAction(db, ctx, "not-a-uuid")).rejects.toMatchObject({ code: "NO_DATA" });
    expect(await listActions(db, other)).toEqual([]);
    expect(runs).toEqual([]);
    expect((await getAction(db, ctx, a.id)).status).toBe("proposed");
  });
});

describe("action ledger: failure", () => {
  it("records a failed run with its error and never keeps a token in it", async () => {
    const a = await propose();
    const boom: Executor<P> = { ...fake, run: async () => void (await Promise.reject(new Error("Shopify said no for token shpat_0123456789abcdef"))) };
    registerExecutor(boom);
    const failed = await approveAction(db, ctx, a.id, { graphql: ok() });
    registerExecutor(fake);
    expect(failed.status).toBe("failed");
    expect(failed.error).toContain("Shopify said no");
    expect(failed.error).not.toContain("shpat_");
    expect(failed.result).toBeUndefined();
  });

  it("treats userErrors and an errors array in the response as failure", async () => {
    const a = await propose();
    const refused = await approveAction(db, ctx, a.id, { graphql: vi.fn(async () => ({ fake: { userErrors: [{ field: ["input", "title"], message: "Title is too long" }] } })) });
    expect(refused).toMatchObject({ status: "failed", error: expect.stringContaining("Title is too long") });
    const b = await propose(ctx, { payload: { note: "second", value: 2 } });
    const errored = await approveAction(db, ctx, b.id, { graphql: vi.fn(async () => ({ errors: [{ message: "Access denied" }] })) });
    expect(errored).toMatchObject({ status: "failed", error: expect.stringContaining("Access denied") });
  });

  it("fails an approval cleanly when the store is disconnected", async () => {
    const a = await propose();
    const failed = await approveAction(db, ctx, a.id, { env: {} }); // no injected graphql: it looks for the connected shop
    expect(failed).toMatchObject({ status: "failed", error: expect.stringContaining("disconnected") });
    expect(runs).toEqual([]);
    await db.insert(shopConnections).values({ tenantId: ctx.tenantId, shopDomain: "x.myshopify.com", status: "disconnected", timezone: "UTC", currency: "USD" });
    const b = await propose(ctx, { payload: { note: "again", value: 3 } });
    expect((await approveAction(db, ctx, b.id, { env: {} })).status).toBe("failed");
  });
});
