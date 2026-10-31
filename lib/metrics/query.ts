import { createHash } from "node:crypto";
import { and, eq, gte, isNull, lte, max, min, sql } from "drizzle-orm";
import { z } from "zod";
import { storeToday } from "../clock";
import type { Db } from "../db/client";
import { orderLines, orders, refundLines, refunds } from "../db/schema";
import { AppError } from "../errors";
import type { TenantContext } from "../tenancy/context";
import { requireConnectedShop, type ToolResult } from "../tools/result";
import { addDays, addMonths, isValidDate, monthEnd, monthOf, monthStart, previousRange, sameRangeLastYear, weekStart } from "./dates";
import { CORE_METRIC_IDS, METRICS, type MetricId } from "./registry";

export const DIMENSIONS = ["day", "week", "month", "product", "variant", "channel", "discount_code", "customer_type", "tag"] as const;
export type Dimension = (typeof DIMENSIONS)[number];
const TIME_DIMENSIONS: Dimension[] = ["day", "week", "month"];
export const PERIODS = ["last_7_days", "last_30_days", "this_month", "last_month", "this_year"] as const;
export type Period = (typeof PERIODS)[number];

const MAX_ROWS = 200;
const DEFAULT_ROWS = 50;

const date = z.string().refine(isValidDate, "must be a real date written YYYY-MM-DD");
const ids = z.array(z.string().min(1).max(200)).max(50);

// strictObject: an unknown key (a tenant, a shop, anything the model invents) is an error, not ignored.
export const queryMetricInputSchema = z.strictObject({
  metrics: z.array(z.enum(CORE_METRIC_IDS)).min(1),
  period: z.enum(PERIODS).optional(),
  from: date.optional(),
  to: date.optional(),
  groupBy: z.array(z.enum(DIMENSIONS)).max(2).optional(),
  filters: z
    .strictObject({
      productIds: ids.optional(),
      variantIds: ids.optional(),
      discountCodes: ids.optional(),
      channels: ids.optional(),
      tags: ids.optional(),
      excludeTags: ids.optional(),
      customerType: z.enum(["new", "returning"]).optional(),
    })
    .optional(),
  compareTo: z.enum(["previous_period", "previous_year"]).optional(),
  limit: z.number().int().min(1).max(500).optional(),
});
export type QueryMetricInput = z.input<typeof queryMetricInputSchema>;

export type Values = Partial<Record<MetricId, number>>;
export interface MetricRow {
  group: Record<string, string>;
  values: Values;
  previous?: Values;
  change?: Values;
  pctChange?: Partial<Record<MetricId, number | null>>;
  share?: Values; // each group's part of the total, for metrics that add up
}

// ---- Facts: the rows a metric is computed from. Demo scale: they are read for the range and folded in memory.

interface Fact {
  date: string;
  orderId: string;
  customerId: string | null;
  isFirst: boolean;
  discountCode: string | null;
  channel: string;
  tags: string[];
  variantId: string | null;
  productId: string | null;
}
interface LineFact extends Fact {
  lineId: string;
  qty: number;
  gross: number;
  discount: number;
}
interface RefundFact extends Fact {
  lineId: string | null;
  qty: number;
  amount: number;
}
type Filters = NonNullable<z.output<typeof queryMetricInputSchema>["filters"]>;

const passes = (f: Fact, x: Filters): boolean =>
  (!x.productIds || (f.productId !== null && x.productIds.includes(f.productId))) &&
  (!x.variantIds || (f.variantId !== null && x.variantIds.includes(f.variantId))) &&
  (!x.discountCodes || (f.discountCode !== null && x.discountCodes.includes(f.discountCode))) &&
  (!x.channels || x.channels.includes(f.channel)) &&
  (!x.tags || f.tags.some((t) => x.tags!.includes(t))) &&
  (!x.excludeTags || !f.tags.some((t) => x.excludeTags!.includes(t))) &&
  (!x.customerType || (x.customerType === "new") === f.isFirst);

