import { and, eq, gte, inArray, isNull, lte, max, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client";
import { inventoryLevels, orderLines, orders, products, variants } from "../db/schema";
import { addDays } from "../metrics/dates";
import { capLimit, dbFor, idList, limitField, loadWindow, parseInput, queryIdFor, todayFor, type Ctx } from "./common";
import { requireConnectedShop, type ToolResult } from "./result";

export const COVER_WINDOWS = [7, 14, 30, 60, 90] as const;

export const getInventoryInputSchema = z.strictObject({
  productIds: idList.optional(),
  variantIds: idList.optional(),
  coverWindowDays: z.union(COVER_WINDOWS.map((d) => z.literal(d)) as unknown as [z.ZodLiteral<7>, z.ZodLiteral<14>, ...z.ZodLiteral<30 | 60 | 90>[]]).optional(),
  maxDaysOfCover: z.number().min(0).max(3650).optional(),
  sort: z.enum(["days_of_cover", "available"]).optional(),
  limit: limitField,
});
export type GetInventoryInput = z.input<typeof getInventoryInputSchema>;

export interface InventoryRow {
  variantId: string;
  productId: string;
  sku: string;
  available: number; // across locations
  locations: { locationId: string; available: number }[];
  unitsSold: number; // in the cover window
  dailyRate: number; // unitsSold / window days
  daysOfCover: number | null; // available / dailyRate; null when nothing sold in the window
  untrusted: { product: string; variant: string }; // store text
}

const DEFINITIONS = {
  available: "Units available to sell, summed over locations, as last synced.",
  daysOfCover: "available divided by the average units sold per day over the window. Null when nothing sold in the window, so there is no rate to run out at.",
};

// Stock per variant and location, with days of cover at the recent sales rate (units sold in the window, before refunds).
export async function getInventory(ctx: Ctx, rawInput: GetInventoryInput, deps: { db?: Db } = {}): Promise<ToolResult<InventoryRow[]>> {
  const shop = requireConnectedShop(ctx);
  const input = parseInput(getInventoryInputSchema, rawInput);
  const db = await dbFor(deps);
  const windowDays = input.coverWindowDays ?? 30;

  const win = await loadWindow(db, ctx.tenantId);
  const today = todayFor(shop.timezone, win);
  const range = { from: addDays(today, -(windowDays - 1)), to: today };

  const vs = await db
    .select({ id: variants.id, productId: variants.productId, sku: variants.sku, variant: variants.title, product: products.title })
    .from(variants)
    .innerJoin(products, and(eq(products.tenantId, variants.tenantId), eq(products.id, variants.productId)))
    .where(
      and(
        eq(variants.tenantId, ctx.tenantId),
        input.productIds ? inArray(variants.productId, input.productIds) : undefined,
        input.variantIds ? inArray(variants.id, input.variantIds) : undefined,
      ),
    );
  const ids = vs.map((v) => v.id);
  const levels = ids.length ? await db.select().from(inventoryLevels).where(and(eq(inventoryLevels.tenantId, ctx.tenantId), inArray(inventoryLevels.variantId, ids))) : [];
  const sold = ids.length
    ? await db
        .select({ variantId: orderLines.variantId, units: sql<string>`sum(${orderLines.quantity})` })
        .from(orderLines)
        .innerJoin(orders, and(eq(orders.tenantId, orderLines.tenantId), eq(orders.id, orderLines.orderId)))
        .where(
          and(
            eq(orders.tenantId, ctx.tenantId),
            isNull(orders.cancelledAt),
            gte(orders.localDate, range.from),
            lte(orders.localDate, range.to),
            inArray(orderLines.variantId, ids),
          ),
        )
        .groupBy(orderLines.variantId)
    : [];
  const unitsByVariant = new Map(sold.map((s) => [s.variantId, Number(s.units)]));

  let rows: InventoryRow[] = vs.map((v) => {
    const mine = levels.filter((l) => l.variantId === v.id);
    const available = mine.reduce((s, l) => s + l.available, 0);
    const unitsSold = unitsByVariant.get(v.id) ?? 0;
    const dailyRate = unitsSold / windowDays;
    return {
      variantId: v.id,
      productId: v.productId,
      sku: v.sku,
      available,
      locations: mine.map((l) => ({ locationId: l.locationId, available: l.available })),
      unitsSold,
      dailyRate,
      daysOfCover: dailyRate > 0 ? available / dailyRate : null,
      untrusted: { product: v.product, variant: v.variant },
    };
  });

  if (input.maxDaysOfCover !== undefined) rows = rows.filter((r) => r.daysOfCover !== null && r.daysOfCover <= input.maxDaysOfCover!);
  rows.sort((a, b) => {
    if (input.sort === "available") return a.available - b.available || a.variantId.localeCompare(b.variantId);
    // Soonest to run out first; variants with no sales have no rate and go last.
    if (a.daysOfCover === null && b.daysOfCover === null) return a.available - b.available || a.variantId.localeCompare(b.variantId);
    if (a.daysOfCover === null) return 1;
    if (b.daysOfCover === null) return -1;
    return a.daysOfCover - b.daysOfCover || a.variantId.localeCompare(b.variantId);
  });

  const total = rows.length;
  rows = rows.slice(0, capLimit(input.limit));

  const [{ at } = { at: null }] = await db.select({ at: max(inventoryLevels.syncedAt) }).from(inventoryLevels).where(eq(inventoryLevels.tenantId, ctx.tenantId));
  const asOf = at ? new Date(at).toISOString() : new Date(0).toISOString();
  return {
    data: rows,
    queryId: queryIdFor("get_inventory", ctx.tenantId, input, asOf),
    range,
    definitions: DEFINITIONS,
    asOf,
    ...(total > rows.length ? { truncated: { shown: rows.length, total } } : {}),
  };
}
