import type { Db } from "../db/client";
import { runHealthChecks } from "../health/checks";
import { healthRows, ordersSyncedAt, type HealthFigureRow } from "../health/tool";
import { queryMetric } from "../metrics/query";
import type { TenantContext } from "../tenancy/context";
import { dbFor, loadWindow, todayFor } from "../tools/common";
import { requireConnectedShop } from "../tools/result";
import { runAuditChecks, type AuditCheckId, type AuditFinding } from "./checks";
import { checksToLookAt } from "../health/checks";

// Everything the audit holds apart from the model's write-up: the health checks, the headline for the last 30 days, and the
// four findings with the top three marked. It is built in code, stored beside the write-up, and handed to the model by the
// run_growth_audit tool, so the page and the write-up always describe the same figures.

export interface AuditHeadline {
  netSalesCents: number;
  orders: number;
  aovCents: number;
  from: string;
  to: string;
  queryId: string; // the query_metric result these three came from
}

export interface AuditReport {
  version: 1;
  range: { from: string; to: string }; // the window the four checks read
  asOf: string;
  headline: AuditHeadline | null; // null when the last 30 days hold no orders
  health: HealthFigureRow[];
  healthToLookAt: number;
  findings: AuditFinding[]; // ranked
  opportunities: AuditCheckId[];
}

// ctx is the signed-in user's: the tenant and the store come from the session, never from input.
export async function buildAuditReport(ctx: TenantContext, deps: { db?: Db; now?: Date } = {}): Promise<AuditReport> {
  const shop = requireConnectedShop(ctx);
  const db = await dbFor(deps);
  const now = deps.now ?? new Date();
  const win = await loadWindow(db, ctx.tenantId);
  const today = todayFor(shop.timezone, win);
  const asOf = await ordersSyncedAt(db, ctx.tenantId);

  const [checks, health, headline] = await Promise.all([
    runAuditChecks(ctx, { db, today, first: win.first }),
    runHealthChecks(db, ctx.tenantId, { now, currency: shop.currency, asOf }),
    queryMetric(ctx, { metrics: ["net_sales", "orders", "aov"], period: "last_30_days" }, { db }).catch(() => null),
  ]);
  const row = headline?.data[0];
  return {
    version: 1,
    range: checks.range,
    asOf: win.synced ?? new Date(0).toISOString(),
    headline:
      headline && row
        ? {
            netSalesCents: row.values.net_sales ?? 0,
            orders: row.values.orders ?? 0,
            aovCents: row.values.aov ?? 0,
            from: headline.range.from,
            to: headline.range.to,
            queryId: headline.queryId,
          }
        : null,
    health: healthRows(health, now, asOf),
    healthToLookAt: checksToLookAt(health),
    findings: checks.findings,
    opportunities: checks.opportunities,
  };
}
