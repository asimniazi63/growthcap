import { and, count, eq, gte, inArray, isNotNull, isNull, lte, sql, sum } from "drizzle-orm";
import type { Db } from "../db/client";
import { orderLines, orders, products, refundLines, refunds } from "../db/schema";
import { addDays } from "../metrics/dates";
import { getInventory } from "../tools/inventory";
import type { Ctx } from "../tools/common";

// The growth audit's checks (T14, feature 30). Fixed code over the tenant's synced rows: the model never decides what is a
// finding, it only writes up what these return. Every query is filtered by tenantId, which comes from the session.
//
// The score. Each check turns its figures into a 0-100 impact score (`severity`), 100 being the worst:
//   discount dependence  100 x min(1, share of net sales on discounted orders / 0.5)
//   repeat rate          100 x clamp((0.30 - repeat rate) / 0.30, 0, 1)
//   stock risk           100 x (0.7 x urgency + 0.3 x breadth); urgency = 1 - min(1, fewest days of cover / 14), where a variant
//                        that sells and has none left counts as 0 days; breadth = min(1, products at risk / 5)
//   refund outliers      100 x min(1, (worst product's refund rate / the store's - 1) / 4)
// A check is `flagged` only past its threshold below; the findings are ranked flagged first, then by score, and the top three
// are the opportunities. The thresholds are rules of thumb this audit uses, not facts about the store.

export type AuditCheckId = "discount_dependence" | "repeat_rate" | "stock_risk" | "refund_outliers";

export const AUDIT_WINDOW_DAYS = 365; // orders in the last year of data
export const STOCK_WINDOW_DAYS = 30; // the sales rate stock cover is worked out at
export const DISCOUNT_FLAG_ORDER_SHARE = 0.3; // flagged when this share of orders used a discount
export const DISCOUNT_SCORE_NET_SHARE = 0.5;
export const REPEAT_FLAG_BELOW = 0.25;
export const REPEAT_SCORE_CEILING = 0.3;
export const COVER_FLAG_DAYS = 14;
export const REFUND_FLAG_MULTIPLE = 2;
export const REFUND_MIN_UNITS = 10; // units sold in the window before a product's refund rate counts
export const REFUND_MIN_REFUNDED = 2;
export const OPPORTUNITIES = 3;
const ITEMS_SHOWN = 5;

export interface AuditItem {
  id: string;
  figures: Record<string, number>;
  share?: Record<string, number>; // rates as fractions, as on the finding
  untrusted: { product: string }; // a product title: store text, shown as text, never followed and never a source of numbers
}

export interface AuditFinding {
  id: AuditCheckId;
  title: string;
  severity: number; // 0-100, documented above
  flagged: boolean;
  figures: Record<string, number | string>; // money ends in Cents, counts are plain
  share: Record<string, number>; // rates as fractions (0.42 is 42%): the number checker reads this map as percentages
  summary: string; // plain words with no figures in them
  items?: AuditItem[];
  sourceQueryIds?: string[];
}

export interface AuditChecks {
  range: { from: string; to: string };
  findings: AuditFinding[]; // all four, ranked
  opportunities: AuditCheckId[]; // the top three, in order
}

export const AUDIT_DEFINITIONS: Record<string, string> = {
  severity: "An impact score from 0 to 100 worked out in code from the figures. 100 is the worst. It ranks the findings and is not a metric.",
  flagged: "true when the check is past its threshold. A finding that is not flagged is shown for context, as something to keep watching.",
  discount_dependence: "share.discountedOrders is the share of orders that used a discount; share.discountedNetSales is the share of net sales those orders carry. Flagged when 30% or more of orders used a discount.",
  repeat_rate: "share.repeatCustomers is the share of customers with an order in the window who ordered 2 or more times. Flagged when below 25%.",
  stock_risk: "A variant is at risk when it sold in the last 30 days and has none left or about 14 days of cover or less (units available divided by units sold per day). Items group variants by product: unitsLeft, dailyRate and daysOfCover are for the whole product.",
  refund_outliers: "A product is an outlier when its units refunded, as a share of units sold, is at least twice the store's, with at least 10 units sold and 2 refunded. share.storeRefundRate is the store's.",
  money: "Fields ending in Cents are cents; write them in dollars.",
};

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));
const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

