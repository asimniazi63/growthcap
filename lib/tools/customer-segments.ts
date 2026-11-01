import { z } from "zod";
import type { Db } from "../db/client";
import { AppError } from "../errors";
import { FALLBACK_TYPICAL_GAP_DAYS, loadSegmentData, summarizeSegments, typicalGapDays } from "../metrics/segments";
import { SEGMENT_IDS, SEGMENT_RULES, SEGMENTS, type SegmentCustomer, type SegmentOrActive } from "../segments/definitions";
import type { TenantContext } from "../tenancy/context";
import { asOfOf, capLimit, dbFor, limitField, loadWindow, parseInput, queryIdFor } from "./common";
import { requireConnectedShop, type ToolResult } from "./result";

const SEGMENT_CHOICES = [...SEGMENT_IDS, "active"] as const;
const SORTS = ["ltv", "churn_risk", "days_since_last"] as const;

// strictObject: an unknown key (a tenant, a shop, anything the model invents) is an error, not ignored.
export const getCustomerSegmentsInputSchema = z.strictObject({
  segment: z.enum(SEGMENT_CHOICES).optional(), // only this segment (default all)
  view: z.enum(["summary", "list"]).optional(), // summary: the segments' counts and averages; list: also the customers (default summary)
  sort: z.enum(SORTS).optional(), // list order; default ltv; churn_risk and days_since_last put the highest first
  limit: limitField, // customers listed, default 50, at most 200
});
export type GetCustomerSegmentsInput = z.input<typeof getCustomerSegmentsInputSchema>;

export interface CustomerSegmentRow {
  id: SegmentOrActive;
  title: string;
  description: string;
  customers: number;
  shareOfCustomers: number; // a fraction of all customers
  avgLtvCents: number;
  totalLtvCents: number;
  avgOrders: number;
  avgDaysSinceLast: number;
  avgChurnRisk: number; // a fraction
}

export interface CustomerSegmentsData {
  asOf: string; // the last day of synced orders: days since last order are counted to here
  totalCustomers: number; // distinct customers with a non-cancelled order, whatever the segment or limit asked for
  repeatCustomers: number; // of them, the ones with two or more orders
  ordersWithoutCustomer: number; // guest orders, left out of everything here
  typicalGapDays: number; // the usual days between orders in this store, used for the churn risk of one-order customers
  rules: typeof SEGMENT_RULES; // the thresholds behind the segments, as numbers
  segments: CustomerSegmentRow[]; // every segment (zero rows included), or only the one asked for
  customers?: SegmentCustomer[]; // only with view list
  caveats?: string[];
}

const ACTIVE_DESCRIPTION = "Everyone in none of the four segments: mostly recent buyers who are not champions and not yet due, and anyone with two or more orders whose last was over a year ago.";

const R = SEGMENT_RULES;
const DEFINITIONS = {
  segments: `A customer takes the first segment they fit, in this order: champions, at risk, due to reorder, one and done; anyone left is active. Days are counted from the customer's last order to asOf, the last day of synced orders. Due to reorder is days since the last order divided by the customer's own median gap between orders, from ${R.dueToReorder.minGapMultiple} to ${R.dueToReorder.maxGapMultiple}. Customers are pseudonymous ids with at least one non-cancelled order; guest orders with no customer (ordersWithoutCustomer) are left out.`,
  ltv: "Lifetime value so far: the customer's order lines over the whole data window (range), each after its discount and after the value of what was refunded from it, so a refund comes off the order it belongs to whenever it was made. Shipping and tax are not in it, and orders from before the first synced order are unknown. It is history, not a forecast.",
  rfm: "r, f and m are scores from 1 to 5 by a customer's rank among this store's customers: r from days since the last order (fewer days is higher), f from the number of orders, m from lifetime value. Customers with equal values get the same score (the average of their ranks), so where nearly everyone has one order the frequency score of those customers sits in the middle. Scores compare customers with each other, not with a benchmark.",
  churnRisk: `A heuristic of how overdue a customer is, not a prediction that they will leave. It is 0 until days since the last order passes the customer's own median gap between orders, then rises in a straight line to 1 at three times that gap. A customer with one order has no gap of their own, so typicalGapDays is used (the median of the repeat customers' median gaps; ${FALLBACK_TYPICAL_GAP_DAYS} when nobody has ordered twice). Two orders on one day count as a gap of one day. avgChurnRisk is the mean over a segment.`,
  medianGapDays: "The middle of the days between a customer's consecutive orders (for an even count, the average of the two middle gaps, so a half day can appear). null for a customer with one order.",
};

const noun = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

const SORT_KEYS: Record<(typeof SORTS)[number], (c: SegmentCustomer) => number> = {
  ltv: (c) => c.ltvCents,
  churn_risk: (c) => c.churnRisk,
  days_since_last: (c) => c.daysSinceLast,
};

