import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setTestNow } from "../clock";
import type { Db } from "../db/client";
import { createTestDb } from "../db/test-db";
import type { TenantContext } from "../tenancy/context";
import { seedTwoStores } from "../../scripts/fixtures/load-db";
import { getCustomers } from "./customers";
import { describeMetrics } from "./describe";
import { getInventory } from "./inventory";
import { getOrders } from "./orders";
import { searchProducts } from "./products";
import { getPromoPostmortem } from "./promo-postmortem";

let db: Db;
let ctx: TenantContext;

beforeAll(async () => {
  setTestNow("2026-11-02T12:00:00-05:00");
  db = await createTestDb();
  ctx = (await seedTwoStores(db)).ctxs.solenne;
}, 240_000);

afterAll(() => setTestNow(null));

type Tool = (ctx: TenantContext, input: never, deps: { db: Db }) => Promise<unknown>;
const tools: Record<string, Tool> = {
  getOrders: getOrders as Tool,
  searchProducts: searchProducts as Tool,
  getInventory: getInventory as Tool,
  getCustomers: getCustomers as Tool,
  describeMetrics: describeMetrics as Tool,
  getPromoPostmortem: getPromoPostmortem as Tool,
};
const call = (name: string, input: unknown, c: TenantContext = ctx) => tools[name]!(c, input as never, { db });

describe.each(Object.keys(tools))("%s", (name) => {
  it("throws STORE_DISCONNECTED when the store is disconnected, and when there is none", async () => {
    await expect(call(name, {}, { ...ctx, shop: { ...ctx.shop!, status: "disconnected" } })).rejects.toMatchObject({ code: "STORE_DISCONNECTED" });
    await expect(call(name, {}, { ...ctx, shop: null })).rejects.toMatchObject({ code: "STORE_DISCONNECTED" });
  });

  it("rejects keys it doesn't know, such as a tenant, a shop or an org, as INVALID_INPUT", async () => {
    for (const key of ["tenantId", "shopDomain", "orgId", "shop"]) {
      await expect(call(name, { [key]: "other" }), key).rejects.toMatchObject({ code: "INVALID_INPUT" });
    }
  });
});

describe("dates", () => {
  it.each(["getOrders", "getCustomers", "getPromoPostmortem"])("%s rejects a malformed date, an impossible one, and from after to", async (name) => {
    await expect(call(name, { from: "05/01/2026", to: "2026-05-31" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(call(name, { from: "2026-02-30", to: "2026-03-01" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(call(name, { from: "2026-06-01", to: "2026-05-01" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(call(name, { from: "2026-06-01" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it.each(["getOrders", "getCustomers", "getPromoPostmortem"])("%s answers NO_DATA outside the data window", async (name) => {
    await expect(call(name, { from: "2025-01-01", to: "2025-01-31" })).rejects.toMatchObject({ code: "NO_DATA" });
    await expect(call(name, { from: "2027-01-01", to: "2027-01-31" })).rejects.toMatchObject({ code: "NO_DATA" });
  });
});

describe("values", () => {
  it("rejects an unknown enum value", async () => {
    await expect(call("getOrders", { sort: "random" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(call("getOrders", { customerType: "vip" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(call("searchProducts", { status: "DELETED" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(call("getInventory", { coverWindowDays: 5 })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(call("getCustomers", { view: "everyone" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(call("getCustomers", { rankBy: "age" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(call("getPromoPostmortem", { code: "BFCM25", baselineDays: 30 })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(call("describeMetrics", { metrics: ["profit"] })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("allows an order's note only for exactly one order id", async () => {
    await expect(call("getOrders", { includeNote: true })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(call("getOrders", { includeNote: true, orderIds: ["gid://shopify/Order/1", "gid://shopify/Order/2"] })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("rejects a limit of 0 or below, and a non-number", async () => {
    await expect(call("getOrders", { limit: 0 })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(call("searchProducts", { limit: "ten" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
});

describe("limits", () => {
  const FULL = { from: "2025-09-01", to: "2026-10-31" };

  it("getOrders: a limit of 500 returns 200 rows and says how many were left out", async () => {
    const res = (await call("getOrders", { ...FULL, limit: 500 })) as { data: unknown[]; truncated?: { shown: number; total: number } };
    expect(res.data).toHaveLength(200);
    expect(res.truncated).toEqual({ shown: 200, total: 1024 });
  });

  it("getCustomers: a limit of 500 returns 200 customers and says how many were left out", async () => {
    const res = (await call("getCustomers", { view: "list", ...FULL, limit: 500 })) as { data: unknown[]; truncated?: { shown: number; total: number } };
    expect(res.data).toHaveLength(200);
    expect(res.truncated!.shown).toBe(200);
    expect(res.truncated!.total).toBeGreaterThan(200);
  });

  it("getInventory and searchProducts: a limit of 5 returns 5 and says how many there were", async () => {
    const inv = (await call("getInventory", { limit: 5 })) as { data: unknown[]; truncated?: { shown: number; total: number } };
    expect(inv.data).toHaveLength(5);
    expect(inv.truncated).toEqual({ shown: 5, total: 63 });
    const prod = (await call("searchProducts", { limit: 5 })) as { data: unknown[]; truncated?: { shown: number; total: number } };
    expect(prod.data).toHaveLength(5);
    expect(prod.truncated).toEqual({ shown: 5, total: 28 });
  });
});