function groupsFor(f: Fact, dims: Dimension[]): Record<string, string>[] {
  let combos: Record<string, string>[] = [{}];
  for (const dim of dims) {
    const values: string[] =
      dim === "day" ? [f.date]
      : dim === "week" ? [weekStart(f.date)]
      : dim === "month" ? [monthOf(f.date)]
      : dim === "product" ? [f.productId ?? "unknown"]
      : dim === "variant" ? [f.variantId ?? "unknown"]
      : dim === "channel" ? [f.channel]
      : dim === "discount_code" ? [f.discountCode ?? "none"]
      : dim === "customer_type" ? [f.isFirst ? "new" : "returning"]
      : (f.tags.filter((t) => !t.startsWith("channel:")).length > 0 ? f.tags.filter((t) => !t.startsWith("channel:")) : ["untagged"]);
    combos = combos.flatMap((c) => values.map((v) => ({ ...c, [dim]: v })));
  }
  return combos;
}

interface Acc {
  group: Record<string, string>;
  orders: Set<string>;
  newOrders: Set<string>;
  discounted: Set<string>;
  customers: Map<string, boolean>; // customer -> had an order that was not their first
  gross: number;
  discounts: number;
  units: number;
  refundsAmount: number;
  refundedUnits: number;
}

const blank = (group: Record<string, string>): Acc => ({
  group,
  orders: new Set(),
  newOrders: new Set(),
  discounted: new Set(),
  customers: new Map(),
  gross: 0,
  discounts: 0,
  units: 0,
  refundsAmount: 0,
  refundedUnits: 0,
});

function valuesOf(a: Acc, metrics: MetricId[]): Values {
  const orders = a.orders.size;
  const all: Record<MetricId, number> = {
    gross_sales: a.gross,
    discounts: a.discounts,
    refunds: a.refundsAmount,
    net_sales: a.gross - a.discounts - a.refundsAmount,
    orders,
    aov: orders === 0 ? 0 : (a.gross - a.discounts) / orders,
    units: a.units,
    new_customer_orders: a.newOrders.size,
    returning_customer_rate: a.customers.size === 0 ? 0 : [...a.customers.values()].filter(Boolean).length / a.customers.size,
    refund_rate: a.units === 0 ? 0 : a.refundedUnits / a.units,
    discounted_order_share: orders === 0 ? 0 : a.discounted.size / orders,
  };
  return Object.fromEntries(metrics.map((m) => [m, all[m]])) as Values;
}

interface Source {
  db: Db;
  tenantId: string;
  firstOrder: Map<string, string>;
  refundFacts: RefundFact[]; // every refund, whenever it was made
  refundedQty: Map<string, number>; // order line -> units refunded so far
}

async function loadSource(db: Db, tenantId: string): Promise<Source> {
  const firstRows = await db
    .selectDistinctOn([orders.customerId], { customerId: orders.customerId, orderId: orders.id })
    .from(orders)
    .where(and(eq(orders.tenantId, tenantId), isNull(orders.cancelledAt), sql`${orders.customerId} is not null`))
    .orderBy(orders.customerId, orders.processedAt, orders.id);
  const firstOrder = new Map(firstRows.map((r) => [r.customerId!, r.orderId]));

  const rows = await db
    .select({
      date: refunds.localDate,
      orderId: refunds.orderId,
      lineId: refundLines.orderLineId,
      qty: refundLines.quantity,
      amount: refundLines.subtotalCents,
      customerId: orders.customerId,
      discountCode: orders.discountCode,
      channel: orders.channel,
      tags: orders.tags,
      variantId: orderLines.variantId,
      productId: orderLines.productId,
    })
    .from(refundLines)
    .innerJoin(refunds, and(eq(refunds.tenantId, refundLines.tenantId), eq(refunds.id, refundLines.refundId)))
    .innerJoin(orders, and(eq(orders.tenantId, refunds.tenantId), eq(orders.id, refunds.orderId)))
    .leftJoin(orderLines, and(eq(orderLines.tenantId, refundLines.tenantId), eq(orderLines.id, refundLines.orderLineId)))
    .where(and(eq(refunds.tenantId, tenantId), isNull(orders.cancelledAt)));

  const refundFacts: RefundFact[] = rows.map((r) => ({ ...r, isFirst: r.customerId !== null && firstOrder.get(r.customerId) === r.orderId }));
  const refundedQty = new Map<string, number>();
  for (const r of refundFacts) if (r.lineId) refundedQty.set(r.lineId, (refundedQty.get(r.lineId) ?? 0) + r.qty);
  return { db, tenantId, firstOrder, refundFacts, refundedQty };
}

