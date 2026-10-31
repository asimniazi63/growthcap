import type { Db } from "../db/client";
import { AppError } from "../errors";
import { monthEnd, monthStart } from "../metrics/dates";
import { queryMetric } from "../metrics/query";
import { loadPlan } from "../pace/gap";
import { shopFor, tenantScoped, type TenantContext } from "../tenancy/context";
import type { DriverKind, DriverNode, DriverTreeResult } from "./types";

// Splits a finished month's net-sales gap to plan into five parts that add up to the gap exactly. Deterministic: the same
// data and plan give the same tree, and no model is involved.
//
// Net sales = orders x average order value (AOV), summed over new and returning customers, less refunds. The midpoint split
// gives each product's change as  dO x (A0 + A1)/2  +  dA x (O0 + O1)/2,  which equals O1 x A1 - O0 x A0 exactly, so the
// parts add up in any order.
//
// The plan holds only net sales, orders, new-customer orders and one AOV, so the planned split is derived from those:
//  - planned new-customer orders come from the plan; planned returning orders are the rest of its orders;
//  - new and returning customers have the SAME planned AOV (the plan's own AOV, or net sales / orders when it has none);
//  - planned refunds are what makes the plan add up: orders x AOV - net sales (zero when the plan has no AOV).
// Returning includes guest orders, as the customer_type grouping does. A group with no orders takes the planned AOV, so
// its whole shortfall lands on orders, not on AOV.

interface Group {
  orders: number;
  value: number; // gross sales - discounts, in cents
}

const LABELS: Record<DriverKind, string> = {
  new_customer_orders: "New-customer orders",
  returning_customer_orders: "Returning-customer orders",
  new_customer_aov: "New-customer average order value",
  returning_customer_aov: "Returning-customer average order value",
  refunds: "Refunds",
};

// A tenant context for the metric layer, which wants a shop. driverTree is called with a tenant id only (the portfolio page
// calls it for every brand), and it reads rows already synced, so a brand whose store has since disconnected still has a
// tree. The shop's time zone is used when it is known; the explicit month range below doesn't depend on it.
async function metricContext(db: Db, tenantId: string): Promise<TenantContext> {
  const shop = await shopFor(tenantScoped(db, tenantId));
  return { tenantId, orgId: "", userId: "driver-tree", role: "gc_admin", shop: { domain: shop?.domain ?? "", timezone: shop?.timezone ?? "UTC", currency: shop?.currency ?? "USD", status: "connected" } };
}

// Rounds each part to whole cents and puts the rounding remainder on the largest part, so the parts add up to the gap.
function roundToGap(parts: number[], gap: number): number[] {
  const rounded = parts.map((p) => Math.round(p) || 0); // `|| 0` turns -0 into 0
  const remainder = gap - rounded.reduce((s, p) => s + p, 0);
  if (remainder !== 0) {
    let largest = 0;
    parts.forEach((p, i) => {
      if (Math.abs(p) > Math.abs(parts[largest]!)) largest = i;
    });
    rounded[largest]! += remainder;
  }
  return rounded;
}

export async function driverTree(db: Db, tenantId: string, period: { month: string }): Promise<DriverTreeResult> {
  const { month } = period;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new AppError("INVALID_INPUT", `${JSON.stringify(month).slice(0, 20)} is not a month (YYYY-MM).`);

  const plan = await loadPlan(db, tenantId);
  const target = plan?.targets.get(month);
  const targetCents = target?.net_sales;
  const plannedOrders = target?.orders;
  if (!target || targetCents === undefined || plannedOrders === undefined) throw new AppError("NO_DATA", `The plan has no net sales and orders target for ${month}.`);

  const ctx = await metricContext(db, tenantId);
  const range = { from: monthStart(month), to: monthEnd(month) };
  const [byType, total] = await Promise.all([
    queryMetric(ctx, { metrics: ["orders", "gross_sales", "discounts"], ...range, groupBy: ["customer_type"] }, { db }),
    queryMetric(ctx, { metrics: ["net_sales", "refunds"], ...range }, { db }),
  ]);
  const group = (type: "new" | "returning"): Group => {
    const row = byType.data.find((r) => r.group.customer_type === type);
    return { orders: row?.values.orders ?? 0, value: (row?.values.gross_sales ?? 0) - (row?.values.discounts ?? 0) };
  };
  const fresh = group("new");
  const back = group("returning");
  const actualCents = total.data[0]!.values.net_sales ?? 0;
  const refundsNow = total.data[0]!.values.refunds ?? 0;

  const plannedNew = Math.min(plannedOrders, target.new_customer_orders ?? Math.round((plannedOrders * fresh.orders) / Math.max(1, fresh.orders + back.orders)));
  const plannedBack = plannedOrders - plannedNew;
  const plannedAov = target.aov ?? (plannedOrders === 0 ? 0 : targetCents / plannedOrders);
  const plannedRefunds = plannedOrders * plannedAov - targetCents;

  const aovNow = (g: Group) => (g.orders === 0 ? plannedAov : g.value / g.orders);
  const aovNew = aovNow(fresh);
  const aovBack = aovNow(back);
  const gapCents = actualCents - targetCents;

  const kinds: DriverKind[] = ["new_customer_orders", "new_customer_aov", "returning_customer_orders", "returning_customer_aov", "refunds"];
  const raw = [
    (fresh.orders - plannedNew) * ((plannedAov + aovNew) / 2),
    (aovNew - plannedAov) * ((plannedNew + fresh.orders) / 2),
    (back.orders - plannedBack) * ((plannedAov + aovBack) / 2),
    (aovBack - plannedAov) * ((plannedBack + back.orders) / 2),
    -(refundsNow - plannedRefunds),
  ];
  const deltas = roundToGap(raw, gapCents);
  const measure: Record<DriverKind, Pick<DriverNode, "planned" | "actual" | "unit">> = {
    new_customer_orders: { planned: plannedNew, actual: fresh.orders, unit: "count" },
    returning_customer_orders: { planned: plannedBack, actual: back.orders, unit: "count" },
    new_customer_aov: { planned: Math.round(plannedAov), actual: Math.round(aovNew), unit: "money" },
    returning_customer_aov: { planned: Math.round(plannedAov), actual: Math.round(aovBack), unit: "money" },
    refunds: { planned: Math.round(plannedRefunds), actual: refundsNow, unit: "money" },
  };

  const drivers: DriverNode[] = kinds.map((kind, i) => ({
    id: `${month}:${kind}`,
    kind,
    label: LABELS[kind],
    deltaCents: deltas[i]!,
    shareOfGap: gapCents === 0 ? null : deltas[i]! / gapCents,
    ...measure[kind],
  }));
  drivers.sort((a, b) => Math.abs(b.deltaCents) - Math.abs(a.deltaCents)); // a stable sort: equal parts keep the order above

  return { month, targetCents, actualCents, gapCents, drivers };
}
