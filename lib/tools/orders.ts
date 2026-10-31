import { and, arrayOverlaps, asc, count, desc, eq, exists, gte, inArray, isNull, lte, not, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { orderLines, orders, products, refundLines, refunds, variants } from "../db/schema";
import { AppError } from "../errors";
import {
  assertInWindow,
  asOfOf,
  capLimit,
  dbFor,
  idList,
  limitField,
  loadWindow,
  parseInput,
  periodShape,
  queryIdFor,
  resolveRange,
  todayFor,
  type Ctx,
} from "./common";
import { requireConnectedShop, type ToolResult } from "./result";
import type { Db } from "../db/client";

export const getOrdersInputSchema = z
  .strictObject({
    ...periodShape,
    orderIds: idList.optional(),
    orderNumbers: z.array(z.string().regex(/^#?\d{1,10}$/, "an order number looks like 1982 or #1982")).min(1).max(10).optional(),
    customerIds: idList.optional(),
    discountCodes: idList.optional(),
    channels: idList.optional(),
    tags: idList.optional(),
    excludeTags: idList.optional(),
    productIds: idList.optional(),
    variantIds: idList.optional(),
    customerType: z.enum(["new", "returning"]).optional(),
    hasRefund: z.boolean().optional(),
    sort: z.enum(["newest", "oldest", "largest"]).optional(),
    includeNote: z.boolean().optional(),
    limit: limitField,
  })
  .refine((i) => !i.includeNote || i.orderIds?.length === 1 || i.orderNumbers?.length === 1, { path: ["includeNote"], message: "needs exactly one order, in orderIds or orderNumbers" });
export type GetOrdersInput = z.input<typeof getOrdersInputSchema>;

export interface OrderDetail {
  lines: { id: string; productId: string | null; variantId: string | null; quantity: number; unitPriceCents: number; discountCents: number; refundedQuantity: number }[];
  refunds: { id: string; date: string; amountCents: number }[];
}

export interface OrderRow {
  id: string;
  name: string;
  date: string; // store-local
  processedAt: string;
  customerId: string | null; // pseudonym
  channel: string;
  discountCode: string | null;
  units: number;
  lineCount: number;
  grossCents: number;
  discountCents: number;
  shippingCents: number;
  refundedCents: number;
  netCents: number; // gross - discounts - refunds
  detail?: OrderDetail; // for a single order looked up by id
  untrusted: { tags: string[]; note?: string; items?: { variantId: string; product: string; variant: string }[] }; // store text
}

const DEFINITIONS = {
  grossCents: "Quantity times list price over the order's lines, before discounts, in cents.",
  discountCents: "Discounts applied to the order's lines, in cents.",
  refundedCents: "Value of items refunded from this order so far, in cents (shipping is not refunded here).",
  netCents: "grossCents minus discountCents minus refundedCents.",
  units: "Total quantity on the order's lines, before refunds.",
};

// Finds or lists orders. A single order (orderIds with one id) comes with its lines and refunds, and its note if asked.
// Store text (tags, notes, product titles) is returned under `untrusted`, as data to read, never as instructions.
export async function getOrders(ctx: Ctx, rawInput: GetOrdersInput, deps: { db?: Db } = {}): Promise<ToolResult<OrderRow[]>> {
  const shop = requireConnectedShop(ctx);
  const input = parseInput(getOrdersInputSchema, rawInput);
  const db = await dbFor(deps);
  const win = await loadWindow(db, ctx.tenantId);
  if (!win.first || !win.last) throw new AppError("NO_DATA", "This store has no synced orders yet.");

  // Asking for named orders without dates means "wherever they fall".
  const byId = (input.orderIds !== undefined || input.orderNumbers !== undefined) && input.period === undefined && input.from === undefined && input.to === undefined;
  const range = byId ? { from: win.first, to: win.last } : resolveRange(input, todayFor(shop.timezone, win));
  if (!byId) assertInWindow(range, win);

  const firstOfCustomer = sql`(select o2.id from orders o2 where o2.tenant_id = ${orders.tenantId} and o2.customer_id = ${orders.customerId} and o2.cancelled_at is null order by o2.processed_at, o2.id limit 1)`;
  const lineHas = (col: typeof orderLines.productId | typeof orderLines.variantId, values: string[]) =>
    exists(
      db
        .select({ one: sql`1` })
        .from(orderLines)
        .where(and(eq(orderLines.tenantId, orders.tenantId), eq(orderLines.orderId, orders.id), inArray(col, values))),
    );
  const hasRefund = exists(db.select({ one: sql`1` }).from(refunds).where(and(eq(refunds.tenantId, orders.tenantId), eq(refunds.orderId, orders.id))));

  const conditions: (SQL | undefined)[] = [
    eq(orders.tenantId, ctx.tenantId),
    isNull(orders.cancelledAt),
    byId ? undefined : gte(orders.localDate, range.from),
    byId ? undefined : lte(orders.localDate, range.to),
    input.orderIds && inArray(orders.id, input.orderIds),
    input.orderNumbers && inArray(orders.name, input.orderNumbers.map((n) => (n.startsWith("#") ? n : `#${n}`))),
    input.customerIds && inArray(orders.customerId, input.customerIds),
    input.discountCodes && inArray(orders.discountCode, input.discountCodes),
    input.channels && inArray(orders.channel, input.channels),
    input.tags && arrayOverlaps(orders.tags, input.tags),
    input.excludeTags && not(arrayOverlaps(orders.tags, input.excludeTags)),
    input.productIds && lineHas(orderLines.productId, input.productIds),
    input.variantIds && lineHas(orderLines.variantId, input.variantIds),
    input.customerType === "new" ? sql`coalesce(${orders.id} = ${firstOfCustomer}, false)` : undefined,
    input.customerType === "returning" ? sql`not coalesce(${orders.id} = ${firstOfCustomer}, false)` : undefined,
    input.hasRefund === true ? hasRefund : input.hasRefund === false ? not(hasRefund) : undefined,
  ];
  const where = and(...conditions);

  const net = sql`${orders.grossCents} - ${orders.discountCents}`;
  const order =
    input.sort === "oldest" ? [asc(orders.processedAt), asc(orders.id)]
    : input.sort === "largest" ? [desc(net), desc(orders.processedAt), asc(orders.id)]
    : [desc(orders.processedAt), desc(orders.id)];
  const limit = capLimit(input.limit);

  const [{ n: total } = { n: 0 }] = await db.select({ n: count() }).from(orders).where(where);
  const rows = await db.select().from(orders).where(where).orderBy(...order).limit(limit);
  const ids = rows.map((r) => r.id);

  const lines = ids.length ? await db.select().from(orderLines).where(and(eq(orderLines.tenantId, ctx.tenantId), inArray(orderLines.orderId, ids))) : [];
  const refundRows = ids.length ? await db.select().from(refunds).where(and(eq(refunds.tenantId, ctx.tenantId), inArray(refunds.orderId, ids))) : [];

  const single = rows.length === 1 && (input.orderIds?.length === 1 || input.orderNumbers?.length === 1);
  const refundedQty = new Map<string, number>();
  let titles = new Map<string, { product: string; variant: string }>();
  if (single) {
    const rl = refundRows.length
      ? await db.select().from(refundLines).where(and(eq(refundLines.tenantId, ctx.tenantId), inArray(refundLines.refundId, refundRows.map((r) => r.id))))
      : [];
    for (const l of rl) if (l.orderLineId) refundedQty.set(l.orderLineId, (refundedQty.get(l.orderLineId) ?? 0) + l.quantity);
    const variantIds = lines.flatMap((l) => (l.variantId ? [l.variantId] : []));
    const t = variantIds.length
      ? await db
          .select({ id: variants.id, variant: variants.title, product: products.title })
          .from(variants)
          .innerJoin(products, and(eq(products.tenantId, variants.tenantId), eq(products.id, variants.productId)))
          .where(and(eq(variants.tenantId, ctx.tenantId), inArray(variants.id, variantIds)))
      : [];
    titles = new Map(t.map((x) => [x.id, { product: x.product, variant: x.variant }]));
  }

  const data: OrderRow[] = rows.map((o) => {
    const mine = lines.filter((l) => l.orderId === o.id);
    const refunded = refundRows.filter((r) => r.orderId === o.id).reduce((s, r) => s + r.amountCents, 0);
    const row: OrderRow = {
      id: o.id,
      name: o.name,
      date: o.localDate,
      processedAt: o.processedAt.toISOString(),
      customerId: o.customerId,
      channel: o.channel,
      discountCode: o.discountCode,
      units: mine.reduce((s, l) => s + l.quantity, 0),
      lineCount: mine.length,
      grossCents: o.grossCents,
      discountCents: o.discountCents,
      shippingCents: o.shippingCents,
      refundedCents: refunded,
      netCents: o.grossCents - o.discountCents - refunded,
      untrusted: { tags: o.tags },
    };
    if (single) {
      row.detail = {
        lines: mine.map((l) => ({
          id: l.id,
          productId: l.productId,
          variantId: l.variantId,
          quantity: l.quantity,
          unitPriceCents: l.unitPriceCents,
          discountCents: l.discountCents,
          refundedQuantity: refundedQty.get(l.id) ?? 0,
        })),
        refunds: refundRows.filter((r) => r.orderId === o.id).map((r) => ({ id: r.id, date: r.localDate, amountCents: r.amountCents })),
      };
      row.untrusted.items = mine.flatMap((l) => (l.variantId && titles.has(l.variantId) ? [{ variantId: l.variantId, ...titles.get(l.variantId)! }] : []));
      if (input.includeNote && o.note) row.untrusted.note = o.note;
    }
    return row;
  });

  const asOf = asOfOf(win);
  return {
    data,
    queryId: queryIdFor("get_orders", ctx.tenantId, input, asOf),
    range,
    definitions: DEFINITIONS,
    asOf,
    ...(total > data.length ? { truncated: { shown: data.length, total } } : {}),
  };
}
