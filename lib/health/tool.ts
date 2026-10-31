import { and, eq, isNull, max } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client";
import { orders } from "../db/schema";
import { loadWindow, parseInput, queryIdFor, dbFor, type Ctx } from "../tools/common";
import type { TenantContext } from "../tenancy/context";
import { requireConnectedShop, type ToolResult } from "../tools/result";
import { checksToLookAt, runHealthChecks, type HealthCheck, type HealthCheckId } from "./checks";
import { hoursSince, STALE_AFTER_HOURS } from "./freshness";

// The get_data_health tool (T14, feature 40): the same checks the Connect page shows, with every figure as a number so the
// number checker can match what the agent says. The checks' own `value` and `detail` are display text; the numbers are read
// back out of them here and never worked out a second time, so the tool and the page can't disagree.

export const getDataHealthInputSchema = z.strictObject({});

export interface HealthFigureRow {
  id: HealthCheckId;
  label: string;
  status: "ok" | "warn";
  failed?: boolean; // the check could not run, so there are no figures
  figures: Record<string, number>;
  orderName?: string; // for the skewing order: the order's name, an id the store gave it
}

export interface DataHealthData {
  checks: HealthFigureRow[];
  checksToLookAt: number;
}

export const HEALTH_DEFINITIONS: Record<string, string> = {
  variants_no_cost: "missing is how many variants have no unit cost, out of total variants. Margins can't be worked out for them.",
  orders_no_customer: "missing is how many orders (not cancelled) have no customer attached, out of total orders. Repeat and new-customer figures leave them out.",
  days_no_orders: "missing is how many days between the first and last order had no orders, out of span days. A long gap can mean a sync problem or a real quiet spell.",
  skewing_order: "flagged is 1 when one order's net sales are more than ten times the median order. timesMedian, netCents and medianCents describe that order. Average order value is pulled up by it.",
  sync_lag: `hoursSinceSync is whole hours since order data was last written. The check flags after ${STALE_AFTER_HOURS} hours (flagAfterHours).`,
};

const firstInt = (s: string | undefined): number | undefined => {
  const m = s?.match(/\d[\d,]*/);
  return m ? Number(m[0].replace(/,/g, "")) : undefined;
};
const asCents = (token: string | undefined): number | undefined => (token === undefined ? undefined : Math.round(Number(token.replace(/,/g, "")) * 100));

// The numbers of one check, as numbers. `now` and `asOf` are only for the sync lag.
export function healthRow(c: HealthCheck, now: Date, asOf: Date | null): HealthFigureRow {
  const row: HealthFigureRow = { id: c.id, label: c.label, status: c.status, figures: {} };
  if (c.failed) return { ...row, failed: true };
  const set = (k: string, v: number | undefined) => {
    if (v !== undefined && Number.isFinite(v)) row.figures[k] = v;
  };
  switch (c.id) {
    case "variants_no_cost":
    case "orders_no_customer":
      set("missing", firstInt(c.value));
      set("total", firstInt(c.detail));
      break;
    case "days_no_orders":
      set("missing", firstInt(c.value));
      set("span", firstInt(c.detail));
      break;
    case "skewing_order": {
      row.figures.flagged = c.status === "warn" ? 1 : 0;
      if (c.status === "warn") {
        row.orderName = c.value;
        const tokens = c.detail?.match(/\d[\d,]*(?:\.\d+)?/g) ?? [];
        set("netCents", asCents(tokens[0]));
        set("timesMedian", tokens[1] === undefined ? undefined : Number(tokens[1]));
        set("medianCents", asCents(tokens[2]));
      }
      break;
    }
    case "sync_lag": {
      const hours = hoursSince(asOf, now);
      if (hours !== null) set("hoursSinceSync", Math.floor(hours));
      set("flagAfterHours", STALE_AFTER_HOURS);
      break;
    }
  }
  return row;
}

export const healthRows = (checks: readonly HealthCheck[], now: Date, asOf: Date | null): HealthFigureRow[] => checks.map((c) => healthRow(c, now, asOf));

// When order data was last written, for the sync lag.
export async function ordersSyncedAt(db: Db, tenantId: string): Promise<Date | null> {
  const [r] = await db.select({ at: max(orders.syncedAt) }).from(orders).where(and(eq(orders.tenantId, tenantId), isNull(orders.cancelledAt)));
  return r?.at ? new Date(r.at) : null;
}

export async function getDataHealth(ctx: Ctx, rawInput: unknown, deps: { db?: Db; now?: Date } = {}): Promise<ToolResult<DataHealthData>> {
  const shop = requireConnectedShop(ctx);
  parseInput(getDataHealthInputSchema, rawInput);
  const db = await dbFor(deps);
  const now = deps.now ?? new Date();
  const asOf = await ordersSyncedAt(db, ctx.tenantId);
  const checks = await runHealthChecks(db, ctx.tenantId, { now, currency: shop.currency, asOf });
  const win = await loadWindow(db, ctx.tenantId);
  const today = now.toISOString().slice(0, 10);
  const asOfIso = asOf ? asOf.toISOString() : new Date(0).toISOString();
  const data: DataHealthData = { checks: healthRows(checks, now, asOf), checksToLookAt: checksToLookAt(checks) };
  return {
    data,
    queryId: queryIdFor("get_data_health", ctx.tenantId, {}, asOfIso),
    range: { from: win.first ?? today, to: win.last ?? today },
    definitions: HEALTH_DEFINITIONS,
    asOf: asOfIso,
  };
}

// Shaped like the entries of TOOL_DEFS in lib/agent/tools.ts, for the lead to add.
export const getDataHealthTool = {
  description:
    "Data-health checks for the store, as numbers: variants without a unit cost, orders without a customer, days with no orders, one order skewing averages, and how long ago the data last synced. Use it when asked whether the data can be trusted or is fresh.",
  schema: getDataHealthInputSchema,
  run: getDataHealth as (ctx: TenantContext, input: unknown, deps: { db?: Db }) => Promise<ToolResult<unknown>>,
};
