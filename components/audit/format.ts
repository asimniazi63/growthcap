import { formatCents } from "@/lib/health/format";
import type { AuditFinding, AuditItem } from "@/lib/audit/checks";
import type { HealthFigureRow } from "@/lib/health/tool";

// How the audit's figures are labelled and written on the page. Pure, so it can be tested without a browser.

type Kind = "count" | "money" | "decimal";
interface Label {
  label: string;
  kind: Kind;
}

const FIGURES: Record<string, Label> = {
  orders: { label: "Orders", kind: "count" },
  discountedOrders: { label: "Orders with a discount", kind: "count" },
  netSalesCents: { label: "Net sales", kind: "money" },
  discountedNetSalesCents: { label: "Net sales on those orders", kind: "money" },
  discountGivenCents: { label: "Discounts given", kind: "money" },
  customers: { label: "Customers", kind: "count" },
  repeatCustomers: { label: "Customers who ordered again", kind: "count" },
  oneOrderCustomers: { label: "Customers with one order", kind: "count" },
  variantsAtRisk: { label: "Variants at risk", kind: "count" },
  variantsOutOfStock: { label: "Variants out of stock", kind: "count" },
  productsAtRisk: { label: "Products at risk", kind: "count" },
  productsFlagged: { label: "Products flagged", kind: "count" },
  storeUnitsSold: { label: "Units sold", kind: "count" },
  storeUnitsRefunded: { label: "Units refunded", kind: "count" },
  unitsLeft: { label: "Units left", kind: "count" },
  unitsSold: { label: "Units sold", kind: "count" },
  unitsRefunded: { label: "Units refunded", kind: "count" },
  dailyRate: { label: "Units a day", kind: "decimal" },
  daysOfCover: { label: "Days of cover", kind: "decimal" },
};

const SHARES: Record<string, string> = {
  discountedOrders: "Share of orders with a discount",
  discountedNetSales: "Share of net sales on those orders",
  repeatCustomers: "Repeat rate",
  storeRefundRate: "The store's refund rate",
  refundRate: "Refund rate",
};

// Thresholds and window sizes are explained in the text, not listed as results.
const HIDDEN = new Set(["coverFlagDays", "windowDays", "minUnitsSold", "flagAt", "flagBelow"]);

export const percent = (fraction: number): string => `${Math.round(fraction * 1000) / 10}%`;
const number = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });

export function writeFigure(kind: Kind, value: number, currency: string): string {
  return kind === "money" ? formatCents(value, currency) : number.format(value);
}

export interface FigureRow {
  label: string;
  value: string;
}

export function figureRows(source: { figures: Record<string, number | string>; share?: Record<string, number> }, currency: string): FigureRow[] {
  const rows: FigureRow[] = [];
  for (const [key, value] of Object.entries(source.figures)) {
    if (HIDDEN.has(key)) continue;
    const spec = FIGURES[key];
    if (!spec) continue;
    rows.push({ label: spec.label, value: typeof value === "number" ? writeFigure(spec.kind, value, currency) : String(value) });
  }
  for (const [key, value] of Object.entries(source.share ?? {})) {
    if (HIDDEN.has(key) || !SHARES[key]) continue;
    rows.push({ label: SHARES[key]!, value: percent(value) });
  }
  return rows;
}

export function itemRows(item: AuditItem, currency: string): FigureRow[] {
  return figureRows(item, currency);
}

// One line for a health check, from its numbers.
export function healthLine(row: HealthFigureRow, currency: string): string {
  if (row.failed) return "Couldn't run this check";
  const f = row.figures;
  switch (row.id) {
    case "variants_no_cost":
    case "orders_no_customer":
      return f.total !== undefined ? `${number.format(f.missing ?? 0)} of ${number.format(f.total)}` : number.format(f.missing ?? 0);
    case "days_no_orders":
      return f.span !== undefined ? `${number.format(f.missing ?? 0)} of ${number.format(f.span)} days` : number.format(f.missing ?? 0);
    case "skewing_order":
      return row.status === "warn" && f.timesMedian !== undefined ? `${row.orderName ?? "One order"} is ${number.format(f.timesMedian)} times the median (${formatCents(f.netCents ?? 0, currency)})` : "None";
    case "sync_lag":
      return f.hoursSinceSync === undefined ? "Not synced yet" : f.hoursSinceSync < 1 ? "Under 1 hour ago" : `${f.hoursSinceSync} ${f.hoursSinceSync === 1 ? "hour" : "hours"} ago`;
  }
}

export const severityLabel = (f: Pick<AuditFinding, "flagged" | "severity">): string => (f.flagged ? `Impact ${f.severity} of 100` : "Worth watching");
