import { NotAllowedError } from "../memory/store";
import type { TenantContext } from "../tenancy/context";

// Call notes, their proposals and the action items made from them are for Growth Capital roles only.
export const canManageNotes = (ctx: Pick<TenantContext, "role">) => ctx.role === "gc_admin" || ctx.role === "gc_partner";

export function assertCanManageNotes(ctx: Pick<TenantContext, "role">): void {
  if (!canManageNotes(ctx)) throw new NotAllowedError();
}
