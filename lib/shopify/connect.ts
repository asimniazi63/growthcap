import { eq } from "drizzle-orm";
import { encryptSecret } from "../crypto/secrets";
import type { Db } from "../db/client";
import { shopConnections } from "../db/schema";

// The core read scopes. read_all_orders is added only once Shopify approves it (see shopify.app.toml).
export const REQUIRED_SCOPES = ["read_products", "read_orders", "read_customers", "read_inventory", "read_discounts"] as const;

// What the approved writes need (T8 Act, T9). Asked for at install so the grant covers them, but not required: a store that
// has only the read scopes still connects, and a write that needs a missing scope fails with Shopify's own message.
export const WRITE_SCOPES = ["write_discounts", "write_reports", "write_analytics_annotations", "read_themes", "write_themes", "write_content"] as const;
export const REQUESTED_SCOPES = [...REQUIRED_SCOPES, ...WRITE_SCOPES] as const;

export type ConnectResult =
  | { ok: true; shopDomain: string }
  | { ok: false; reason: "missing_scopes" | "shop_taken" | "tenant_has_shop"; detail: string };

export interface ConnectArgs {
  db: Db;
  tenantId: string; // from the Clerk session, never from the request
  shopDomain: string; // already validated by the OAuth library
  accessToken: string;
  scope: string; // the granted scopes, comma separated
  shopInfo: { timezone: string; currency: string };
}

// Saves a verified OAuth grant against the signed-in tenant. A shop belongs to one tenant for good: a second tenant
// can't take it over, and a tenant has one connected shop at a time.
export async function connectShop({ db, tenantId, shopDomain, accessToken, scope, shopInfo }: ConnectArgs): Promise<ConnectResult> {
  const granted = new Set(scope.split(",").map((s) => s.trim()));
  const missing = REQUIRED_SCOPES.filter((s) => !granted.has(s));
  if (missing.length > 0) {
    return { ok: false, reason: "missing_scopes", detail: `The grant is missing: ${missing.join(", ")}.` };
  }

  return db.transaction(async (tx) => {
    const own = await tx.select().from(shopConnections).where(eq(shopConnections.tenantId, tenantId));
    const existing = (await tx.select().from(shopConnections).where(eq(shopConnections.shopDomain, shopDomain)))[0];

    if (existing && existing.tenantId !== tenantId) {
      return { ok: false, reason: "shop_taken", detail: "This store is already connected to another brand." } as const;
    }
    if (own.some((c) => c.status === "connected" && c.shopDomain !== shopDomain)) {
      return { ok: false, reason: "tenant_has_shop", detail: "This brand already has a connected store." } as const;
    }

    const values = {
      tokenEnc: encryptSecret(accessToken),
      refreshTokenEnc: null,
      expiresAt: null,
      scopes: scope,
      status: "connected" as const,
      timezone: shopInfo.timezone,
      currency: shopInfo.currency,
      updatedAt: new Date(),
    };
    if (existing) await tx.update(shopConnections).set(values).where(eq(shopConnections.id, existing.id));
    else await tx.insert(shopConnections).values({ tenantId, shopDomain, ...values });
    return { ok: true, shopDomain } as const;
  });
}
