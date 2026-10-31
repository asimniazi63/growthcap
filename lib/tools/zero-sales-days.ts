import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client";
import { products, variants } from "../db/schema";
import { addDays } from "../metrics/dates";
import { STOCKOUT_LOOKBACK_DAYS, unitsByVariantDay, zeroSalesDaysOf } from "../metrics/cohorts";
import { METRICS } from "../metrics/registry";
import type { TenantContext } from "../tenancy/context";
import { assertInWindow, asOfOf, capLimit, dbFor, idList, limitField, loadWindow, parseInput, periodShape, queryIdFor, resolveRange, todayFor, type Ctx } from "./common";
import { requireConnectedShop, type ToolResult } from "./result";

// strictObject: an unknown key (a tenant, a shop, anything the model invents) is an error, not ignored.
export const getZeroSalesDaysInputSchema = z.strictObject({
  ...periodShape,
  productIds: idList.optional(),
  variantIds: idList.optional(),
  limit: limitField,
});
export type GetZeroSalesDaysInput = z.input<typeof getZeroSalesDaysInputSchema>;

export interface ZeroSalesRow {
  variantId: string;
  sku: string;
  zeroSalesDays: number; // days in the period with no sales, for a variant that was selling at least 0.5 units a day
  days: string[]; // those days, oldest first (at most 31 are listed)
  untrusted: { product: string; variant: string }; // store text
}

// Days with no sales for a variant that had been selling, per variant: a suspected stockout. Only variants with at least one
// such day are listed. The period is cut to the days the data covers, and the 28 days before it are read for the average.
export async function getZeroSalesDays(ctx: Ctx, rawInput: GetZeroSalesDaysInput, deps: { db?: Db } = {}): Promise<ToolResult<ZeroSalesRow[]>> {
  const shop = requireConnectedShop(ctx);
  const input = parseInput(getZeroSalesDaysInputSchema, rawInput);
  const db = await dbFor(deps);
  const win = await loadWindow(db, ctx.tenantId);
  const requested = resolveRange(input, todayFor(shop.timezone, win));
  assertInWindow(requested, win);
  const range = { from: requested.from, to: requested.to > win.last! ? win.last! : requested.to };

  const byVariant = await unitsByVariantDay(db, ctx.tenantId, { from: addDays(range.from, -STOCKOUT_LOOKBACK_DAYS), to: range.to });
  const found: { variantId: string; days: string[] }[] = [];
  for (const [variantId, perDay] of byVariant) {
    const days = zeroSalesDaysOf(perDay, range);
    if (days.length > 0) found.push({ variantId, days });
  }

  const ids = found.map((f) => f.variantId);
  const info = ids.length
    ? await db
        .select({ id: variants.id, sku: variants.sku, variant: variants.title, productId: variants.productId, product: products.title })
        .from(variants)
        .innerJoin(products, and(eq(products.tenantId, variants.tenantId), eq(products.id, variants.productId)))
        .where(and(eq(variants.tenantId, ctx.tenantId), inArray(variants.id, ids)))
    : [];
  const byId = new Map(info.map((v) => [v.id, v]));

  let rows: ZeroSalesRow[] = found.flatMap((f) => {
    const v = byId.get(f.variantId);
    if (!v) return [];
    if (input.variantIds && !input.variantIds.includes(v.id)) return [];
    if (input.productIds && !input.productIds.includes(v.productId)) return [];
    return [{ variantId: v.id, sku: v.sku, zeroSalesDays: f.days.length, days: f.days.slice(0, 31), untrusted: { product: v.product, variant: v.variant } }];
  });
  rows.sort((a, b) => b.zeroSalesDays - a.zeroSalesDays || a.variantId.localeCompare(b.variantId));
  const total = rows.length;
  rows = rows.slice(0, capLimit(input.limit));

  const asOf = asOfOf(win);
  return {
    data: rows,
    queryId: queryIdFor("get_zero_sales_days", ctx.tenantId, input, asOf),
    range,
    definitions: { zero_sales_days: METRICS.zero_sales_days.definition },
    asOf,
    ...(total > rows.length ? { truncated: { shown: rows.length, total } } : {}),
  };
}

type Run = (ctx: TenantContext, input: never, deps: { db?: Db }) => Promise<ToolResult<unknown>>;

// The shape of an entry of TOOL_DEFS in lib/agent/tools.ts.
export const getZeroSalesDaysTool = {
  description:
    "Suspected stockouts: per variant, the days in the period with no sales for a variant that averaged at least 0.5 units a day over the previous 28 days. Only variants with at least one such day are listed, most days first, each with the days. Use it with get_inventory when asked whether something sold out or why a product's sales stopped. A variant that never sold much is not listed.",
  schema: getZeroSalesDaysInputSchema as z.ZodType,
  run: getZeroSalesDays as unknown as Run,
};
