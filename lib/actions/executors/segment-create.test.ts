import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "../../db/client";
import { actions, orders, tenants } from "../../db/schema";
import { createTestDb } from "../../db/test-db";
import { AppError } from "../../errors";
import { NotAllowedError } from "../../memory/store";
import { addDays } from "../../metrics/dates";
import { SEGMENT_IDS, SEGMENTS, type SegmentId } from "../../segments/definitions";
import { shopifySegmentCaveat, shopifySegmentQuery } from "../../segments/shopify-query";
import type { TenantContext } from "../../tenancy/context";
import { approveAction, getAction, listActions, proposeAction, registerExecutor, rejectAction } from "../ledger";
import type { ExecEnv, ProposeInput } from "../types";
import { NO_SCOPE_MESSAGE, SEGMENT_NAME_MAX, segmentCreateExecutor as e } from "./segment-create";

let db: Db;
let ctx: TenantContext;
const ASOF = "2026-10-31";
const ago = (days: number) => addDays(ASOF, -days);
const good = { segment: "champions", name: "Champions (Oasis)" } as const;

// A few customers whose segments are known by hand: two champions, one at risk, one due to reorder, one one-and-done, plus a guest
// order that belongs to no customer.
const ORDERS: { customer: string | null; daysAgo: number[] }[] = [
  { customer: "CUST_A", daysAgo: [200, 100, 0] },
  { customer: "CUST_B", daysAgo: [150, 60, 10] },
  { customer: "CUST_C", daysAgo: [300, 200] }, // last order 200 days ago, two orders: at risk
  { customer: "CUST_D", daysAgo: [130, 70] }, // a 60-day gap and 70 days since the last: due to reorder
  { customer: "CUST_E", daysAgo: [100] }, // one order, 100 days ago: one and done
  { customer: null, daysAgo: [5] },
];

beforeEach(async () => {
  db = await createTestDb();
  const [t] = await db.insert(tenants).values({ orgId: "org_a", name: "A" }).returning({ id: tenants.id });
  ctx = { tenantId: t!.id, orgId: "org_a", userId: "u1", role: "gc_partner", shop: { domain: "a.myshopify.com", timezone: "UTC", currency: "USD", status: "connected" } };
  registerExecutor(e);
}, 60_000);

async function seedOrders() {
  let n = 0;
  const rows = ORDERS.flatMap((o) =>
    o.daysAgo.map((d) => {
      n++;
      return {
        tenantId: ctx.tenantId, id: `gid://shopify/Order/${n}`, name: `#${1000 + n}`, processedAt: new Date(`${ago(d)}T12:00:00Z`), localDate: ago(d),
        customerId: o.customer, grossCents: 5000, discountCents: 0, shippingCents: 0, channel: "online",
      };
    }),
  );
  await db.insert(orders).values(rows);
}

function fakeEnv(...answers: unknown[]) {
  const graphql = vi.fn<ExecEnv["graphql"]>(async () => answers.shift());
  return { env: { db, ctx, graphql } as ExecEnv, graphql };
}
const created = (p: { segment: SegmentId; name: string }) => ({ segmentCreate: { segment: { id: "gid://shopify/Segment/1", name: p.name, query: shopifySegmentQuery(p.segment) }, userErrors: [] } });

describe("segment_create payload", () => {
  it("accepts each known segment with a plain name", () => {
    for (const segment of SEGMENT_IDS) expect(e.schema.safeParse({ segment, name: "Q4 VIPs" }).success, segment).toBe(true);
    for (const name of ["Women's list", "Top 10 - spring & summer (UK)", "Café Å 2026", "a", "x".repeat(SEGMENT_NAME_MAX)]) {
      expect(e.schema.safeParse({ segment: "at_risk", name }).success, name).toBe(true);
    }
    expect(e.schema.parse({ segment: "champions", name: "  Padded name  " }).name).toBe("Padded name");
  });

  it("is strict: a free-form query, a tenant or any other key is refused", () => {
    for (const extra of [{ query: "number_of_orders > 0" }, { shopifyQuery: "x" }, { tenantId: "t" }, { shop: "x.myshopify.com" }]) {
      expect(e.schema.safeParse({ ...good, ...extra }).success, JSON.stringify(extra)).toBe(false);
    }
  });

  it("refuses an unknown or missing segment and a bad name", () => {
    const bad: unknown[] = [
      { name: "x" },
      { segment: "champions" },
      { segment: "whales", name: "x" },
      { segment: "active", name: "x" }, // never offered as an action
      { segment: "champions", name: "" },
      { segment: "champions", name: "   " },
      { segment: "champions", name: "x".repeat(SEGMENT_NAME_MAX + 1) },
      { segment: "champions", name: 'say "hi"' },
      { segment: "champions", name: "a; drop" },
      { segment: "champions", name: "{x}" },
      { segment: "champions", name: "line\nbreak" },
      { segment: "champions", name: "<b>bold</b>" },
      { segment: "champions", name: "back\\slash" },
      { segment: "champions", name: "emoji \u{1F600}" },
      { segment: "champions", name: 42 },
    ];
    for (const b of bad) expect(e.schema.safeParse(b).success, JSON.stringify(b)).toBe(false);
  });
});

