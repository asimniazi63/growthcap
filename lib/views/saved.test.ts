import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { setTestNow } from "../clock";
import type { Db } from "../db/client";
import { orderLines, orders, savedViews, tenants } from "../db/schema";
import { createTestDb } from "../db/test-db";
import { queryMetric } from "../metrics/query";
import type { TenantContext } from "../tenancy/context";
import { loadDataset, readFixture } from "../../scripts/fixtures/load-db";
import { STORES } from "../../scripts/seed/stores.js";
import { MAX_SAVED_VIEWS, listViews, pinView, rebuild, removeView } from "./saved";

let db: Db;
let ctx: TenantContext;
let other: TenantContext; // another brand, with no data of its own
const asUser = (c: TenantContext, userId: string): TenantContext => ({ ...c, userId });
const bar = { tool: "query_metric" as const, input: { metrics: ["orders"], from: "2026-09-01", to: "2026-09-30", groupBy: ["channel"] } };

beforeAll(async () => {
  db = await createTestDb();
  const [t] = await db.insert(tenants).values({ orgId: "org_tp", name: "Tidepool" }).returning();
  const [o] = await db.insert(tenants).values({ orgId: "org_other", name: "Other" }).returning();
  await loadDataset(db, t!.id, "tidepool", readFixture("tidepool").dataset);
  const shop = { domain: "tidepool.myshopify.com", timezone: STORES.tidepool.timezone, currency: "USD", status: "connected" as const };
  ctx = { tenantId: t!.id, orgId: "org_tp", userId: "user_a", role: "gc_partner", shop };
  other = { ...ctx, tenantId: o!.id, orgId: "org_other" };
}, 240_000);

describe("pinned views", () => {
  it("pins a view, lists it for the person who pinned it, and keeps the query, not the data", async () => {
    const { id } = await pinView(ctx, { title: "Orders by channel", component: "bar", sources: [bar] }, { db });
    const [row] = await db.select().from(savedViews).where(eq(savedViews.id, id));
    expect(row).toMatchObject({ tenantId: ctx.tenantId, userId: "user_a", title: "Orders by channel", component: "bar" });
    expect(JSON.stringify(row!.sources)).toContain("groupBy");
    expect(JSON.stringify(row!.sources)).not.toContain("values"); // no results stored
    expect((await listViews(ctx, { db })).map((v) => v.id)).toContain(id);
  });

  it("re-runs the query each time it loads: a new order shows up without re-pinning", async () => {
    setTestNow("2026-10-20T12:00:00-07:00");
    try {
      const { id } = await pinView(ctx, { title: "Orders this month", component: "table", sources: [{ tool: "query_metric" as const, input: { metrics: ["orders"], period: "this_month" } }] }, { db });
      const view = (await listViews(ctx, { db })).find((v) => v.id === id)!;
      const before = await rebuild(ctx, view, { db });
      if (before.component !== "table") throw new Error();

      await db.insert(orders).values({ tenantId: ctx.tenantId, id: "gid://shopify/Order/9999", name: "#9999", processedAt: new Date("2026-10-10T18:00:00Z"), localDate: "2026-10-10", grossCents: 1000, discountCents: 0, shippingCents: 0, channel: "web", tags: [] });
      await db.insert(orderLines).values({ tenantId: ctx.tenantId, id: "gid://shopify/LineItem/99990", orderId: "gid://shopify/Order/9999", quantity: 1, unitPriceCents: 1000, discountCents: 0 });
      const after = await rebuild(ctx, view, { db });
      if (after.component !== "table") throw new Error();
      expect(after.rows[0]!.orders).toBe((before.rows[0]!.orders as number) + 1);
    } finally {
      setTestNow(null);
      await db.delete(orderLines).where(eq(orderLines.id, "gid://shopify/LineItem/99990"));
      await db.delete(orders).where(and(eq(orders.id, "gid://shopify/Order/9999")));
    }
  });

  it("draws the same data the agent's query returns", async () => {
    const { id } = await pinView(ctx, { title: "By channel", component: "bar", sources: [bar] }, { db });
    const view = (await listViews(ctx, { db })).find((v) => v.id === id)!;
    const drawn = await rebuild(ctx, view, { db });
    const direct = await queryMetric(ctx, bar.input as never, { db });
    if (drawn.component !== "bar") throw new Error();
    expect(drawn.bars.map((b) => b.value)).toEqual(direct.data.map((r) => r.values.orders));
  });

  it.each([
    ["an unknown component", { title: "x", component: "pie", sources: [bar] }],
    ["a tool that isn't query_metric", { title: "x", component: "table", sources: [{ tool: "get_orders", input: {} }] }],
    ["an input with a field the tool doesn't have (such as a tenant)", { title: "x", component: "bar", sources: [{ tool: "query_metric", input: { ...bar.input, tenantId: "other" } }] }],
    ["a component the result can't draw", { title: "x", component: "line", sources: [bar] }],
    ["no sources", { title: "x", component: "bar", sources: [] }],
    ["an empty title", { title: "  ", component: "bar", sources: [bar] }],
    ["a title that is too long", { title: "x".repeat(81), component: "bar", sources: [bar] }],
  ])("refuses %s, and stores nothing", async (_what, input) => {
    const before = (await listViews(ctx, { db })).length;
    await expect(pinView(ctx, input as never, { db })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect((await listViews(ctx, { db })).length).toBe(before);
  });

  it("keeps a person's pinned views private to them and to their brand", async () => {
    const mine = await pinView(asUser(ctx, "user_b"), { title: "Mine", component: "bar", sources: [bar] }, { db });
    expect((await listViews(asUser(ctx, "user_c"), { db })).map((v) => v.id)).not.toContain(mine.id);
    expect((await listViews({ ...asUser(other, "user_b") }, { db })).map((v) => v.id)).not.toContain(mine.id);
    expect(await removeView(asUser(ctx, "user_c"), mine.id, { db })).toBe(false);
    expect(await removeView(asUser(other, "user_b"), mine.id, { db })).toBe(false);
    expect((await listViews(asUser(ctx, "user_b"), { db })).map((v) => v.id)).toContain(mine.id);
  });

  it("removes a view for its owner", async () => {
    const mine = await pinView(asUser(ctx, "user_d"), { title: "Gone soon", component: "bar", sources: [bar] }, { db });
    expect(await removeView(asUser(ctx, "user_d"), mine.id, { db })).toBe(true);
    expect((await listViews(asUser(ctx, "user_d"), { db })).map((v) => v.id)).not.toContain(mine.id);
  });

  it("stops at a limit per person", async () => {
    const u = asUser(ctx, "user_limit");
    for (let i = 0; i < MAX_SAVED_VIEWS; i++) await pinView(u, { title: `v${i}`, component: "bar", sources: [bar] }, { db });
    await expect(pinView(u, { title: "one too many", component: "bar", sources: [bar] }, { db })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
});
