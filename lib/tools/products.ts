import { and, asc, count, eq, ilike, inArray, max } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client";
import { products, variants } from "../db/schema";
import { capLimit, dbFor, idList, limitField, parseInput, queryIdFor, type Ctx } from "./common";
import { requireConnectedShop, type ToolResult } from "./result";

export const searchProductsInputSchema = z.strictObject({
  query: z.string().min(1).max(100).optional(),
  status: z.enum(["ACTIVE", "DRAFT", "ARCHIVED"]).optional(),
  productIds: idList.optional(),
  limit: limitField,
});
export type SearchProductsInput = z.input<typeof searchProductsInputSchema>;

export interface VariantRow {
  id: string;
  sku: string;
  priceCents: number;
  unitCostCents: number | null;
  marginCents: number | null;
  marginRate: number | null; // (price - cost) / price
}

export interface ProductRow {
  id: string;
  status: string;
  variantCount: number;
  priceMinCents: number | null;
  priceMaxCents: number | null;
  variants: VariantRow[];
  untrusted: { title: string; handle: string; description: string; variantTitles: Record<string, string> }; // store text
}

const DEFINITIONS = {
  priceCents: "The variant's current price in cents.",
  unitCostCents: "The unit cost recorded in Shopify, in cents. Null when none is recorded.",
  marginRate: "(price - unit cost) / price, as a fraction. Null when there is no unit cost.",
};

const escapeLike = (s: string) => s.replace(/[\\%_]/g, "\\$&");

// Products and variants from the synced catalogue: price, unit cost and the margin worked out.
export async function searchProducts(ctx: Ctx, rawInput: SearchProductsInput, deps: { db?: Db } = {}): Promise<ToolResult<ProductRow[]>> {
  requireConnectedShop(ctx);
  const input = parseInput(searchProductsInputSchema, rawInput);
  const db = await dbFor(deps);

  const where = and(
    eq(products.tenantId, ctx.tenantId),
    input.query ? ilike(products.title, `%${escapeLike(input.query)}%`) : undefined,
    input.status ? eq(products.status, input.status) : undefined,
    input.productIds ? inArray(products.id, input.productIds) : undefined,
  );
  const limit = capLimit(input.limit);
  const [{ n: total } = { n: 0 }] = await db.select({ n: count() }).from(products).where(where);
  const rows = await db.select().from(products).where(where).orderBy(asc(products.title), asc(products.id)).limit(limit);
  const vs = rows.length
    ? await db.select().from(variants).where(and(eq(variants.tenantId, ctx.tenantId), inArray(variants.productId, rows.map((p) => p.id)))).orderBy(asc(variants.priceCents), asc(variants.id))
    : [];

  const data: ProductRow[] = rows.map((p) => {
    const mine = vs.filter((v) => v.productId === p.id);
    const prices = mine.map((v) => v.priceCents);
    return {
      id: p.id,
      status: p.status,
      variantCount: mine.length,
      priceMinCents: prices.length ? Math.min(...prices) : null,
      priceMaxCents: prices.length ? Math.max(...prices) : null,
      variants: mine.map((v) => ({
        id: v.id,
        sku: v.sku,
        priceCents: v.priceCents,
        unitCostCents: v.unitCostCents,
        marginCents: v.unitCostCents === null ? null : v.priceCents - v.unitCostCents,
        marginRate: v.unitCostCents === null || v.priceCents === 0 ? null : (v.priceCents - v.unitCostCents) / v.priceCents,
      })),
      untrusted: {
        title: p.title,
        handle: p.handle,
        description: p.description.slice(0, 500),
        variantTitles: Object.fromEntries(mine.map((v) => [v.id, v.title])),
      },
    };
  });

  const [{ at } = { at: null }] = await db.select({ at: max(products.syncedAt) }).from(products).where(eq(products.tenantId, ctx.tenantId));
  const asOf = at ? new Date(at).toISOString() : new Date(0).toISOString();
  const day = asOf.slice(0, 10); // a catalogue snapshot has no date range; this is the day it was taken
  return {
    data,
    queryId: queryIdFor("search_products", ctx.tenantId, input, asOf),
    range: { from: day, to: day },
    definitions: DEFINITIONS,
    asOf,
    ...(total > data.length ? { truncated: { shown: data.length, total } } : {}),
  };
}
