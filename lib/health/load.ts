import type { Db } from "../db/client";
import { ordersPerMonth, type MonthCount } from "./coverage";
import { runHealthChecks, type HealthCheck } from "./checks";
import { getFreshness, type Freshness } from "./freshness";
import { getGrantedScopes, permissionGroups, type PermissionGroups } from "./permissions";

export interface StoreHealth {
  freshness: Freshness;
  checks: HealthCheck[] | null; // null: the checks could not be run at all
  months: MonthCount[] | null; // null: the monthly counts could not be read
  permissions: PermissionGroups | null; // null: the granted scopes could not be read
}

// Everything the store health page adds to the sync status. The tenant and shop come from the signed-in session; each part
// fails on its own, so one broken query leaves the rest of the page standing.
export async function loadStoreHealth(
  db: Db,
  input: { tenantId: string; shopDomain: string; currency: string; asOfIso: string | null },
): Promise<StoreHealth> {
  const now = new Date();
  const asOf = input.asOfIso ? new Date(input.asOfIso) : null;
  const [freshness, checks, months, permissions] = await Promise.all([
    getFreshness(db, { shopDomain: input.shopDomain, asOf, now }),
    runHealthChecks(db, input.tenantId, { now, currency: input.currency, asOf }).catch(() => null),
    ordersPerMonth(db, input.tenantId).catch(() => null),
    getGrantedScopes(db, input.tenantId, input.shopDomain).then(permissionGroups).catch(() => null),
  ]);
  return { freshness, checks, months, permissions };
}
