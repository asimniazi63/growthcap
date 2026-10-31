import { and, count, eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { encryptSecret } from "../crypto/secrets";
import type { Db } from "../db/client";
import { orders, shopConnections, syncRuns, tenants } from "../db/schema";
import { createTestDb } from "../db/test-db";
import { fakeShopifyFor, readFixture } from "../../scripts/fixtures/load-db";
import { refreshAll } from "./cron";
import { beginSync, canResync, executeSync, startSync, STALE_RUN_MS } from "./run";
import { getSyncStatus } from "./status";
import type { GraphqlFn } from "./sync";

const { dataset } = readFixture("tidepool");
const fake = fakeShopifyFor(dataset);

let db: Db;
let a: string;
let b: string;

beforeAll(() => {
  process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
});

beforeEach(async () => {
  db = await createTestDb();
  const rows = await db
    .insert(tenants)
    .values([
      { orgId: "org_a", name: "A" },
      { orgId: "org_b", name: "B" },
    ])
    .returning();
  a = rows[0]!.id;
  b = rows[1]!.id;
  for (const [tenantId, shopDomain] of [[a, "a.myshopify.com"], [b, "b.myshopify.com"]] as const) {
    await db.insert(shopConnections).values({ tenantId, shopDomain, tokenEnc: encryptSecret("shpat_test"), scopes: "read_orders", timezone: "America/Los_Angeles", currency: "USD" });
  }
});

const runsOf = (tenantId: string) => db.select().from(syncRuns).where(eq(syncRuns.tenantId, tenantId));
const orderCount = async (tenantId: string) => (await db.select({ n: count() }).from(orders).where(eq(orders.tenantId, tenantId)))[0]!.n;
const broken: GraphqlFn = async () => {
  throw new Error("Shopify is unavailable");
};

describe("canResync", () => {
  it("lets GC admins and partners resync, and not a client viewer", () => {
    expect([canResync("gc_admin"), canResync("gc_partner"), canResync("client_viewer")]).toEqual([true, true, false]);
  });
});

describe("beginSync", () => {
  it("starts a run for a connected store", async () => {
    const r = await beginSync(db, a);
    expect(r).toMatchObject({ ok: true });
    expect(await runsOf(a)).toEqual([expect.objectContaining({ status: "running" })]);
  });

  it("refuses a second run while one is in progress, so a double click does not start two", async () => {
    await beginSync(db, a);
    expect(await beginSync(db, a)).toEqual({ ok: false, reason: "already_running" });
    expect(await runsOf(a)).toHaveLength(1);
    expect(await beginSync(db, b)).toMatchObject({ ok: true }); // another tenant is unaffected
  });

  it("treats a run that has shown no result for 15 minutes as abandoned and starts a new one", async () => {
    const start = new Date("2026-10-31T10:00:00Z");
    await beginSync(db, a, start);
    const later = new Date(start.getTime() + STALE_RUN_MS + 1000);
    expect(await beginSync(db, a, later)).toMatchObject({ ok: true });
    const runs = await runsOf(a);
    expect(runs.map((r) => r.status).sort()).toEqual(["failed", "running"]);
    expect(runs.find((r) => r.status === "failed")!.error).toMatch(/abandoned/);
  });

  it("will not start for a store that is disconnected or has no token", async () => {
    await db.update(shopConnections).set({ status: "disconnected", tokenEnc: null }).where(eq(shopConnections.tenantId, a));
    expect(await beginSync(db, a)).toEqual({ ok: false, reason: "not_connected" });
    expect(await runsOf(a)).toHaveLength(0);
  });
});

describe("executeSync", () => {
  it("fills the tenant's tables using the run that beginSync made, and marks it succeeded", async () => {
    const begun = await beginSync(db, a);
    if (!begun.ok) throw new Error("expected a run");
    const result = await executeSync(db, a, begun.runId, { graphql: fake });
    expect(result?.counts).toMatchObject({ orders: dataset.orders.length, products: dataset.products.length });
    expect(await orderCount(a)).toBe(dataset.orders.length);
    expect(await orderCount(b)).toBe(0);
    expect(await runsOf(a)).toEqual([expect.objectContaining({ id: begun.runId, status: "succeeded" })]);
  });

  it("records a failure on the run and does not throw, so a background sync can't crash the request", async () => {
    const begun = await beginSync(db, a);
    if (!begun.ok) throw new Error("expected a run");
    await expect(executeSync(db, a, begun.runId, { graphql: broken })).resolves.toBeNull();
    expect(await runsOf(a)).toEqual([expect.objectContaining({ status: "failed", error: "Shopify is unavailable" })]);
  });

  it("fails the run, without calling Shopify, when the store was disconnected in the meantime", async () => {
    const begun = await beginSync(db, a);
    if (!begun.ok) throw new Error("expected a run");
    await db.update(shopConnections).set({ status: "disconnected", tokenEnc: null }).where(eq(shopConnections.tenantId, a));
    let calls = 0;
    await executeSync(db, a, begun.runId, { graphql: (async () => void calls++) as unknown as GraphqlFn });
    expect(calls).toBe(0);
    expect(await runsOf(a)).toEqual([expect.objectContaining({ status: "failed", error: expect.stringMatching(/disconnected/i) })]);
  });
});

describe("startSync", () => {
  it("records the run now and hands the work to the scheduler instead of doing it", async () => {
    const queue: (() => Promise<void>)[] = [];
    const r = await startSync(db, a, (work) => void queue.push(work), { graphql: fake });
    expect(r).toMatchObject({ ok: true });
    expect(queue).toHaveLength(1);
    expect(await orderCount(a)).toBe(0);
    expect((await runsOf(a))[0]!.status).toBe("running");
    await queue[0]!();
    expect(await orderCount(a)).toBe(dataset.orders.length);
  });

  it("schedules nothing when a run is already going", async () => {
    await beginSync(db, a);
    const queue: unknown[] = [];
    expect(await startSync(db, a, (w) => void queue.push(w), { graphql: fake })).toEqual({ ok: false, reason: "already_running" });
    expect(queue).toHaveLength(0);
  });
});

describe("getSyncStatus", () => {
  it("reports counts, the dates the data covers, when it was synced and the last run", async () => {
    const empty = await getSyncStatus(db, a);
    expect(empty).toMatchObject({ counts: { orders: 0, products: 0 }, asOf: null, lastRun: null, running: false });

    const begun = await beginSync(db, a);
    if (!begun.ok) throw new Error("expected a run");
    expect((await getSyncStatus(db, a)).running).toBe(true);
    await executeSync(db, a, begun.runId, { graphql: fake });

    const s = await getSyncStatus(db, a);
    expect(s.counts).toMatchObject({
      orders: dataset.orders.length,
      refunds: dataset.refunds.length,
      products: dataset.products.length,
      variants: dataset.variants.length,
    });
    expect(s.counts.customers).toBe(new Set(dataset.orders.map((o) => o.customerGenId)).size);
    expect(s.firstOrderDate).toBe(dataset.orders[0]!.processedAt.slice(0, 10));
    expect(s.lastOrderDate).toBe(dataset.orders.at(-1)!.processedAt.slice(0, 10));
    expect(s.running).toBe(false);
    expect(s.lastRun).toMatchObject({ status: "succeeded" });
    expect(Date.parse(s.asOf!)).not.toBeNaN();
    expect((await getSyncStatus(db, b)).counts.orders).toBe(0);
  });

  it("shows why the last run failed", async () => {
    const begun = await beginSync(db, a);
    if (!begun.ok) throw new Error("expected a run");
    await executeSync(db, a, begun.runId, { graphql: broken });
    expect((await getSyncStatus(db, a)).lastRun).toMatchObject({ status: "failed", error: "Shopify is unavailable" });
  });
});

describe("refreshAll (the nightly job)", () => {
  it("syncs every connected store, each under its own tenant", async () => {
    const out = await refreshAll(db, { graphqlFor: () => fake });
    expect(out.map((o) => o.outcome)).toEqual(["synced", "synced"]);
    expect(await orderCount(a)).toBe(dataset.orders.length);
    expect(await orderCount(b)).toBe(dataset.orders.length);
  });

  it("carries on with the other stores when one fails, and says which failed", async () => {
    const out = await refreshAll(db, { graphqlFor: (shop) => (shop === "a.myshopify.com" ? broken : fake) });
    expect(out.find((o) => o.shopDomain === "a.myshopify.com")!.outcome).toBe("failed");
    expect(out.find((o) => o.shopDomain === "b.myshopify.com")!.outcome).toBe("synced");
    expect(await orderCount(b)).toBe(dataset.orders.length);
  });

  it("skips a store that is already syncing, and stores that are disconnected", async () => {
    await beginSync(db, a);
    await db.update(shopConnections).set({ status: "disconnected", tokenEnc: null }).where(and(eq(shopConnections.tenantId, b)));
    const out = await refreshAll(db, { graphqlFor: () => fake });
    expect(out).toEqual([expect.objectContaining({ shopDomain: "a.myshopify.com", outcome: "skipped_running" })]);
    expect(await orderCount(b)).toBe(0);
  });
});
