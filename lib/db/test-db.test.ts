import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "./client";
import { shopConnections, tenants } from "./schema";
import { createTestDb } from "./test-db";

let db: Db;

beforeEach(async () => {
  db = await createTestDb();
});

async function makeTenant(orgId: string): Promise<string> {
  const [row] = await db.insert(tenants).values({ orgId, name: orgId }).returning();
  return row!.id;
}

const shop = (tenantId: string, shopDomain: string, status: "connected" | "disconnected" = "connected") => ({
  tenantId,
  shopDomain,
  status,
  timezone: "America/New_York",
  currency: "USD",
});

async function expectUniqueViolation(promise: Promise<unknown>): Promise<void> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e as Error & { cause?: { message?: string } },
  );
  expect(error, "expected the insert to be rejected").not.toBeNull();
  expect(`${error!.message} ${error!.cause?.message ?? ""}`).toMatch(/unique|duplicate/i);
}

describe("the test database", () => {
  it("applies the migrations: every table exists and is empty", async () => {
    expect(await db.select().from(tenants)).toEqual([]);
    expect(await db.select().from(shopConnections)).toEqual([]);
  });

  it("allows only one connected shop per tenant", async () => {
    const tenantId = await makeTenant("org_a");
    await db.insert(shopConnections).values(shop(tenantId, "a-one.myshopify.com"));
    await expectUniqueViolation(db.insert(shopConnections).values(shop(tenantId, "a-two.myshopify.com")));
  });

  it("allows several disconnected shops for the same tenant, and a new connected one next to them", async () => {
    const tenantId = await makeTenant("org_a");
    await db.insert(shopConnections).values(shop(tenantId, "old-one.myshopify.com", "disconnected"));
    await db.insert(shopConnections).values(shop(tenantId, "old-two.myshopify.com", "disconnected"));
    await db.insert(shopConnections).values(shop(tenantId, "live.myshopify.com"));
    expect(await db.select().from(shopConnections)).toHaveLength(3);
  });

  it("keeps a shop domain unique, even across tenants", async () => {
    const a = await makeTenant("org_a");
    const b = await makeTenant("org_b");
    await db.insert(shopConnections).values(shop(a, "shared.myshopify.com"));
    await expectUniqueViolation(db.insert(shopConnections).values(shop(b, "shared.myshopify.com")));
  });

  it("gives each test its own empty database", async () => {
    await makeTenant("org_a");
    const fresh = await createTestDb();
    expect(await fresh.select().from(tenants)).toEqual([]);
  });
});
