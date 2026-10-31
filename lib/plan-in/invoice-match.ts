import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { products, variants } from "../db/schema";
import type { InvoiceLine } from "./invoice";

// Matches what an invoice says against the brand's own synced variants, by SKU. A SKU that is not in this store is listed
// and never applied. Everything is scoped to the tenant, and the product and variant titles are store text (shown as text).

export type MatchStatus = "ready" | "no_change" | "not_in_store" | "ambiguous" | "currency_differs";

export interface InvoiceRow {
  sku: string;
  status: MatchStatus;
  variantId: string | null;
  product: string | null; // store text: untrusted
  variantTitle: string | null; // store text: untrusted
  currentCents: number | null; // null: the variant has no cost today (or it is not in the store)
  proposedCents: number;
  currency: string;
  page: number;
  quote: string;
  note: string | null;
}

export const STATUS_TEXT: Record<MatchStatus, string> = {
  ready: "Ready to propose",
  no_change: "Same cost as now",
  not_in_store: "Not in this store",
  ambiguous: "More than one variant has this SKU",
  currency_differs: "Different currency from the store",
};

export async function matchInvoiceLines(db: Db, tenantId: string, storeCurrency: string | null, lines: InvoiceLine[]): Promise<InvoiceRow[]> {
  if (lines.length === 0) return [];
  const wanted = [...new Set(lines.map((l) => l.sku.trim().toUpperCase()))];
  const found = await db
    .select({ id: variants.id, sku: variants.sku, variant: variants.title, cost: variants.unitCostCents, product: products.title })
    .from(variants)
    .innerJoin(products, and(eq(products.tenantId, variants.tenantId), eq(products.id, variants.productId)))
    .where(and(eq(variants.tenantId, tenantId), inArray(sql`upper(${variants.sku})`, wanted)));
  const bySku = new Map<string, typeof found>();
  for (const v of found) bySku.set(v.sku.trim().toUpperCase(), [...(bySku.get(v.sku.trim().toUpperCase()) ?? []), v]);

  return lines.map((l): InvoiceRow => {
    const base = { sku: l.sku, proposedCents: l.unitCostCents, currency: l.currency, page: l.page, quote: l.quote };
    const hits = bySku.get(l.sku.trim().toUpperCase()) ?? [];
    if (hits.length === 0) return { ...base, status: "not_in_store", variantId: null, product: null, variantTitle: null, currentCents: null, note: "No variant in this store has this SKU, so it will not be applied." };
    if (hits.length > 1) return { ...base, status: "ambiguous", variantId: null, product: null, variantTitle: null, currentCents: null, note: "Several variants share this SKU, so it will not be applied." };
    const v = hits[0]!;
    const shown = { variantId: v.id, product: v.product, variantTitle: v.variant, currentCents: v.cost };
    if (storeCurrency && l.currency !== storeCurrency) return { ...base, ...shown, status: "currency_differs", note: `The invoice is in ${l.currency} and the store is in ${storeCurrency}. Costs are never converted, so it will not be applied.` };
    if (v.cost === l.unitCostCents) return { ...base, ...shown, status: "no_change", note: null };
    return { ...base, ...shown, status: "ready", note: null };
  });
}

// The lines that become a cost update: only the ones that matched exactly one variant, differ from today's cost and are in the store's currency.
export function updatesFrom(rows: InvoiceRow[]): { variantId: string; sku: string; unitCostCents: number; currency: string }[] {
  const seen = new Set<string>();
  const out: { variantId: string; sku: string; unitCostCents: number; currency: string }[] = [];
  for (const r of rows) {
    if (r.status !== "ready" || !r.variantId || seen.has(r.variantId)) continue;
    seen.add(r.variantId);
    out.push({ variantId: r.variantId, sku: r.sku, unitCostCents: r.proposedCents, currency: r.currency });
  }
  return out;
}