describe("segment_create mutations (the dry run)", () => {
  it("is the derived query for the chosen segment and the name as a variable, for every segment", () => {
    for (const segment of SEGMENT_IDS) {
      const out = e.mutations({ segment, name: "Any name" });
      expect(out).toHaveLength(1);
      expect(out[0]!.name).toBe("segmentCreate");
      expect(out[0]!.variables).toEqual({ name: "Any name", query: shopifySegmentQuery(segment) });
      expect(out[0]!.query).toContain("segmentCreate(name: $name, query: $query)");
      expect(out[0]!.query).not.toContain("Any name"); // the name travels as a variable, never inside the GraphQL text
    }
  });

  it("makes no network call and gives the same answer twice", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const first = e.mutations(good);
    expect(e.mutations(good)).toEqual(first);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe("segment_create diff", () => {
  it("says what will be created, shows the name, the Shopify query and our count, and notes the scope and the count difference", async () => {
    await seedOrders();
    const d = await e.diff(good, ctx, db);
    expect(d.summary).toBe("Create a customer segment in Shopify named Champions (Oasis). It only saves a filter; no customer is emailed or changed.");
    expect(d.rows).toEqual([
      { label: "Segment name", after: "Champions (Oasis)" },
      { label: "Based on", after: `${SEGMENTS[0]!.title}: ${SEGMENTS[0]!.description}` },
      { label: "Shopify query", after: shopifySegmentQuery("champions") },
      { label: "Our count", after: `2 customers, from the orders synced up to ${ASOF}` },
    ]);
    expect(d.notes!.some((n) => /own full customer list/.test(n) && /differ from ours/.test(n))).toBe(true);
    expect(d.notes!.some((n) => /write_customers/.test(n))).toBe(true);
    expect(d.notes!.some((n) => /approximation/.test(n))).toBe(false); // an exact rule needs no caveat
  });

  it("counts each segment from the synced orders: pseudonymous customers, guests left out", async () => {
    await seedOrders();
    const count = async (segment: SegmentId) => (await e.diff({ segment, name: "n" }, ctx, db)).rows!.find((r) => r.label === "Our count")!.after;
    expect(await count("champions")).toMatch(/^2 customers/);
    expect(await count("at_risk")).toMatch(/^1 customer,/);
    expect(await count("due_to_reorder")).toMatch(/^1 customer,/);
    expect(await count("one_and_done")).toMatch(/^1 customer,/);
  });

  it("says plainly that the filter is an approximation where Shopify cannot express the rule", async () => {
    await seedOrders();
    const d = await e.diff({ segment: "due_to_reorder", name: "Due" }, ctx, db);
    expect(d.notes).toContain(shopifySegmentCaveat("due_to_reorder"));
    for (const segment of SEGMENT_IDS.filter((s) => s !== "due_to_reorder")) {
      expect((await e.diff({ segment, name: "n" }, ctx, db)).notes!.some((n) => /approximation/.test(n)), segment).toBe(false);
    }
  });

  it("does not block a proposal when no orders are synced yet", async () => {
    const d = await e.diff(good, ctx, db);
    expect(d.rows!.find((r) => r.label === "Our count")!.after).toBe("Not available: no orders are synced yet");
  });

  it("holds no customer name, email or phone, and no id of a customer", async () => {
    await seedOrders();
    const text = JSON.stringify(await e.diff(good, ctx, db));
    expect(text).not.toMatch(/CUST_|@|gid:\/\/shopify\/Customer/);
  });
});

describe("segment_create run", () => {
  it("sends segmentCreate once with the derived query and the name, and returns the segment", async () => {
    for (const segment of SEGMENT_IDS) {
      const p = { segment, name: `Test ${segment}` };
      const { env, graphql } = fakeEnv(created(p));
      const out = await e.run(p, env);
      expect(graphql).toHaveBeenCalledTimes(1);
      const [query, variables] = graphql.mock.calls[0]!;
      expect(query).toBe(e.mutations(p)[0]!.query);
      expect(variables).toEqual({ name: p.name, query: shopifySegmentQuery(segment) });
      expect(out).toEqual({ segment: { id: "gid://shopify/Segment/1", name: p.name, query: shopifySegmentQuery(segment) } });
    }
  });

  it("fails on userErrors, and when Shopify returns no segment", async () => {
    const refused = fakeEnv({ segmentCreate: { segment: null, userErrors: [{ field: ["query"], message: "Query is invalid" }] } });
    await expect(e.run(good, refused.env)).rejects.toThrow(/segmentCreate.*Query is invalid/);
    await expect(e.run(good, fakeEnv({ segmentCreate: { segment: null, userErrors: [] } }).env)).rejects.toMatchObject({ code: "INTERNAL_ERROR" });
    await expect(e.run(good, fakeEnv(undefined).env)).rejects.toBeInstanceOf(AppError);
  });

  it("explains a name that is already taken", async () => {
    const taken = fakeEnv({ segmentCreate: { segment: null, userErrors: [{ field: ["name"], message: "Name has already been taken" }] } });
    await expect(e.run(good, taken.env)).rejects.toMatchObject({ code: "INVALID_INPUT", message: expect.stringContaining('already has a segment named "Champions (Oasis)"') });
  });

  it("says plainly that the app lacks permission, however Shopify words it", async () => {
    const wordings = [
      "Shopify refused the change: Access denied for segmentCreate field. Required access: `write_customers` access scope. Also: The user must not have restricted access.",
      "Access denied for segmentCreate field.",
      "Shopify answered HTTP 403",
      "Shopify refused segmentCreate: the write_customers scope is missing",
    ];
    for (const w of wordings) {
      const env = { db, ctx, graphql: vi.fn(async () => Promise.reject(new AppError("INVALID_INPUT", w))) } as ExecEnv;
      await expect(e.run(good, env), w).rejects.toMatchObject({ code: "INVALID_INPUT", message: NO_SCOPE_MESSAGE });
    }
    expect(NO_SCOPE_MESSAGE).toBe("Shopify refused: this app does not have permission to create customer segments yet. Ask Asim to add the scope and redeploy the app.");
  });

  it("passes any other failure through unchanged", async () => {
    const boom = new AppError("SHOPIFY_UNAVAILABLE", "Shopify is unavailable (a network error)", { retryable: true });
    const env = { db, ctx, graphql: vi.fn(async () => Promise.reject(boom)) } as ExecEnv;
    await expect(e.run(good, env)).rejects.toBe(boom);
  });
});

// The safety rules, through the real approval ledger and a spy standing in for Shopify.
describe("segment_create through the approval ledger", () => {
  const input = (over: Partial<ProposeInput> = {}): ProposeInput => ({
    kind: "segment_create", title: "Save the champions segment", payload: good, hypothesis: "A saved list lets the team email loyal buyers from Shopify.", metric: "returning_customer_rate", checkOn: "2026-11-14", ...over,
  });
  const propose = (c: TenantContext = ctx, over: Partial<ProposeInput> = {}) => proposeAction(db, c, input(over), { today: "2026-11-01" });
  const shopify = () => vi.fn<ExecEnv["graphql"]>(async () => created(good));
  const as = (role: TenantContext["role"], userId = ctx.userId): TenantContext => ({ ...ctx, role, userId });
  const rowCount = async () => (await db.select().from(actions)).length;

  it("proposing stores a card and does not touch Shopify", async () => {
    await seedOrders();
    const graphql = shopify();
    const a = await propose();
    expect(a).toMatchObject({ kind: "segment_create", status: "proposed", dryRun: false });
    expect(a.diff.rows).toContainEqual({ label: "Shopify query", after: shopifySegmentQuery("champions") });
    expect(graphql).not.toHaveBeenCalled();
    expect(a.result).toBeUndefined();
  });

  it("refuses a proposal that carries its own query, an unknown segment or a bad name, and stores nothing", async () => {
    for (const payload of [{ ...good, query: "number_of_orders >= 0" }, { segment: "whales", name: "x" }, { ...good, name: 'x" ) { }' }, { ...good, name: "" }]) {
      await expect(propose(ctx, { payload })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    }
    expect(await rowCount()).toBe(0);
  });

  it("a rejected proposal never reaches Shopify, and approving it afterwards does nothing", async () => {
    const graphql = shopify();
    const a = await propose();
    expect((await rejectAction(db, ctx, a.id)).status).toBe("rejected");
    expect((await approveAction(db, ctx, a.id, { graphql, env: {} })).status).toBe("rejected");
    expect(graphql).not.toHaveBeenCalled();
  });

  it("a reviewer login's approval is a dry run: the exact mutation is recorded and Shopify is not called", async () => {
    const graphql = shopify();
    const a = await propose();
    const done = await approveAction(db, ctx, a.id, { graphql, env: { REVIEWER_USER_IDS: "someone, u1" } });
    expect(done).toMatchObject({ status: "done", dryRun: true });
    expect(done.result).toEqual({ dryRun: true, mutations: e.mutations(good) });
    expect((done.result as { mutations: { variables: unknown }[] }).mutations[0]!.variables).toEqual({ name: good.name, query: shopifySegmentQuery("champions") });
    expect(graphql).not.toHaveBeenCalled();
  });

  it("a Growth Capital approval calls Shopify exactly once, with the derived query and the stored name", async () => {
    const graphql = shopify();
    const a = await propose();
    const done = await approveAction(db, as("gc_admin", "boss"), a.id, { graphql, env: {} });
    expect(done).toMatchObject({ status: "done", dryRun: false, decidedBy: "boss", error: null });
    expect(graphql).toHaveBeenCalledTimes(1);
    expect(graphql).toHaveBeenCalledWith(e.mutations(good)[0]!.query, { name: "Champions (Oasis)", query: shopifySegmentQuery("champions") });
    expect(done.result).toEqual({ segment: { id: "gid://shopify/Segment/1", name: good.name, query: shopifySegmentQuery("champions") } });
  });

  it("a second approval does nothing, even when two arrive together", async () => {
    const graphql = shopify();
    const a = await propose();
    await Promise.all([approveAction(db, ctx, a.id, { graphql, env: {} }), approveAction(db, ctx, a.id, { graphql, env: {} })]);
    const again = await approveAction(db, ctx, a.id, { graphql, env: {} });
    expect(again.status).toBe("done");
    expect(graphql).toHaveBeenCalledTimes(1);
  });

  it("a client viewer can neither propose nor approve nor reject", async () => {
    const viewer = as("client_viewer");
    const graphql = shopify();
    await expect(propose(viewer)).rejects.toBeInstanceOf(NotAllowedError);
    expect(await rowCount()).toBe(0);
    const a = await propose();
    await expect(approveAction(db, viewer, a.id, { graphql, env: {} })).rejects.toBeInstanceOf(NotAllowedError);
    await expect(rejectAction(db, viewer, a.id)).rejects.toBeInstanceOf(NotAllowedError);
    expect((await getAction(db, ctx, a.id)).status).toBe("proposed");
    expect(graphql).not.toHaveBeenCalled();
  });

  it("refuses to run a payload that was changed after it was proposed", async () => {
    const graphql = shopify();
    const a = await propose();
    // another segment under the same name, then a smuggled query: both are caught (hash and strict schema)
    for (const payload of [{ segment: "one_and_done", name: good.name }, { ...good, query: "number_of_orders >= 0" }]) {
      await db.update(actions).set({ payload }).where(eq(actions.id, a.id));
      await expect(approveAction(db, ctx, a.id, { graphql, env: {} })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    }
    expect(graphql).not.toHaveBeenCalled();
    expect((await getAction(db, ctx, a.id)).status).toBe("proposed");
  });

  it("records a missing scope as a failure with the plain message, and a taken name as a failure too", async () => {
    const a = await propose();
    const denied = vi.fn(async () => ({ errors: [{ message: "Access denied for segmentCreate field. Required access: `write_customers` access scope.", extensions: { code: "ACCESS_DENIED" } }] }));
    const failed = await approveAction(db, ctx, a.id, { graphql: denied, env: {} });
    expect(failed).toMatchObject({ status: "failed", error: NO_SCOPE_MESSAGE });
    expect(denied).toHaveBeenCalledTimes(1);

    const b = await propose(ctx, { payload: { segment: "at_risk", name: "At risk list" } });
    const taken = vi.fn(async () => ({ segmentCreate: { segment: null, userErrors: [{ field: ["name"], message: "Name has already been taken" }] } }));
    expect(await approveAction(db, ctx, b.id, { graphql: taken, env: {} })).toMatchObject({ status: "failed", error: expect.stringContaining("already has a segment") });
    expect((await listActions(db, ctx, { status: "failed" })).map((x) => x.id).sort()).toEqual([a.id, b.id].sort());
  });
});