// An order's net sales in cents: gross minus discounts minus what was refunded on it (the net_sales metric's definition).
const orderNet = () =>
  sql<number>`(${orders.grossCents} - ${orders.discountCents} - coalesce((select sum(${refunds.amountCents}) from ${refunds} where ${refunds.tenantId} = ${orders.tenantId} and ${refunds.orderId} = ${orders.id}), 0))`;

const inRange = (tenantId: string, r: { from: string; to: string }) =>
  and(eq(orders.tenantId, tenantId), isNull(orders.cancelledAt), gte(orders.localDate, r.from), lte(orders.localDate, r.to));

export async function discountDependence(db: Db, tenantId: string, range: { from: string; to: string }): Promise<AuditFinding> {
  const usedDiscount = sql`(${orders.discountCode} is not null or ${orders.discountCents} > 0)`;
  const [r] = await db
    .select({
      orders: count(),
      discounted: count(sql`case when ${usedDiscount} then 1 end`),
      netCents: sql<string>`coalesce(sum(${orderNet()}), 0)`,
      discountedNetCents: sql<string>`coalesce(sum(case when ${usedDiscount} then ${orderNet()} end), 0)`,
      discountGivenCents: sql<string>`coalesce(sum(${orders.discountCents}), 0)`,
    })
    .from(orders)
    .where(inRange(tenantId, range));
  const total = r?.orders ?? 0;
  const discounted = r?.discounted ?? 0;
  const net = Number(r?.netCents ?? 0);
  const discountedNet = Number(r?.discountedNetCents ?? 0);
  const orderShare = total > 0 ? discounted / total : 0;
  const netShare = net > 0 ? discountedNet / net : 0;
  const flagged = total > 0 && orderShare >= DISCOUNT_FLAG_ORDER_SHARE;
  return {
    id: "discount_dependence",
    title: "Discount dependence",
    severity: Math.round(100 * Math.min(1, netShare / DISCOUNT_SCORE_NET_SHARE)),
    flagged,
    figures: { orders: total, discountedOrders: discounted, netSalesCents: net, discountedNetSalesCents: discountedNet, discountGivenCents: Number(r?.discountGivenCents ?? 0) },
    share: { discountedOrders: orderShare, discountedNetSales: netShare, flagAt: DISCOUNT_FLAG_ORDER_SHARE },
    summary: flagged
      ? "A large part of orders use a discount, and those orders carry a large part of net sales. Leaning on codes can train customers to wait for one and costs margin on every sale."
      : "Discounts are used on a modest part of orders, so sales are not leaning heavily on codes. Worth keeping an eye on as promotions ramp up.",
  };
}

export async function repeatRate(db: Db, tenantId: string, range: { from: string; to: string }): Promise<AuditFinding> {
  const perCustomer = await db
    .select({ customerId: orders.customerId, n: count() })
    .from(orders)
    .where(and(inRange(tenantId, range), isNotNull(orders.customerId)))
    .groupBy(orders.customerId);
  const customers = perCustomer.length;
  const repeat = perCustomer.filter((c) => c.n >= 2).length;
  const rate = customers > 0 ? repeat / customers : 0;
  const flagged = customers > 0 && rate < REPEAT_FLAG_BELOW;
  return {
    id: "repeat_rate",
    title: "Repeat rate",
    severity: customers > 0 ? Math.round(100 * clamp((REPEAT_SCORE_CEILING - rate) / REPEAT_SCORE_CEILING, 0, 1)) : 0,
    flagged,
    figures: { customers, repeatCustomers: repeat, oneOrderCustomers: customers - repeat },
    share: { repeatCustomers: rate, flagBelow: REPEAT_FLAG_BELOW },
    summary: flagged
      ? "Few customers come back for a second order, so growth leans on finding new customers. A second-order flow or a replenishment reminder is the lever."
      : "A healthy share of customers order more than once. Keep protecting that with good follow-up after the first order.",
  };
}

