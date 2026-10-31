import { desc, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { shopConnections, tenants, type ShopStatus } from "../db/schema";

export const ROLES = ["gc_admin", "gc_partner", "client_viewer"] as const;
export type Role = (typeof ROLES)[number];

export interface TenantContext {
  tenantId: string;
  orgId: string;
  userId: string;
  role: Role;
  shop: { domain: string; timezone: string; currency: string; status: ShopStatus } | null;
}

// The part of a Clerk session this app reads. orgRole arrives as "org:<key>".
export interface Session {
  userId: string | null;
  orgId?: string | null;
  orgRole?: string | null;
}

export interface TenantDeps {
  auth?: () => Promise<Session>;
  db?: Db;
}

// Thrown when a request has no usable tenant. Callers treat it as "not allowed", never as a server fault.
export class TenantContextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TenantContextError";
  }
}

// A database handle bound to one tenant. Repository functions take this, never a bare Db,
// so a call can't run without a tenant, and the tenant never comes from tool input or the model.
export interface TenantScope {
  readonly db: Db;
  readonly tenantId: string;
}

export function tenantScoped(db: Db, tenantId: string | null | undefined): TenantScope {
  if (!tenantId) throw new TenantContextError("A repository call needs a tenant");
  return { db, tenantId };
}

// The tenant's connected shop, or failing that its most recently updated disconnected one (so the UI can offer to reconnect).
export async function shopFor(scope: TenantScope): Promise<TenantContext["shop"]> {
  const [row] = await scope.db
    .select()
    .from(shopConnections)
    .where(eq(shopConnections.tenantId, scope.tenantId))
    .orderBy(sql`${shopConnections.status} = 'connected' desc`, desc(shopConnections.updatedAt))
    .limit(1);
  return row ? { domain: row.shopDomain, timezone: row.timezone, currency: row.currency, status: row.status } : null;
}

async function clerkSession(): Promise<Session> {
  // Loaded lazily so that code and tests that inject a session never pull in Clerk.
  const { auth } = await import("@clerk/nextjs/server");
  const { userId, orgId, orgRole } = await auth();
  return { userId, orgId, orgRole };
}

function toRole(orgRole: string | null | undefined): Role | null {
  const key = orgRole?.startsWith("org:") ? orgRole.slice("org:".length) : null;
  return ROLES.find((r) => r === key) ?? null;
}

// Signed-in users get their tenant from the Clerk session and nowhere else. It never creates a tenants row:
// only `npm run tenant:create` does that. The built-in org:admin and org:member roles give no access.
export async function getTenantContext(deps: TenantDeps = {}): Promise<TenantContext> {
  const session = await (deps.auth ?? clerkSession)();
  if (!session.userId) throw new TenantContextError("Not signed in");
  if (!session.orgId) throw new TenantContextError("No active organization");
  const role = toRole(session.orgRole);
  if (!role) throw new TenantContextError(`Role ${session.orgRole ?? "(none)"} has no access to this app`);

  const db = deps.db ?? (await import("../db/client")).getDb();
  const [tenant] = await db.select().from(tenants).where(eq(tenants.orgId, session.orgId)).limit(1);
  if (!tenant) throw new TenantContextError(`No tenant exists for organization ${session.orgId}`);

  const shop = await shopFor(tenantScoped(db, tenant.id));
  return { tenantId: tenant.id, orgId: session.orgId, userId: session.userId, role, shop };
}