// RFM scores, lifetime value, a churn-risk heuristic and the retention segments, per pseudonymous customer. The tenant is the
// session's; every figure is computed here, not by the model.
export async function getCustomerSegments(ctx: TenantContext, rawInput: GetCustomerSegmentsInput, deps: { db?: Db } = {}): Promise<ToolResult<CustomerSegmentsData>> {
  requireConnectedShop(ctx);
  const input = parseInput(getCustomerSegmentsInputSchema, rawInput);
  const db = await dbFor(deps);
  const win = await loadWindow(db, ctx.tenantId);
  if (!win.first || !win.last) throw new AppError("NO_DATA", "This store has no synced orders yet.");

  const { asOf, customers, ordersWithoutCustomer } = await loadSegmentData(db, ctx.tenantId, win);
  const info = new Map<SegmentOrActive, { title: string; description: string }>([
    ...SEGMENTS.map((s) => [s.id, { title: s.title, description: s.description }] as const),
    ["active", { title: "Active", description: ACTIVE_DESCRIPTION }] as const,
  ]);
  const rows = summarizeSegments(customers)
    .filter((s) => input.segment === undefined || s.segment === input.segment)
    .map(({ segment, ...s }): CustomerSegmentRow => ({ id: segment, ...info.get(segment)!, ...s }));

  const repeatCustomers = customers.filter((c) => c.orders >= 2).length;
  const caveats: string[] = [];
  if (customers.length === 0) caveats.push("No order in this store has a customer attached, so there are no customers to segment.");
  if (ordersWithoutCustomer > 0) caveats.push(`${noun(ordersWithoutCustomer, "order")} (ordersWithoutCustomer) have no customer, such as guest checkouts, and are left out of every figure here.`);
  if (customers.length > 0 && repeatCustomers < 2) {
    caveats.push(`Fewer than two customers have ordered more than once, so median gaps, the typical gap and every segment that needs repeat orders rest on almost nothing (the typical gap falls back to ${FALLBACK_TYPICAL_GAP_DAYS} days when nobody has ordered twice).`);
  }
  if (customers.length > 0) {
    for (const row of rows) if (row.customers === 0) caveats.push(`No customer is in ${row.title} right now.`);
  }

  const data: CustomerSegmentsData = {
    asOf,
    totalCustomers: customers.length,
    repeatCustomers,
    ordersWithoutCustomer,
    typicalGapDays: typicalGapDays(customers),
    rules: SEGMENT_RULES,
    segments: rows,
  };

  let truncated: ToolResult<unknown>["truncated"];
  if (input.view === "list") {
    const key = SORT_KEYS[input.sort ?? "ltv"];
    const chosen = customers
      .filter((c) => input.segment === undefined || c.segment === input.segment)
      .sort((a, b) => key(b) - key(a) || b.ltvCents - a.ltvCents || a.customerId.localeCompare(b.customerId));
    data.customers = chosen.slice(0, capLimit(input.limit));
    if (chosen.length > data.customers.length) truncated = { shown: data.customers.length, total: chosen.length };
  }
  if (caveats.length > 0) data.caveats = caveats;

  const syncedAt = asOfOf(win);
  return {
    data,
    queryId: queryIdFor("get_customer_segments", ctx.tenantId, input, syncedAt),
    range: { from: win.first, to: win.last },
    definitions: DEFINITIONS,
    asOf: syncedAt,
    ...(truncated ? { truncated } : {}),
  };
}

type Run = (ctx: TenantContext, input: never, deps: { db?: Db }) => Promise<ToolResult<unknown>>;

// The shape of an entry of TOOL_DEFS in lib/agent/tools.ts.
export const getCustomerSegmentsTool = {
  description:
    `Retention segments, lifetime value and churn risk, per pseudonymous customer (a CUST_ id only; no name, email or address). segments has one row per segment: champions (${R.champions.minOrders} or more orders, the latest within the last ${R.champions.maxDaysSinceLast} days), at_risk (${R.atRisk.minOrders} or more orders, the latest ${R.atRisk.minDaysSinceLast} to ${R.atRisk.maxDaysSinceLast} days ago), due_to_reorder (${R.dueToReorder.minOrders} or more orders, and the time since the last is close to the customer's own usual gap), one_and_done (one order, at least ${R.oneAndDone.minDaysSinceLast} days ago) and active (everyone else), each with customers, shareOfCustomers, avgLtvCents, totalLtvCents, avgOrders, avgDaysSinceLast and avgChurnRisk. The numbers behind the segments are in rules. Start with view summary; use view list, with a segment and a sort (ltv, churn_risk or days_since_last, highest first; limit defaults to 50), only to name customers: each row has orders, ltvCents, daysSinceLast, medianGapDays, the RFM scores r, f and m (1 to 5), churnRisk and segment. LTV is net of discounts and refunds. churnRisk is a heuristic of how overdue the customer is against their own usual gap, not a prediction: say so. Customers with no customer record (guest orders) are left out; ordersWithoutCustomer counts them. Read caveats and say them. Quote every figure as written (shares and churn risk as percentages, money in dollars); never work out a count, share, total or average yourself.`,
  schema: getCustomerSegmentsInputSchema as z.ZodType,
  run: getCustomerSegments as unknown as Run,
};
