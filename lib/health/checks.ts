import { and, count, countDistinct, desc, eq, isNull, max, min, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { orders, refunds, variants } from "../db/schema";
import { formatCents, plural } from "./format";
import { hoursSince, isStale, lagLabel, STALE_AFTER_HOURS } from "./freshness";

export type HealthCheckId = "variants_no_cost" | "orders_no_customer" | "days_no_orders" | "skewing_order" | "sync_lag";

export interface HealthCheck {
  id: HealthCheckId;
  label: string;
  detail?: string;
  value: string;
  status: "ok" | "warn";
  failed?: boolean; // the query failed, so value is a message, not a result
}

export interface HealthCheckOptions {
  now: Date;
  currency?: string; // the store currency, for the skewing order's amounts
  asOf?: Date | null; // when order data was last written; looked up when left out
}

// An order counts as skewing the averages when its net sales are more than this many times the median order.
export const SKEW_MULTIPLE = 10;
export const CHECK_FAILED = "Couldn't run this check";

const DAY_MS = 24 * 60 * 60 * 1000;

// Whole calendar days from first to last, both included. Both are YYYY-MM-DD store-local dates.
export function daysInWindow(first: string, last: string): number {
  return Math.round((Date.parse(`${last}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) / DAY_MS) + 1;
}

// One check failing must not take the others, or the page, down with it.
async function guard(id: HealthCheckId, label: string, run: () => Promise<Omit<HealthCheck, "id" | "label">>): Promise<HealthCheck> {
  try {
    return { id, label, ...(await run()) };
  } catch {
    console.error(`health check failed: ${id}`);
    return { id, label, value: CHECK_FAILED, status: "warn", failed: true };
  }
}

// An order's net sales in cents: gross minus discounts minus what was refunded on it (the same definition as the net_sales metric).
const orderNet = () =>
  sql<number>`(${orders.grossCents} - ${orders.discountCents} - coalesce((select sum(${refunds.amountCents}) from ${refunds} where ${refunds.tenantId} = ${orders.tenantId} and ${refunds.orderId} = ${orders.id}), 0))`;

const liveOrders = (tenantId: string) => and(eq(orders.tenantId, tenantId), isNull(orders.cancelledAt));

// Every query is filtered by tenantId; the tenant comes from the session at the call site.
export async function runHealthChecks(db: Db, tenantId: string, opts: HealthCheckOptions): Promise<HealthCheck[]> {
  const { now, currency = "USD" } = opts;

  return Promise.all([
    guard("variants_no_cost", "Variants without a unit cost", async () => {
      const [r] = await db
        .select({ total: count(), missing: count(sql`case when ${variants.unitCostCents} is null then 1 end`) })
        .from(variants)
        .where(eq(variants.tenantId, tenantId));
      const total = r?.total ?? 0;
      const missing = r?.missing ?? 0;
      return { value: String(missing), detail: total > 0 ? `of ${plural(total, "variant")}` : "No variants yet", status: missing > 0 ? "warn" : "ok" };
    }),

    guard("orders_no_customer", "Orders without a customer", async () => {
      const [r] = await db
        .select({ total: count(), missing: count(sql`case when ${orders.customerId} is null then 1 end`) })
        .from(orders)
        .where(liveOrders(tenantId));
      const total = r?.total ?? 0;
      const missing = r?.missing ?? 0;
      return { value: String(missing), detail: total > 0 ? `of ${plural(total, "order")}` : "No orders yet", status: missing > 0 ? "warn" : "ok" };
    }),

    guard("days_no_orders", "Days with no orders", async () => {
      const [r] = await db
        .select({ first: min(orders.localDate), last: max(orders.localDate), days: countDistinct(orders.localDate) })
        .from(orders)
        .where(liveOrders(tenantId));
      if (!r?.first || !r.last) return { value: "0", detail: "No orders yet", status: "ok" };
      const span = daysInWindow(r.first, r.last);
      const missing = Math.max(0, span - Number(r.days));
      return { value: String(missing), detail: `of ${plural(span, "day")} between the first and last order`, status: missing > 0 ? "warn" : "ok" };
    }),

    guard("skewing_order", "One order skewing averages", async () => {
      const [m] = await db
        .select({ median: sql<number | null>`percentile_cont(0.5) within group (order by ${orderNet()}::double precision)` })
        .from(orders)
        .where(liveOrders(tenantId));
      const median = m?.median === null || m?.median === undefined ? null : Number(m.median);
      if (median === null || median <= 0) return { value: "None", status: "ok" };
      const [top] = await db
        .select({ name: orders.name, net: orderNet().mapWith(Number) })
        .from(orders)
        .where(liveOrders(tenantId))
        .orderBy(desc(orderNet()))
        .limit(1);
      if (!top || top.net <= median * SKEW_MULTIPLE) return { value: "None", detail: `No order is more than ${SKEW_MULTIPLE} times the median`, status: "ok" };
      const times = (top.net / median).toFixed(1);
      return {
        value: top.name,
        detail: `${formatCents(top.net, currency)} net, ${times} times the median order of ${formatCents(Math.round(median), currency)}`,
        status: "warn",
      };
    }),

    guard("sync_lag", "Sync lag", async () => {
      let asOf = opts.asOf;
      if (asOf === undefined) {
        const [r] = await db.select({ at: max(orders.syncedAt) }).from(orders).where(liveOrders(tenantId));
        asOf = r?.at ? new Date(r.at) : null;
      }
      const hours = hoursSince(asOf, now);
      if (hours === null) return { value: "Not synced yet", status: "warn" };
      return { value: lagLabel(hours), detail: `Flagged after ${STALE_AFTER_HOURS} hours`, status: isStale(asOf, now) ? "warn" : "ok" };
    }),
  ]);
}

export function checksToLookAt(checks: readonly HealthCheck[]): number {
  return checks.filter((c) => c.status === "warn").length;
}
