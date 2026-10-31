import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { decryptSecret } from "../crypto/secrets";
import type { Db } from "../db/client";
import { createTestDb } from "../db/test-db";
import { shopConnections, tenants } from "../db/schema";
import { connectShop, REQUIRED_SCOPES } from "./connect";

const SCOPES = REQUIRED_SCOPES.join(",");
const info = { timezone: "America/New_York", currency: "USD" };

let db: Db;
let solenne: string;
let tidepool: string;

beforeAll(() => {
  process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
});

beforeEach(async () => {
  db = await createTestDb();
  const rows = await db
    .insert(tenants)
    .values([
      { orgId: "org_solenne", name: "Solenne" },
      { orgId: "org_tidepool", name: "Tidepool" },
    ])
    .returning();
  solenne = rows[0]!.id;
  tidepool = rows[1]!.id;
});

const connect = (over: Partial<Parameters<typeof connectShop>[0]> = {}) =>
  connectShop({ db, tenantId: solenne, shopDomain: "solenne.myshopify.com", accessToken: "shpat_secret", scope: SCOPES, shopInfo: info, ...over });

describe("connectShop", () => {
  it("stores a connected shop with the token encrypted, never in plain text", async () => {
    expect(await connect()).toEqual({ ok: true, shopDomain: "solenne.myshopify.com" });
    const [row] = await db.select().from(shopConnections);
    expect(row).toMatchObject({ tenantId: solenne, status: "connected", timezone: "America/New_York", currency: "USD", scopes: SCOPES });
    expect(JSON.stringify(row)).not.toContain("shpat_secret");
    expect(decryptSecret(row!.tokenEnc!)).toBe("shpat_secret");
  });

  it("rejects a grant that is missing a required scope, and stores nothing", async () => {
    const result = await connect({ scope: "read_products,read_orders" });
    expect(result).toMatchObject({ ok: false, reason: "missing_scopes" });
    expect(await db.select().from(shopConnections)).toHaveLength(0);
  });

  it("rejects a shop that is already connected to another tenant, and leaves that connection alone", async () => {
    await connect();
    const result = await connect({ tenantId: tidepool, accessToken: "shpat_other" });
    expect(result).toMatchObject({ ok: false, reason: "shop_taken" });
    const rows = await db.select().from(shopConnections);
    expect(rows).toHaveLength(1);
    expect(decryptSecret(rows[0]!.tokenEnc!)).toBe("shpat_secret");
  });

  it("rejects a tenant that already has a different connected shop", async () => {
    await connect();
    const result = await connect({ shopDomain: "another.myshopify.com" });
    expect(result).toMatchObject({ ok: false, reason: "tenant_has_shop" });
    expect(await db.select().from(shopConnections)).toHaveLength(1);
  });

  it("reconnects a disconnected shop of the same tenant in place, with the new token", async () => {
    await connect();
    await db.update(shopConnections).set({ status: "disconnected", tokenEnc: null }).where(eq(shopConnections.shopDomain, "solenne.myshopify.com"));
    expect(await connect({ accessToken: "shpat_new" })).toEqual({ ok: true, shopDomain: "solenne.myshopify.com" });
    const rows = await db.select().from(shopConnections);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "connected" });
    expect(decryptSecret(rows[0]!.tokenEnc!)).toBe("shpat_new");
  });

  it("does not hand a shop that belongs to another tenant to a new one, even when it is disconnected", async () => {
    await connect();
    await db.update(shopConnections).set({ status: "disconnected", tokenEnc: null });
    expect(await connect({ tenantId: tidepool })).toMatchObject({ ok: false, reason: "shop_taken" });
  });
});
