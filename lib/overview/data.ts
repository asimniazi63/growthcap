import { eq } from "drizzle-orm";
import { listActions } from "../actions/ledger";
import { listBriefs, type BriefItem } from "../briefs/store";
import type { Db } from "../db/client";
import { tenants } from "../db/schema";
import { AppError, type ErrorCode } from "../errors";
import type { PaceSeries } from "../pace/series";
import { getPaceView, type PaceView } from "../pace/view";
import type { TenantContext } from "../tenancy/context";
import { getInventory, type InventoryRow } from "../tools/inventory";
import { COVER_DAYS } from "./attention";
import { shortDay } from "./format";

// Everything the Overview page reads, each part on its own: one query failing leaves the other cards standing. All of it is
// scoped by the tenant in `ctx`, which comes from the session.

export type Part<T> = { ok: true; value: T } | { ok: false; code: ErrorCode };

async function part<T>(run: () => Promise<T>): Promise<Part<T>> {
  try {
    return { ok: true, value: await run() };
  } catch (e) {
    return { ok: false, code: e instanceof AppError ? e.code : "INTERNAL_ERROR" };
  }
}

export type OverviewPace = PaceView & { series?: PaceSeries | null };

export interface PendingRow {
  id: string;
  kind: string;
  title: string;
  proposed: string; // "Oct 31"
}

export interface OverviewData {
  brand: string | null;
  pace: Part<OverviewPace> | null; // null when no store is connected
  stock: Part<{ rows: InventoryRow[]; total: number }> | null;
  pending: Part<{ rows: PendingRow[]; total: number }> | null; // null for a client viewer
  brief: Part<BriefItem | null>;
}

export const isGc = (ctx: TenantContext) => ctx.role === "gc_admin" || ctx.role === "gc_partner";

export async function loadOverview(ctx: TenantContext, db: Db): Promise<OverviewData> {
  const connected = ctx.shop?.status === "connected";
  const timezone = ctx.shop?.timezone ?? "UTC";
  const [brand, pace, stock, pending, brief] = await Promise.all([
    part(async () => (await db.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, ctx.tenantId)).limit(1))[0]?.name ?? null),
    connected ? part(() => getPaceView(ctx, { db }) as Promise<OverviewPace>) : null,
    // The same stock cover the agent's inventory tool states: units available over the last 30 days' sales rate.
    connected
      ? part(async () => {
          const res = await getInventory(ctx, { maxDaysOfCover: COVER_DAYS, limit: 5 }, { db });
          return { rows: res.data, total: res.truncated?.total ?? res.data.length };
        })
      : null,
    isGc(ctx)
      ? part(async () => {
          const proposed = await listActions(db, ctx, { status: "proposed" });
          return { rows: proposed.slice(0, 3).map((a) => ({ id: a.id, kind: a.kind, title: a.title, proposed: shortDay(a.createdAt, timezone) })), total: proposed.length };
        })
      : null,
    part(async () => (await listBriefs(db, ctx, 1))[0] ?? null),
  ]);
  return { brand: brand.ok ? brand.value : null, pace, stock, pending, brief };
}
