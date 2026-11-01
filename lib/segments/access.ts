import type { TenantContext } from "../tenancy/context";

// The Segments page and its CSV export are for Growth Capital admins and partners; a client viewer gets 403 from the route and a
// "Growth Capital roles only" screen from the page. (Same rule as canAudit and canRunPlaybooks.)
export const canViewSegments = (ctx: Pick<TenantContext, "role">): boolean => ctx.role === "gc_admin" || ctx.role === "gc_partner";
