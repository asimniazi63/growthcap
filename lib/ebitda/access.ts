import { NotAllowedError } from "../memory/store";
import type { TenantContext } from "../tenancy/context";

// Everyone who can open a brand can read its EBITDA page. The cost sheet and the rates behind it are the brand's planning input,
// so only Growth Capital admins and partners may change them; a client viewer sees the sheet read-only.
export const canEditCostSheet = (ctx: Pick<TenantContext, "role">): boolean => ctx.role === "gc_admin" || ctx.role === "gc_partner";

// Throws the same error as the other Growth Capital-only writes, which the API helpers turn into a 403 FORBIDDEN.
export function assertCanEditCostSheet(ctx: Pick<TenantContext, "role">): void {
  if (!canEditCostSheet(ctx)) throw new NotAllowedError();
}