async function lineFacts(src: Source, range: { from: string; to: string }): Promise<LineFact[]> {
  const rows = await src.db
    .select({
      date: orders.localDate,
      orderId: orders.id,
      customerId: orders.customerId,
      discountCode: orders.discountCode,
      channel: orders.channel,
      tags: orders.tags,
      lineId: orderLines.id,
      variantId: orderLines.variantId,
      productId: orderLines.productId,
      qty: orderLines.quantity,
      unit: orderLines.unitPriceCents,
      discount: orderLines.discountCents,
    })
    .from(orderLines)
    .innerJoin(orders, and(eq(orders.tenantId, orderLines.tenantId), eq(orders.id, orderLines.orderId)))
    .where(and(eq(orders.tenantId, src.tenantId), isNull(orders.cancelledAt), gte(orders.localDate, range.from), lte(orders.localDate, range.to)));
  return rows.map(({ unit, ...r }) => ({
    ...r,
    gross: r.qty * unit,
    isFirst: r.customerId !== null && src.firstOrder.get(r.customerId) === r.orderId,
  }));
}

async function aggregate(src: Source, range: { from: string; to: string }, filters: Filters, dims: Dimension[]): Promise<Map<string, Acc>> {
  const groups = new Map<string, Acc>();
  const slot = (g: Record<string, string>) => {
    const key = dims.map((d) => g[d]).join("\u0001");
    let a = groups.get(key);
    if (!a) groups.set(key, (a = blank(g)));
    return a;
  };

  for (const f of await lineFacts(src, range)) {
    if (!passes(f, filters)) continue;
    for (const g of groupsFor(f, dims)) {
      const a = slot(g);
      a.orders.add(f.orderId);
      if (f.isFirst) a.newOrders.add(f.orderId);
      if (f.discountCode) a.discounted.add(f.orderId);
      if (f.customerId) a.customers.set(f.customerId, (a.customers.get(f.customerId) ?? false) || !f.isFirst);
      a.gross += f.gross;
      a.discounts += f.discount;
      a.units += f.qty;
      a.refundedUnits += src.refundedQty.get(f.lineId) ?? 0;
    }
  }
  // A refund counts on the day it was made, so it lands in that day's, week's or month's group.
  for (const r of src.refundFacts) {
    if (r.date < range.from || r.date > range.to || !passes(r, filters)) continue;
    for (const g of groupsFor(r, dims)) slot(g).refundsAmount += r.amount;
  }
  return groups;
}

// ---- Dates and periods

function resolveRange(input: z.output<typeof queryMetricInputSchema>, today: string): { from: string; to: string } {
  if (input.from !== undefined || input.to !== undefined) {
    if (input.from === undefined || input.to === undefined) throw new AppError("INVALID_INPUT", "Give both from and to, or neither.");
    if (input.from > input.to) throw new AppError("INVALID_INPUT", `from (${input.from}) is after to (${input.to}).`);
    return { from: input.from, to: input.to };
  }
  switch (input.period ?? "last_30_days") {
    case "last_7_days":
      return { from: addDays(today, -6), to: today };
    case "last_30_days":
      return { from: addDays(today, -29), to: today };
    case "this_month":
      return { from: monthStart(monthOf(today)), to: today };
    case "last_month": {
      const m = addMonths(monthOf(today), -1);
      return { from: monthStart(m), to: monthEnd(m) };
    }
    case "this_year":
      return { from: `${today.slice(0, 4)}-01-01`, to: today };
  }
}

function buckets(dim: Dimension, from: string, to: string): string[] {
  const out: string[] = [];
  if (dim === "day") for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  else if (dim === "week") for (let d = weekStart(from); d <= to; d = addDays(d, 7)) out.push(d);
  else for (let m = monthOf(from); m <= monthOf(to); m = addMonths(m, 1)) out.push(m);
  return out;
}

