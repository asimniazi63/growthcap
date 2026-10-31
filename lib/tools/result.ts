import { AppError } from "../errors";
import type { TenantContext } from "../tenancy/context";

// What every tool returns. The agent may state only numbers that appear in `data`, and says which query they came from.
export interface ToolResult<T> {
  data: T;
  queryId: string;
  range: { from: string; to: string };
  definitions: Record<string, string>;
  asOf: string; // when the underlying data was last synced
  truncated?: { shown: number; total: number };
}

// Every tool refuses to run without a connected store. The store comes from the session's tenant, never from input.
export function requireConnectedShop(ctx: Pick<TenantContext, "shop">): NonNullable<TenantContext["shop"]> {
  if (!ctx.shop || ctx.shop.status !== "connected") {
    throw new AppError("STORE_DISCONNECTED", "The store is not connected, so its data can't be read. Reconnect it and try again.");
  }
  return ctx.shop;
}
