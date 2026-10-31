import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { shopConnections } from "../db/schema";
import { shopifyGraphql, type ShopConnection } from "./client";

// What Shopify says this app is allowed to do in the store right now. The stored grant is written at install, so it can fall
// behind (a permission approved on Shopify's screen when the redirect back failed, or a scope added in a new app version).
// Shopify is the source of truth, so a sync reads it again and keeps ours the same.
export async function fetchInstalledScopes(conn: ShopConnection): Promise<string[]> {
  const res = await shopifyGraphql<{ currentAppInstallation: { accessScopes: { handle: string }[] } }>(conn, "{ currentAppInstallation { accessScopes { handle } } }");
  return res.currentAppInstallation.accessScopes.map((s) => s.handle).sort();
}

// Returns true when the stored grant changed.
export async function refreshGrantedScopes(db: Db, tenantId: string, conn: ShopConnection): Promise<boolean> {
  const scopes = (await fetchInstalledScopes(conn)).join(",");
  if (!scopes) return false;
  const [row] = await db.select({ scopes: shopConnections.scopes }).from(shopConnections).where(eq(shopConnections.tenantId, tenantId)).limit(1);
  if (!row || row.scopes === scopes) return false;
  await db.update(shopConnections).set({ scopes }).where(eq(shopConnections.tenantId, tenantId));
  return true;
}
