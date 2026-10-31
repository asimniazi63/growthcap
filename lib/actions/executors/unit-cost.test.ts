import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "../../db/client";
import { products, tenants, variants } from "../../db/schema";
import { createTestDb } from "../../db/test-db";
import type { TenantContext } from "../../tenancy/context";
import type { ExecEnv } from "../types";
import { costDecimal, unitCostExecutor } from "./unit-cost";

let db: Db;
let ctx: TenantContext;
const VARIANT = "gid://shopify/ProductVariant/1";

beforeEach(async () => {
  db = await createTestDb();
  const [t] = await db.insert(tenants).values({ orgId: "org_a", name: "A" }).returning({ id: tenants.id });
  ctx = { tenantId: t!.id, orgId: "org_a", userId: "u1", role: "gc_partner", shop: { domain: "a.myshopify.com", timezone: "America/New_York", currency: "USD", status: "connected" } };
  await db.insert(products).values({ tenantId: ctx.tenantId, id: "gid://shopify/Product/1", title: "Hero Vitamin C Serum", handle: "hero", status: "ACTIVE" });
  await db.insert(variants).values({ tenantId: ctx.tenantId, id: VARIANT, productId: "gid://shopify/Product/1", sku: "SOL-01A", title: "30 ml", priceCents: 4800, unitCostCents: 1150 });
}, 60_000);

const good = { updates: [{ variantId: VARIANT, sku: "SOL-01A", unitCostCents: 1240, currency: "USD" }] };
const cost = async () => (await db.select({ c: variants.unitCostCents }).from(variants))[0]!.c;

describe("unit_cost_update", () => {
  const e = unitCostExecutor;

  it("has a strict payload", () => {
    expect(e.schema.safeParse(good).success).toBe(true);
    for (const bad of [{ ...good, tenantId: "t" }, { updates: [] }, { updates: [{ ...good.updates[0], variantId: "7" }] }, { updates: [good.updates[0], good.updates[0]] }, { updates: [{ ...good.updates[0], unitCostCents: 12.5 }] }]) {
      expect(e.schema.safeParse(bad).success).toBe(false);
    }
    expect(costDecimal(1240)).toBe("12.40");
    expect(costDecimal(805)).toBe("8.05");
  });

  it("shows before and after per SKU and refuses a variant that is not in the store", async () => {
    const d = await e.diff(good, ctx, db);
    expect(d.rows).toEqual([expect.objectContaining({ before: "$11.50", after: "$12.40" })]);
    await expect(e.diff({ updates: [{ ...good.updates[0]!, variantId: "gid://shopify/ProductVariant/99" }] }, ctx, db)).rejects.toThrow(/not a variant/);
  });

  it("changes the local cost only after Shopify accepted the update", async () => {
    const graphql = vi.fn(async (query: string) =>
      query.includes("nodes(") ? { nodes: [{ id: VARIANT, inventoryItem: { id: "gid://shopify/InventoryItem/5" } }] } : { inventoryItemUpdate: { inventoryItem: { id: "gid://shopify/InventoryItem/5" }, userErrors: [{ message: "no" }] } },
    );
    await expect(e.run(good, { db, ctx, graphql } as ExecEnv)).rejects.toThrow(/was not changed/);
    expect(await cost()).toBe(1150);

    const ok = vi.fn(async (query: string) =>
      query.includes("nodes(") ? { nodes: [{ id: VARIANT, inventoryItem: { id: "gid://shopify/InventoryItem/5" } }] } : { inventoryItemUpdate: { inventoryItem: { id: "gid://shopify/InventoryItem/5" }, userErrors: [] } },
    );
    await e.run(good, { db, ctx, graphql: ok } as ExecEnv);
    expect(ok).toHaveBeenLastCalledWith(expect.any(String), { id: "gid://shopify/InventoryItem/5", input: { cost: "12.40" } });
    expect(await cost()).toBe(1240);
  });

  it("builds the mutations offline for a dry run", () => {
    const m = e.mutations(good);
    expect(m.map((x) => x.name)).toEqual(["nodes", "inventoryItemUpdate"]);
  });
});
