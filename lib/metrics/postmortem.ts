import { and, eq, isNull, max, min } from "drizzle-orm";
import type { Db } from "../db/client";
import { orders } from "../db/schema";
import type { TenantContext } from "../tenancy/context";
import { repeatRateOf, type CohortFilter, type CustomerHistory } from "./cohorts";
import { daysBetween } from "./dates";
import { queryMetric } from "./query";

// The maths and the reads behind get_promo_postmortem: how much extra a promotion sold against a baseline, how much of it was only
// pulled forward from the days after, and how good the customers it brought were. The tool does the validation and the envelope.
// Nothing here reads the clock or takes a tenant from anywhere but its argument (the tool passes the session's).

export interface Range {
  from: string;
  to: string;
}

export interface Totals {
  orders: number;
  netSalesCents: number;
}

export const daysIn = (r: Range): number => (r.to < r.from ? 0 : daysBetween(r.from, r.to) + 1);

// ---- Reads

// The first and last store-local date on which a non-cancelled order used the code. Null if none did.
export async function codeUsage(db: Db, tenantId: string, code: string): Promise<Range | null> {
  const [row] = await db
    .select({ first: min(orders.localDate), last: max(orders.localDate) })
    .from(orders)
    .where(and(eq(orders.tenantId, tenantId), isNull(orders.cancelledAt), eq(orders.discountCode, code)));
  return row?.first && row.last ? { from: row.first, to: row.last } : null;
}

// Orders, net sales and discounts for a range, from query_metric so the figures agree with it. `code` narrows to orders using it.
export async function totalsFor(ctx: TenantContext, db: Db, range: Range, code?: string): Promise<Totals & { discountCents: number }> {
  const res = await queryMetric(ctx, { metrics: ["orders", "net_sales", "discounts"], ...range, ...(code ? { filters: { discountCodes: [code] } } : {}) }, { db });
  const values = res.data[0]?.values ?? {};
  return { orders: values.orders ?? 0, netSalesCents: values.net_sales ?? 0, discountCents: values.discounts ?? 0 };
}

// ---- Lift maths

export interface LiftInput {
  baselineDays: number; // days actually in the data
  baseline: Totals;
  windowDays: number;
  during: Totals;
  afterDays: number; // days of the after range actually in the data (0 when the data ends with the window)
  after: Totals;
}

export interface Lift {
  ordersPerDay: number;
  netSalesPerDayCents: number;
  expected: Totals;
  extra: Totals & { pctOfExpected: number | null; ordersPctOfExpected: number | null };
  afterExpected: Totals;
  pulledForward: Totals;
  netLift: Totals;
}

const share = (part: number, whole: number): number | null => (whole === 0 ? null : part / whole);

// The baseline's daily rate times a number of days, rounded once, from the exact totals (not from the rounded daily rate).
const scaled = (t: Totals, fromDays: number, toDays: number): Totals => ({
  orders: Math.round((t.orders * toDays) / fromDays),
  netSalesCents: Math.round((t.netSalesCents * toDays) / fromDays),
});

export function liftOf(i: LiftInput): Lift {
  const expected = scaled(i.baseline, i.baselineDays, i.windowDays);
  const extra = { orders: i.during.orders - expected.orders, netSalesCents: i.during.netSalesCents - expected.netSalesCents };
  const afterExpected = i.afterDays === 0 ? { orders: 0, netSalesCents: 0 } : scaled(i.baseline, i.baselineDays, i.afterDays);
  const pulledForward = {
    orders: Math.max(0, afterExpected.orders - i.after.orders),
    netSalesCents: Math.max(0, afterExpected.netSalesCents - i.after.netSalesCents),
  };
  return {
    ordersPerDay: Math.round((i.baseline.orders / i.baselineDays) * 100) / 100,
    netSalesPerDayCents: Math.round(i.baseline.netSalesCents / i.baselineDays),
    expected,
    extra: { ...extra, pctOfExpected: share(extra.netSalesCents, expected.netSalesCents), ordersPctOfExpected: share(extra.orders, expected.orders) },
    afterExpected,
    pulledForward,
    netLift: { orders: extra.orders - pulledForward.orders, netSalesCents: extra.netSalesCents - pulledForward.netSalesCents },
  };
}

// ---- Customer quality

export interface CohortStats {
  range: Range;
  cohortCustomers: number; // customers whose first order is in the range
  customers: number; // those counted: first order at least repeatWindowDays old
  repeaters: number;
  repeatRate: number | null; // fraction; null when nobody is old enough yet
  notYetObserved: number; // cohort customers still inside their repeat window, left out of the rate
}

export function cohortStats(histories: CustomerHistory[], filter: CohortFilter, repeatWindowDays: number, asOf: string): CohortStats {
  const r = repeatRateOf(histories, filter, repeatWindowDays, asOf);
  return { range: { from: filter.from, to: filter.to }, cohortCustomers: r.cohortCustomers, customers: r.customers, repeaters: r.repeaters, repeatRate: r.repeatRate, notYetObserved: r.cohortCustomers - r.customers };
}

export const repeatGap = (promo: number | null, comparison: number | null): number | null => (promo === null || comparison === null ? null : promo - comparison);