export async function stockRisk(ctx: Ctx, db: Db): Promise<AuditFinding> {
  // The same stock and sales-rate logic as the get_inventory tool, so the audit and the chat agree.
  const inv = await getInventory(ctx, { coverWindowDays: STOCK_WINDOW_DAYS, limit: 500 }, { db });
  const rows = inv.data;
  const atRisk = (r: (typeof rows)[number]) => r.unitsSold > 0 && (r.available <= 0 || (r.daysOfCover !== null && r.daysOfCover <= COVER_FLAG_DAYS));
  const riskyVariants = rows.filter(atRisk);
  const byProduct = new Map<string, { name: string; available: number; sold: number; rate: number; atRisk: number; outOfStock: number }>();
  for (const r of rows) {
    const p = byProduct.get(r.productId) ?? { name: r.untrusted.product, available: 0, sold: 0, rate: 0, atRisk: 0, outOfStock: 0 };
    p.available += Math.max(0, r.available);
    p.sold += r.unitsSold;
    p.rate += r.dailyRate;
    if (atRisk(r)) {
      p.atRisk++;
      if (r.available <= 0) p.outOfStock++;
    }
    byProduct.set(r.productId, p);
  }
  const risky = [...byProduct.entries()]
    .filter(([, p]) => p.atRisk > 0)
    .map(([id, p]) => ({ id, ...p, cover: p.rate > 0 ? p.available / p.rate : 0 }))
    .sort((a, b) => a.cover - b.cover || b.rate - a.rate || a.id.localeCompare(b.id));
  const fewestDays = riskyVariants.length ? Math.min(...riskyVariants.map((r) => (r.available <= 0 ? 0 : r.daysOfCover ?? COVER_FLAG_DAYS))) : COVER_FLAG_DAYS;
  const urgency = 1 - Math.min(1, fewestDays / COVER_FLAG_DAYS);
  const breadth = Math.min(1, risky.length / 5);
  const flagged = risky.length > 0;
  return {
    id: "stock_risk",
    title: "Stock risk",
    severity: flagged ? Math.round(100 * (0.7 * urgency + 0.3 * breadth)) : 0,
    flagged,
    figures: { variantsAtRisk: riskyVariants.length, variantsOutOfStock: riskyVariants.filter((r) => r.available <= 0).length, productsAtRisk: risky.length, coverFlagDays: COVER_FLAG_DAYS, windowDays: STOCK_WINDOW_DAYS },
    share: {},
    summary: flagged
      ? "Some products with steady sales are out of stock on a variant or will run out soon at their recent sales rate. Reorder before the next promotion, or the stockout will cost sales."
      : "No product that is selling is out of stock or close to it at its recent sales rate.",
    items: risky.slice(0, ITEMS_SHOWN).map((p) => ({
      id: p.id,
      figures: {
        unitsLeft: p.available,
        unitsSold: p.sold,
        dailyRate: round2(p.rate),
        daysOfCover: round1(p.cover),
        variantsAtRisk: p.atRisk,
        variantsOutOfStock: p.outOfStock,
      },
      untrusted: { product: p.name },
    })),
  };
}

