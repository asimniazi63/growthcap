import { and, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import type { Db } from "../db/client";
import { orderLines, orders, products } from "../db/schema";

// The maths and the reads behind get_bundle_candidates: which products are bought together in one order. The unit is the product,
// so every variant of a product counts as that product. Demo scale: the orders of the range are read and folded in memory.
// Nothing here reads the clock or takes a tenant from anywhere but its argument (the tool passes the session's).

export interface PairStat {
  productAId: string; // the smaller id, so a pair has one spelling
  productBId: string;
  ordersTogether: number; // orders with both products, whatever the quantities
  ordersA: number; // orders with A, with or without B
  ordersB: number;
  support: number; // ordersTogether / orders in the range, a fraction
  confidenceAtoB: number; // ordersTogether / ordersA, a fraction
  confidenceBtoA: number;
  lift: number; // support / (support of A x support of B), a plain ratio
}

export interface PairSummary {
  ordersInRange: number; // every order of the range, including those with one product or none
  ordersWithTwoOrMoreProducts: number;
  pairs: PairStat[]; // sorted by lift desc, then ordersTogether desc, then ids
}

const compareIds = (x: string, y: string): number => (x < y ? -1 : x > y ? 1 : 0);

// A basket is the product ids of one order; an id repeated in it counts once.
export function pairStatsOf(baskets: readonly (readonly string[])[], opts: { minOrders: number; productIds?: readonly string[] }): PairSummary {
  const ordersWith = new Map<string, number>();
  const together = new Map<string, Map<string, number>>();
  let withTwo = 0;
  for (const basket of baskets) {
    const ids = [...new Set(basket)].sort(compareIds);
    if (ids.length >= 2) withTwo++;
    for (const id of ids) ordersWith.set(id, (ordersWith.get(id) ?? 0) + 1);
    for (let i = 0; i < ids.length; i++) {
      const row = together.get(ids[i]!) ?? new Map<string, number>();
      for (let j = i + 1; j < ids.length; j++) row.set(ids[j]!, (row.get(ids[j]!) ?? 0) + 1);
      together.set(ids[i]!, row);
    }
  }

  const n = baskets.length;
  const wanted = opts.productIds ? new Set(opts.productIds) : null;
  const pairs: PairStat[] = [];
  for (const [a, row] of together) {
    for (const [b, count] of row) {
      if (count < opts.minOrders) continue;
      if (wanted && !wanted.has(a) && !wanted.has(b)) continue;
      const ordersA = ordersWith.get(a)!;
      const ordersB = ordersWith.get(b)!;
      // One division of whole numbers each, so pairs with equal ratios get equal floats and the sort below is stable.
      pairs.push({ productAId: a, productBId: b, ordersTogether: count, ordersA, ordersB, support: count / n, confidenceAtoB: count / ordersA, confidenceBtoA: count / ordersB, lift: (count * n) / (ordersA * ordersB) });
    }
  }
  pairs.sort((x, y) => y.lift - x.lift || y.ordersTogether - x.ordersTogether || compareIds(x.productAId, y.productAId) || compareIds(x.productBId, y.productBId));
  return { ordersInRange: n, ordersWithTwoOrMoreProducts: withTwo, pairs };
}

// ---- Reads

// The distinct product ids of every order in the range, cancelled orders left out. An order with no product line is an empty basket,
// so it stays in the count of orders. Lines whose product is unknown are left out of their basket.
export async function loadBaskets(db: Db, tenantId: string, range: { from: string; to: string }): Promise<string[][]> {
  const rows = await db
    .select({ orderId: orders.id, productId: orderLines.productId })
    .from(orders)
    .leftJoin(orderLines, and(eq(orderLines.tenantId, orders.tenantId), eq(orderLines.orderId, orders.id)))
    .where(and(eq(orders.tenantId, tenantId), isNull(orders.cancelledAt), gte(orders.localDate, range.from), lte(orders.localDate, range.to)));
  const byOrder = new Map<string, Set<string>>();
  for (const r of rows) {
    const basket = byOrder.get(r.orderId) ?? new Set<string>();
    if (r.productId) basket.add(r.productId);
    byOrder.set(r.orderId, basket);
  }
  return [...byOrder.values()].map((b) => [...b]);
}

export async function loadProductTitles(db: Db, tenantId: string, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: products.id, title: products.title })
    .from(products)
    .where(and(eq(products.tenantId, tenantId), inArray(products.id, ids)));
  return new Map(rows.map((r) => [r.id, r.title]));
}
