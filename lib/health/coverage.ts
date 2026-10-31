import { and, count, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { orders } from "../db/schema";

export interface MonthCount {
  month: string; // YYYY-MM, store time
  orders: number;
}

// The most months drawn in the strip; a longer history shows its latest months.
export const MAX_MONTHS = 24;

function nextMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return m === 12 ? `${y! + 1}-01` : `${y}-${String(m! + 1).padStart(2, "0")}`;
}

// Months with at least one order, filled in so a month with none shows as an empty bar instead of vanishing.
export function fillMonths(rows: readonly MonthCount[], max = MAX_MONTHS): MonthCount[] {
  if (rows.length === 0) return [];
  const byMonth = new Map(rows.map((r) => [r.month, r.orders]));
  const first = rows[0]!.month;
  const last = rows[rows.length - 1]!.month;
  const filled: MonthCount[] = [];
  for (let m = first; m <= last; m = nextMonth(m)) filled.push({ month: m, orders: byMonth.get(m) ?? 0 });
  return filled.slice(-max);
}

// Orders per store-local month, cancelled orders left out (the same window the page's date range uses).
export async function ordersPerMonth(db: Db, tenantId: string): Promise<MonthCount[]> {
  const month = sql<string>`to_char(${orders.localDate}, 'YYYY-MM')`;
  const rows = await db
    .select({ month, orders: count() })
    .from(orders)
    .where(and(eq(orders.tenantId, tenantId), isNull(orders.cancelledAt)))
    .groupBy(month)
    .orderBy(month);
  return fillMonths(rows);
}
