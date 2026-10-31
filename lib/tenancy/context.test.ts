import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../db/client";
import { shopConnections, tenants } from "../db/schema";
import { createTestDb } from "../db/test-db";
import { getTenantContext, tenantScoped, type Session } from "./context";

let db: Db;
let tenantA: string;

beforeEach(async () => {
  db = await createTestDb();
  const [a] = await db.insert(tenants).values({ orgId: "org_a", name: "Solenne" }).returning();
  tenantA = a!.id;
});

const session = (over: Partial<Session> = {}): (() => Promise<Session>) => async () => ({
  userId: "user_1",
  orgId: "org_a",
  orgRole: "org:gc_admin",
  ...over,
});

const connect = (tenantId: string, shopDomain: string, status: "connected" | "disconnected" = "connected") =>
  db.insert(shopConnections).values({ tenantId, shopDomain, status, timezone: "America/New_York", currency: "USD" });

describe("getTenantContext", () => {
  it.each(["gc_admin", "gc_partner", "client_viewer"] as const)("resolves the tenant, the %s role and the connected shop", async (role) => {
    await connect(tenantA, "solenne.myshopify.com");
    const ctx = await getTenantContext({ db, auth: session({ orgRole: `org:${role}` }) });
    expect(ctx).toEqual({
      tenantId: tenantA,
      orgId: "org_a",
      userId: "user_1",
      role,
      shop: { domain: "solenne.myshopify.com", timezone: "America/New_York", currency: "USD", status: "connected" },
    });
  });

  it("has no shop until one is connected", async () => {
    expect((await getTenantContext({ db, auth: session() })).shop).toBeNull();
  });

  it("shows a disconnected shop with its status, so the UI can offer to reconnect", async () => {
    await connect(tenantA, "solenne.myshopify.com", "disconnected");
    const ctx = await getTenantContext({ db, auth: session() });
    expect(ctx.shop).toMatchObject({ domain: "solenne.myshopify.com", status: "disconnected" });
  });

  it("prefers the connected shop over an older disconnected one", async () => {
    await connect(tenantA, "old.myshopify.com", "disconnected");
    await connect(tenantA, "live.myshopify.com");
    expect((await getTenantContext({ db, auth: session() })).shop).toMatchObject({ domain: "live.myshopify.com", status: "connected" });
  });

  it("never shows another tenant's shop", async () => {
    const [b] = await db.insert(tenants).values({ orgId: "org_b", name: "Tidepool" }).returning();
    await connect(b!.id, "tidepool.myshopify.com");
    expect((await getTenantContext({ db, auth: session() })).shop).toBeNull();
    expect((await getTenantContext({ db, auth: session({ orgId: "org_b" }) })).shop).toMatchObject({ domain: "tidepool.myshopify.com" });
  });

  it("throws when the active org has no tenants row, and does not create one", async () => {
    await expect(getTenantContext({ db, auth: session({ orgId: "org_unknown" }) })).rejects.toThrow(/no tenant/i);
    expect(await db.select().from(tenants)).toHaveLength(1);
  });

  it("throws when nobody is signed in", async () => {
    await expect(getTenantContext({ db, auth: session({ userId: null }) })).rejects.toThrow(/not signed in/i);
  });

  it("throws when there is no active organization", async () => {
    await expect(getTenantContext({ db, auth: session({ orgId: null, orgRole: null }) })).rejects.toThrow(/organization/i);
  });

  it.each(["org:member", "org:admin", "gc_admin", "org:something_else", null, undefined])("gives no access to the role %s", async (orgRole) => {
    await expect(getTenantContext({ db, auth: session({ orgRole }) })).rejects.toThrow(/role/i);
  });
});

describe("tenantScoped", () => {
  it.each([undefined, null, ""])("throws at once when the tenant is %j, so a repository call can't run without one", (tenantId) => {
    expect(() => tenantScoped(db, tenantId)).toThrow(/tenant/i);
  });

  it("carries the database and the tenant id", () => {
    const scope = tenantScoped(db, tenantA);
    expect(scope.tenantId).toBe(tenantA);
    expect(scope.db).toBe(db);
  });
});
