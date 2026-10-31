import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { shopConnections } from "../db/schema";

export type GrantState = "granted" | "limited" | "not_granted";

export interface PermissionRow {
  id: string;
  label: string;
  detail: string;
  state: GrantState;
}

export interface PermissionGroups {
  reads: PermissionRow[];
  writes: PermissionRow[];
}

// Shopify lists only write_x when a store has granted write_x, because it includes read_x (same rule as lib/shopify/connect.ts).
function grantedSet(scopes: string): (scope: string) => boolean {
  const granted = new Set(scopes.split(",").map((s) => s.trim()).filter(Boolean));
  return (s) => granted.has(s) || (s.startsWith("read_") && granted.has(`write_${s.slice("read_".length)}`));
}

// Plain-language view of the granted scopes. Reads are always on; every write waits for a person to approve it.
export function permissionGroups(scopes: string): PermissionGroups {
  const has = grantedSet(scopes);
  const all = (...needed: string[]): GrantState => (needed.every(has) ? "granted" : "not_granted");
  return {
    reads: [
      { id: "orders", label: "Orders", detail: "Answers sales and order questions", state: all("read_orders") },
      { id: "products", label: "Products and inventory", detail: "Names, variants and stock", state: all("read_products", "read_inventory") },
      { id: "customers", label: "Customers", detail: "Seen only as anonymous ids", state: all("read_customers") },
      { id: "discounts", label: "Discounts", detail: "Which codes were used", state: all("read_discounts") },
    ],
    writes: [
      { id: "targets", label: "Sales targets", detail: "Set a sales target in Shopify", state: all("write_reports") },
      { id: "annotations", label: "Chart annotations", detail: "Add a dated note to charts", state: all("write_analytics_annotations") },
      { id: "discount_codes", label: "Discount codes", detail: "Turn a code off", state: all("write_discounts") },
      { id: "unit_costs", label: "Unit costs", detail: "Update a variant's cost after an invoice is approved", state: all("write_inventory") },
      {
        id: "landing_pages",
        label: "Landing pages",
        detail: "Theme writes need a Shopify exemption",
        // Both scopes granted is still "limited": Shopify gates theme file writes behind an exemption the app does not hold yet.
        state: all("write_themes", "write_content") === "granted" ? "limited" : "not_granted",
      },
    ],
  };
}

// The scopes granted to this tenant's shop. Both the tenant and the shop come from the session.
export async function getGrantedScopes(db: Db, tenantId: string, shopDomain: string): Promise<string> {
  const [row] = await db
    .select({ scopes: shopConnections.scopes })
    .from(shopConnections)
    .where(and(eq(shopConnections.tenantId, tenantId), eq(shopConnections.shopDomain, shopDomain)))
    .limit(1);
  return row?.scopes ?? "";
}
