import { and, count, eq, gte, inArray, isNull, lte, max, min, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client";
import { orders } from "../db/schema";
import { assertInWindow, asOfOf, capLimit, dbFor, idList, limitField, loadWindow, parseInput, periodShape, queryIdFor, resolveRange, todayFor, type Ctx } from "./common";
import { requireConnectedShop, type ToolResult } from "./result";

export const getCustomersInputSchema = z.strictObject({
  view: z.enum(["summary", "list"]).optional(),
  ...periodShape,
  customerIds: idList.optional(),
  rankBy: z.enum(["spend", "orders"]).optional(),
  minOrders: z.number().int().min(1).max(1000).optional(),
  limit: limitField,
});
export type GetCustomersInput = z.input<typeof getCustomersInputSchema>;

export interface CustomerSummary {
  activeCustomers: number;
  newCustomers: number;
  returningCustomers: number;
}

export interface CustomerRow {
  customerId: string; // pseudonym: CUST_ plus a hash. No name, email or address is held.
  orders: number; // in the range
  spendCents: number; // gross minus discounts, in the range
  firstOrderDate: string; // ever
  lastOrderDate: string; // in the range
  isNew: boolean; // the first-ever order falls in the range
}

const DEFINITIONS = {
  activeCustomers: "Customers with at least one order in the range. Guest orders with no customer record are not counted.",
  newCustomers: "Active customers whose first-ever order in this store falls in the range.",
  returningCustomers: "Active customers whose first-ever order was before the range. (The returning_customer_rate metric is counted per customer with any non-first order in the range, so the two differ.)",
  spendCents: "Gross sales minus discounts on the customer's orders in the range, in cents. Refunds are not taken off.",
};

// Customer counts and top customers, by pseudonymous id only.
export async function getCustomers(ctx: Ctx, rawInput: GetCustomersInput & { view: "list" }, deps?: { db?: Db }): Promise<ToolResult<CustomerRow[]>>;
export async function getCustomers(ctx: Ctx, rawInput: GetCustomersInput, deps?: { db?: Db }): Promise<ToolResult<CustomerSummary[] | CustomerRow[]>>;
export async function getCustomers(ctx: Ctx, rawInput: GetCustomersInput, deps: { db?: Db } = {}): Promise<ToolResult<CustomerSummary[] | CustomerRow[]>> {
  const shop = requireConnectedShop(ctx);
  const input = parseInput(getCustomersInputSchema, rawInput);
  const db = await dbFor(deps);
  const win = await loadWindow(db, ctx.tenantId);
  const range = resolveRange(input, todayFor(shop.timezone, win));
  assertInWindow(range, win);

  const base = [eq(orders.tenantId, ctx.tenantId), isNull(orders.cancelledAt), sql`${orders.customerId} is not null`];
  const mine = input.customerIds ? inArray(orders.customerId, input.customerIds) : undefined;

  const inRange = await db
    .select({
      customerId: orders.customerId,
      orders: count(),
      spend: sql<string>`sum(${orders.grossCents} - ${orders.discountCents})`,
      last: max(orders.localDate),
    })
    .from(orders)
    .where(and(...base, mine, gte(orders.localDate, range.from), lte(orders.localDate, range.to)))
    .groupBy(orders.customerId);
  const ids = inRange.map((r) => r.customerId!);
  const firsts = ids.length
    ? await db
        .select({ customerId: orders.customerId, first: min(orders.localDate) })
        .from(orders)
        .where(and(...base, inArray(orders.customerId, ids)))
        .groupBy(orders.customerId)
    : [];
  const firstOf = new Map(firsts.map((f) => [f.customerId!, f.first!]));

  const rows: CustomerRow[] = inRange.map((r) => ({
    customerId: r.customerId!,
    orders: r.orders,
    spendCents: Number(r.spend),
    firstOrderDate: firstOf.get(r.customerId!)!,
    lastOrderDate: r.last!,
    isNew: firstOf.get(r.customerId!)! >= range.from,
  }));

  const asOf = asOfOf(win);
  const common = { range, definitions: DEFINITIONS, asOf };
  if ((input.view ?? "summary") === "summary") {
    const fresh = rows.filter((r) => r.isNew).length;
    return {
      ...common,
      data: [{ activeCustomers: rows.length, newCustomers: fresh, returningCustomers: rows.length - fresh }],
      queryId: queryIdFor("get_customers", ctx.tenantId, input, asOf),
    };
  }

  const ranked = rows
    .filter((r) => r.orders >= (input.minOrders ?? 1))
    .sort((a, b) => (input.rankBy === "orders" ? b.orders - a.orders || b.spendCents - a.spendCents : b.spendCents - a.spendCents || b.orders - a.orders) || a.customerId.localeCompare(b.customerId));
  const data = ranked.slice(0, capLimit(input.limit, 10));
  return {
    ...common,
    data,
    queryId: queryIdFor("get_customers", ctx.tenantId, input, asOf),
    ...(ranked.length > data.length ? { truncated: { shown: data.length, total: ranked.length } } : {}),
  };
}
