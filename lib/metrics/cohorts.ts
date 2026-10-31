import { and, eq, gte, isNull, lte, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { adSpend, orderLines, orders, refundLines, refunds, variants } from "../db/schema";
import { addDays, monthOf } from "./dates";

// The cohort maths behind repeat_rate, the cohort grid, zero_sales_days and unit economics. Demo scale: the rows are read for
// the tenant and folded in memory. Dates are store-local "YYYY-MM-DD" strings. Nothing here reads the clock or takes a tenant
// from anywhere but its argument (the tools pass the session's).

// ---- Customers' orders

export interface CustomerHistory {
  customerId: string;
  firstDate: string; // store-local date of the customer's first order in this store
  firstCode: string | null; // the discount code on that first order
  firstTags: string[];
  laterDates: string[]; // the dates of every later order, oldest first
}

// Every customer with at least one order, cancelled orders left out. The first order is the earliest by time, then by id.
export async function loadCustomerHistories(db: Db, tenantId: string): Promise<CustomerHistory[]> {
  const rows = await db
    .select({ customerId: orders.customerId, date: orders.localDate, code: orders.discountCode, tags: orders.tags })
    .from(orders)
    .where(and(eq(orders.tenantId, tenantId), isNull(orders.cancelledAt), sql`${orders.customerId} is not null`))
    .orderBy(orders.customerId, orders.processedAt, orders.id);
  const out: CustomerHistory[] = [];
  let current: CustomerHistory | null = null;
  for (const r of rows) {
    if (!current || current.customerId !== r.customerId) {
      current = { customerId: r.customerId!, firstDate: r.date, firstCode: r.code, firstTags: r.tags, laterDates: [] };
      out.push(current);
    } else current.laterDates.push(r.date);
  }
  return out;
}

export interface CohortFilter {
  from: string; // the first order falls on or after this date
  to: string; // and on or before this one
  firstOrderCode?: string; // the first order used this discount code
  excludeFirstOrderCode?: string;
  excludeTags?: string[]; // the first order carries none of these tags
}

export interface RepeatResult {
  cohortCustomers: number; // everyone whose first order is in the cohort
  customers: number; // those whose first order is at least windowDays old: the ones counted
  repeaters: number; // of those, the ones who ordered again within the window
  repeatRate: number | null; // repeaters / customers; null when nobody in the cohort is old enough
}

const inCohort = (h: CustomerHistory, f: CohortFilter): boolean =>
  h.firstDate >= f.from &&
  h.firstDate <= f.to &&
  (f.firstOrderCode === undefined || h.firstCode === f.firstOrderCode) &&
  (f.excludeFirstOrderCode === undefined || h.firstCode !== f.excludeFirstOrderCode) &&
  !(f.excludeTags ?? []).some((t) => h.firstTags.includes(t));

// The share of the cohort that ordered again within `windowDays` of the first order. A customer counts only if the whole window
// has been observed (the first order plus the window is on or before `asOf`, the newest order date in the data).
export function repeatRateOf(histories: CustomerHistory[], f: CohortFilter, windowDays: number, asOf: string): RepeatResult {
  let cohortCustomers = 0;
  let customers = 0;
  let repeaters = 0;
  for (const h of histories) {
    if (!inCohort(h, f)) continue;
    cohortCustomers++;
    const horizon = addDays(h.firstDate, windowDays);
    if (horizon > asOf) continue;
    customers++;
    if (h.laterDates.some((d) => d <= horizon)) repeaters++;
  }
  return { cohortCustomers, customers, repeaters, repeatRate: customers === 0 ? null : repeaters / customers };
}

// ---- Zero-sales days

// Units sold per variant per day (before refunds, cancelled orders left out) for a range.
export async function unitsByVariantDay(db: Db, tenantId: string, range: { from: string; to: string }, variantIds?: string[]): Promise<Map<string, Map<string, number>>> {
  const rows = await db
    .select({ variantId: orderLines.variantId, date: orders.localDate, units: sql<string>`sum(${orderLines.quantity})` })
    .from(orderLines)
    .innerJoin(orders, and(eq(orders.tenantId, orderLines.tenantId), eq(orders.id, orderLines.orderId)))
    .where(and(eq(orders.tenantId, tenantId), isNull(orders.cancelledAt), gte(orders.localDate, range.from), lte(orders.localDate, range.to), sql`${orderLines.variantId} is not null`))
    .groupBy(orderLines.variantId, orders.localDate);
  const out = new Map<string, Map<string, number>>();
  for (const r of rows) {
    if (variantIds && !variantIds.includes(r.variantId!)) continue;
    const days = out.get(r.variantId!) ?? new Map<string, number>();
    days.set(r.date, Number(r.units));
    out.set(r.variantId!, days);
  }
  return out;
}

export const STOCKOUT_LOOKBACK_DAYS = 28;
export const STOCKOUT_MIN_DAILY_UNITS = 0.5;

// The days in the range with no sales for a variant that averaged at least 0.5 units a day over the 28 days before the day.
export function zeroSalesDaysOf(perDay: Map<string, number>, range: { from: string; to: string }): string[] {
  const days: string[] = [];
  for (let d = range.from; d <= range.to; d = addDays(d, 1)) {
    if ((perDay.get(d) ?? 0) > 0) continue;
    let prior = 0;
    for (let k = 1; k <= STOCKOUT_LOOKBACK_DAYS; k++) prior += perDay.get(addDays(d, -k)) ?? 0;
    if (prior / STOCKOUT_LOOKBACK_DAYS >= STOCKOUT_MIN_DAILY_UNITS) days.push(d);
  }
  return days;
}

// ---- Unit economics

// One fact per order line in [from, to] with what it earned, by the order's month: gross less discount, less the value of refunded
// items (taken off in the month of the ORDER, so a cohort's margin stays with the cohort), and today's unit cost times units
// kept. Variants with no cost are marked `costed: false`. `customerId` lets the caller assign a line to a cohort.
export async function loadLineMargins(db: Db, tenantId: string, range: { from: string; to: string }): Promise<{ month: string; customerId: string | null; net: number; cost: number; costed: boolean; qty: number }[]> {
  const lineRows = await db
    .select({
      lineId: orderLines.id,
      date: orders.localDate,
      customerId: orders.customerId,
      qty: orderLines.quantity,
      unit: orderLines.unitPriceCents,
      discount: orderLines.discountCents,
      cost: variants.unitCostCents,
    })
    .from(orderLines)
    .innerJoin(orders, and(eq(orders.tenantId, orderLines.tenantId), eq(orders.id, orderLines.orderId)))
    .leftJoin(variants, and(eq(variants.tenantId, orderLines.tenantId), eq(variants.id, orderLines.variantId)))
    .where(and(eq(orders.tenantId, tenantId), isNull(orders.cancelledAt), gte(orders.localDate, range.from), lte(orders.localDate, range.to)));
  const refundRows = await db
    .select({ lineId: refundLines.orderLineId, qty: sql<string>`sum(${refundLines.quantity})`, amount: sql<string>`sum(${refundLines.subtotalCents})` })
    .from(refundLines)
    .innerJoin(refunds, and(eq(refunds.tenantId, refundLines.tenantId), eq(refunds.id, refundLines.refundId)))
    .where(eq(refunds.tenantId, tenantId))
    .groupBy(refundLines.orderLineId);
  const refunded = new Map(refundRows.filter((r) => r.lineId).map((r) => [r.lineId!, { qty: Number(r.qty), amount: Number(r.amount) }]));
  return lineRows.map((r) => {
    const back = refunded.get(r.lineId) ?? { qty: 0, amount: 0 };
    const costed = r.cost !== null;
    return {
      month: monthOf(r.date),
      customerId: r.customerId,
      net: r.qty * r.unit - r.discount - back.amount,
      cost: costed ? r.cost! * Math.max(0, r.qty - back.qty) : 0,
      costed,
      qty: r.qty,
    };
  });
}

export async function adSpendByMonth(db: Db, tenantId: string, range: { from: string; to: string }): Promise<Map<string, number>> {
  const rows = await db
    .select({ date: adSpend.date, cents: sql<number>`sum(${adSpend.spendCents})::int` })
    .from(adSpend)
    .where(and(eq(adSpend.tenantId, tenantId), gte(adSpend.date, range.from), lte(adSpend.date, range.to)))
    .groupBy(adSpend.date);
  const out = new Map<string, number>();
  for (const r of rows) out.set(monthOf(r.date), (out.get(monthOf(r.date)) ?? 0) + r.cents);
  return out;
}