const invalid = (error: z.ZodError) =>
  new AppError("INVALID_INPUT", error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; "));

export interface QueryDeps {
  db?: Db;
}

// Computes metrics for the signed-in tenant's store. Every number comes from the synced rows, and the tenant is the
// session's: nothing in `input` can name another tenant or shop (unknown keys are rejected).
export async function queryMetric(ctx: TenantContext, rawInput: QueryMetricInput, deps: QueryDeps = {}): Promise<ToolResult<MetricRow[]>> {
  const shop = requireConnectedShop(ctx);
  const parsed = queryMetricInputSchema.safeParse(rawInput);
  if (!parsed.success) throw invalid(parsed.error);
  const input = parsed.data;
  const dims = input.groupBy ?? [];
  const timeDim = dims.find((d) => TIME_DIMENSIONS.includes(d));
  if (input.compareTo && timeDim) throw new AppError("INVALID_INPUT", "compareTo can't be combined with a day, week or month grouping.");
  const metrics = [...new Set(input.metrics)];
  const filters = input.filters ?? {};

  const db = deps.db ?? (await import("../db/client")).getDb();
  const [win] = await db
    .select({ first: min(orders.localDate), last: max(orders.localDate), newest: max(orders.processedAt), synced: max(orders.syncedAt) })
    .from(orders)
    .where(and(eq(orders.tenantId, ctx.tenantId), isNull(orders.cancelledAt)));
  if (!win?.first || !win.last) throw new AppError("NO_DATA", "This store has no synced orders yet.");

  const range = resolveRange(input, storeToday(shop.timezone, win.newest ? new Date(win.newest).toISOString() : null));
  if (range.to < win.first || range.from > win.last) {
    throw new AppError("NO_DATA", `This store has orders from ${win.first} to ${win.last}; nothing lies in ${range.from} to ${range.to}.`);
  }

  const src = await loadSource(db, ctx.tenantId);
  const groups = await aggregate(src, range, filters, dims);

  // A quiet day, week or month inside the data window is a real zero, so it appears as a row.
  if (dims.length === 1 && timeDim) {
    const from = range.from < win.first ? win.first : range.from;
    const to = range.to > win.last ? win.last : range.to;
    for (const b of buckets(timeDim, from, to)) if (!groups.has(b)) groups.set(b, blank({ [timeDim]: b }));
  }
  if (dims.length === 0 && groups.size === 0) groups.set("", blank({}));

  let rows: MetricRow[] = [...groups.values()].map((a) => ({ group: a.group, values: valuesOf(a, metrics) }));

  if (dims.length > 0 && !timeDim) {
    for (const m of metrics.filter((m) => METRICS[m].additive)) {
      const total = rows.reduce((s, r) => s + (r.values[m] ?? 0), 0);
      if (total !== 0) for (const r of rows) (r.share ??= {})[m] = (r.values[m] ?? 0) / total;
    }
  }

  if (input.compareTo) {
    const prevRange = input.compareTo === "previous_year" ? sameRangeLastYear(range.from, range.to) : previousRange(range.from, range.to);
    const prev = await aggregate(src, prevRange, filters, dims);
    const keyOf = (g: Record<string, string>) => dims.map((d) => g[d]).join("\u0001");
    for (const r of rows) {
      const p = prev.get(keyOf(r.group));
      const before = valuesOf(p ?? blank(r.group), metrics);
      r.previous = before;
      r.change = {};
      r.pctChange = {};
      for (const m of metrics) {
        const change = (r.values[m] ?? 0) - (before[m] ?? 0);
        r.change[m] = change;
        r.pctChange[m] = before[m] ? change / before[m]! : null;
      }
    }
  }

  const byFirstMetric = metrics[0]!;
  rows.sort((a, b) =>
    timeDim
      ? String(a.group[timeDim]).localeCompare(String(b.group[timeDim]))
      : (b.values[byFirstMetric] ?? 0) - (a.values[byFirstMetric] ?? 0) || JSON.stringify(a.group).localeCompare(JSON.stringify(b.group)),
  );
  const limit = Math.min(input.limit ?? DEFAULT_ROWS, MAX_ROWS);
  const total = rows.length;
  rows = rows.slice(0, limit);

  const asOf = win.synced ? new Date(win.synced).toISOString() : new Date(0).toISOString();
  const queryId = `q_${createHash("sha256").update(JSON.stringify({ t: ctx.tenantId, input, asOf })).digest("hex").slice(0, 12)}`;
  return {
    data: rows,
    queryId,
    range,
    definitions: Object.fromEntries(metrics.map((m) => [m, METRICS[m].definition])),
    asOf,
    ...(total > rows.length ? { truncated: { shown: rows.length, total } } : {}),
  };
}