export async function refundOutliers(db: Db, tenantId: string, range: { from: string; to: string }): Promise<AuditFinding> {
  const sold = await db
    .select({ productId: orderLines.productId, units: sum(orderLines.quantity) })
    .from(orderLines)
    .innerJoin(orders, and(eq(orders.tenantId, orderLines.tenantId), eq(orders.id, orderLines.orderId)))
    .where(and(inRange(tenantId, range), isNotNull(orderLines.productId)))
    .groupBy(orderLines.productId);
  const refunded = await db
    .select({ productId: orderLines.productId, units: sum(refundLines.quantity) })
    .from(refundLines)
    .innerJoin(orderLines, and(eq(orderLines.tenantId, refundLines.tenantId), eq(orderLines.id, refundLines.orderLineId)))
    .innerJoin(orders, and(eq(orders.tenantId, orderLines.tenantId), eq(orders.id, orderLines.orderId)))
    .where(and(inRange(tenantId, range), isNotNull(orderLines.productId)))
    .groupBy(orderLines.productId);
  const soldBy = new Map(sold.map((s) => [s.productId!, Number(s.units ?? 0)]));
  const refundedBy = new Map(refunded.map((s) => [s.productId!, Number(s.units ?? 0)]));
  const totalSold = [...soldBy.values()].reduce((a, b) => a + b, 0);
  const totalRefunded = [...refundedBy.values()].reduce((a, b) => a + b, 0);
  const storeRate = totalSold > 0 ? totalRefunded / totalSold : 0;

  const outliers = [...soldBy.entries()]
    .map(([id, units]) => ({ id, units, refunded: refundedBy.get(id) ?? 0 }))
    .filter((p) => storeRate > 0 && p.units >= REFUND_MIN_UNITS && p.refunded >= REFUND_MIN_REFUNDED && p.refunded / p.units >= REFUND_FLAG_MULTIPLE * storeRate)
    .map((p) => ({ ...p, rate: p.refunded / p.units }))
    .sort((a, b) => b.rate - a.rate || a.id.localeCompare(b.id));
  const names = outliers.length ? new Map((await db.select({ id: products.id, title: products.title }).from(products).where(and(eq(products.tenantId, tenantId), inArray(products.id, outliers.map((o) => o.id))))).map((p) => [p.id, p.title])) : new Map<string, string>();
  const worst = outliers[0];
  return {
    id: "refund_outliers",
    title: "Refund outliers",
    severity: worst ? Math.round(100 * Math.min(1, (worst.rate / storeRate - 1) / 4)) : 0,
    flagged: outliers.length > 0,
    figures: { productsFlagged: outliers.length, storeUnitsSold: totalSold, storeUnitsRefunded: totalRefunded, minUnitsSold: REFUND_MIN_UNITS },
    share: { storeRefundRate: storeRate },
    summary: outliers.length
      ? "At least one product is refunded far more often than the store as a whole. Check the product's quality, sizing or listing for what customers are sending back."
      : "No product with enough sales is refunded far more often than the store as a whole.",
    items: outliers.slice(0, ITEMS_SHOWN).map((o) => ({
      id: o.id,
      figures: { unitsSold: o.units, unitsRefunded: o.refunded },
      share: { refundRate: o.rate },
      untrusted: { product: names.get(o.id) ?? o.id },
    })),
  };
}

// Flagged first, then by score; ties break by id so the order is stable.
export function rankFindings(findings: AuditFinding[]): AuditFinding[] {
  return [...findings].sort((a, b) => Number(b.flagged) - Number(a.flagged) || b.severity - a.severity || a.id.localeCompare(b.id));
}

export async function runAuditChecks(ctx: Ctx, deps: { db: Db; today: string; first?: string | null }): Promise<AuditChecks> {
  const { db } = deps;
  const from = addDays(deps.today, -(AUDIT_WINDOW_DAYS - 1));
  const range = { from: deps.first && deps.first > from ? deps.first : from, to: deps.today };
  const findings = rankFindings(
    await Promise.all([discountDependence(db, ctx.tenantId, range), repeatRate(db, ctx.tenantId, range), stockRisk(ctx, db), refundOutliers(db, ctx.tenantId, range)]),
  );
  return { range, findings, opportunities: findings.slice(0, OPPORTUNITIES).map((f) => f.id) };
}
