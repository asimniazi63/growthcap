import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { products, variants } from "../../db/schema";
import { AppError } from "../../errors";
import type { Executor } from "../types";
import { writeResult } from "./user-errors";

// Updates the unit cost of product variants (inventoryItemUpdate(id: ID!, input: InventoryItemInput!) with input { cost }),
// from a supplier invoice a person confirmed and then approved here. Needs the write_inventory scope; the inventory item of a
// variant is found with nodes(ids:) on the variant, so no inventory item id is ever stored or typed by anyone. Costs go to
// Shopify in the store's own currency and are never converted. The local variants.unit_cost_cents (what gross margin is worked
// out from) changes for a variant only after Shopify accepted that variant's update.
export const MAX_COST_UPDATES = 50;

const update = z.strictObject({
  variantId: z.string().min(1).max(200).startsWith("gid://shopify/ProductVariant/"),
  sku: z.string().trim().min(1).max(60),
  unitCostCents: z.number().int().min(0).max(100_000_000),
  currency: z.string().regex(/^[A-Z]{3}$/, "a 3-letter currency code"),
});
export const unitCostUpdatePayload = z.strictObject({
  updates: z
    .array(update)
    .min(1)
    .max(MAX_COST_UPDATES)
    .refine((u) => new Set(u.map((x) => x.variantId)).size === u.length, "a variant can be in the list only once"),
});
export type UnitCostUpdatePayload = z.infer<typeof unitCostUpdatePayload>;

const LOOKUP = `query VariantInventoryItems($ids: [ID!]!) {
  nodes(ids: $ids) {
    ... on ProductVariant { id inventoryItem { id } }
  }
}`;

const UPDATE = `mutation InventoryItemUpdate($id: ID!, $input: InventoryItemInput!) {
  inventoryItemUpdate(id: $id, input: $input) {
    inventoryItem { id unitCost { amount currencyCode } }
    userErrors { field message }
  }
}`;

const ID_FROM_LOOKUP = "(the inventory item id that the variant lookup returns)";

// Cents to a Decimal string with integer maths: 1240 -> "12.40".
export const costDecimal = (cents: number) => `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
const money = (cents: number | null, currency: string) =>
  cents === null ? "no cost set" : new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function mutations(p: UnitCostUpdatePayload) {
  return [
    { name: "nodes", query: LOOKUP, variables: { ids: p.updates.map((u) => u.variantId) } },
    ...p.updates.map((u) => ({ name: "inventoryItemUpdate", query: UPDATE, variables: { id: ID_FROM_LOOKUP, input: { cost: costDecimal(u.unitCostCents) } } })),
  ];
}

export const unitCostExecutor: Executor<UnitCostUpdatePayload> = {
  kind: "unit_cost_update",
  schema: unitCostUpdatePayload,
  mutations,
  async diff(p, ctx, db) {
    const rows = await db
      .select({ id: variants.id, sku: variants.sku, title: variants.title, cost: variants.unitCostCents, product: products.title })
      .from(variants)
      .innerJoin(products, and(eq(products.tenantId, variants.tenantId), eq(products.id, variants.productId)))
      .where(and(eq(variants.tenantId, ctx.tenantId), inArray(variants.id, p.updates.map((u) => u.variantId))));
    const byId = new Map(rows.map((r) => [r.id, r]));
    const currency = ctx.shop?.currency ?? p.updates[0]!.currency;
    for (const u of p.updates) {
      if (!byId.has(u.variantId)) throw new AppError("INVALID_INPUT", `${u.sku} is not a variant of this store, so its cost can't be changed.`);
      if (ctx.shop?.currency && u.currency !== ctx.shop.currency) throw new AppError("INVALID_INPUT", `${u.sku} is in ${u.currency} but the store is in ${ctx.shop.currency}. Costs are never converted.`);
    }
    return {
      summary: `Change the unit cost of ${p.updates.length} ${p.updates.length === 1 ? "variant" : "variants"} in Shopify, from a supplier invoice. Gross margin uses the new costs as soon as this is approved.`,
      rows: p.updates.map((u) => {
        const v = byId.get(u.variantId)!;
        return { label: clip(`${u.sku}: ${v.product}, ${v.title}`, 90), before: money(v.cost, currency), after: money(u.unitCostCents, currency) };
      }),
      notes: ["Needs the write_inventory permission for the app. Only the cost changes: prices and stock are not touched.", "Gross margin is worked out from each variant's current unit cost, so it changes for past days too."],
    };
  },
  async run(p, env) {
    // The tenant's own variants only: a payload naming a variant of another brand finds nothing here.
    const own = await env.db
      .select({ id: variants.id })
      .from(variants)
      .where(and(eq(variants.tenantId, env.ctx.tenantId), inArray(variants.id, p.updates.map((u) => u.variantId))));
    const ownIds = new Set(own.map((r) => r.id));
    const stranger = p.updates.find((u) => !ownIds.has(u.variantId));
    if (stranger) throw new AppError("INVALID_INPUT", `${stranger.sku} is not a variant of this store, so nothing was changed.`);

    const looked = await env.graphql(LOOKUP, { ids: p.updates.map((u) => u.variantId) });
    const nodes = (looked as { nodes?: ({ id?: string; inventoryItem?: { id?: string } | null } | null)[] } | null)?.nodes ?? [];
    const itemFor = new Map<string, string>();
    for (const n of nodes) if (n?.id && n.inventoryItem?.id) itemFor.set(n.id, n.inventoryItem.id);
    const missing = p.updates.find((u) => !itemFor.has(u.variantId));
    if (missing) throw new AppError("INVALID_INPUT", `Shopify has no inventory item for ${missing.sku}, so nothing was changed.`);

    const done: { sku: string; variantId: string; unitCostCents: number }[] = [];
    for (const u of p.updates) {
      try {
        const out = writeResult(await env.graphql(UPDATE, { id: itemFor.get(u.variantId), input: { cost: costDecimal(u.unitCostCents) } }), "inventoryItemUpdate");
        if (!(out.inventoryItem as { id?: string } | null)?.id) throw new AppError("INTERNAL_ERROR", `Shopify did not confirm the cost of ${u.sku}`);
      } catch (e) {
        const reason = e instanceof Error ? e.message : String(e);
        const so = done.length > 0 ? ` ${done.length} of ${p.updates.length} were already changed (${done.map((d) => d.sku).join(", ")}).` : " Nothing was changed.";
        throw new AppError(e instanceof AppError ? e.code : "INTERNAL_ERROR", `The cost of ${u.sku} was not changed: ${reason}.${so}`.slice(0, 480));
      }
      // Only after Shopify accepted this variant: gross margin now uses the new cost.
      await env.db
        .update(variants)
        .set({ unitCostCents: u.unitCostCents })
        .where(and(eq(variants.tenantId, env.ctx.tenantId), eq(variants.id, u.variantId)));
      done.push({ sku: u.sku, variantId: u.variantId, unitCostCents: u.unitCostCents });
    }
    return { updated: done };
  },
};
