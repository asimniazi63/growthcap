import { createHash } from "node:crypto";
import { and, eq, isNull, max, min } from "drizzle-orm";
import { z } from "zod";
import { storeToday } from "../clock";
import type { Db } from "../db/client";
import { orders } from "../db/schema";
import { AppError } from "../errors";
import { addDays, addMonths, isValidDate, monthEnd, monthOf, monthStart } from "../metrics/dates";
import type { TenantContext } from "../tenancy/context";

// Pieces every tool shares, so they all validate, date and cap results the same way.

export const PERIODS = ["last_7_days", "last_30_days", "this_month", "last_month", "this_year"] as const;
export type Period = (typeof PERIODS)[number];

export const DEFAULT_ROWS = 50;
export const MAX_ROWS = 200;

export const dateString = z.string().refine(isValidDate, "must be a real date written YYYY-MM-DD");
export const idList = z.array(z.string().min(1).max(200)).max(50);
// Accepts up to 500 and returns at most MAX_ROWS, saying so in `truncated`.
export const limitField = z.number().int().min(1).max(500).optional();
export const periodShape = {
  period: z.enum(PERIODS).optional(),
  from: dateString.optional(),
  to: dateString.optional(),
};

export const capLimit = (limit: number | undefined, fallback = DEFAULT_ROWS) => Math.min(limit ?? fallback, MAX_ROWS);

// The model's input is checked by a strict schema: an unknown key (a tenant, a shop, anything invented) is an error.
export function parseInput<S extends z.ZodType>(schema: S, raw: unknown): z.output<S> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new AppError("INVALID_INPUT", parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; "));
  }
  return parsed.data;
}

export interface DataWindow {
  first: string | null; // store-local date of the first order
  last: string | null;
  newest: string | null; // timestamp of the newest order
  synced: string | null; // when a row was last written
}

export async function loadWindow(db: Db, tenantId: string): Promise<DataWindow> {
  const [w] = await db
    .select({ first: min(orders.localDate), last: max(orders.localDate), newest: max(orders.processedAt), synced: max(orders.syncedAt) })
    .from(orders)
    .where(and(eq(orders.tenantId, tenantId), isNull(orders.cancelledAt)));
  const iso = (v: unknown) => (v ? new Date(v as string | Date).toISOString() : null);
  return { first: w?.first ?? null, last: w?.last ?? null, newest: iso(w?.newest), synced: iso(w?.synced) };
}

export const todayFor = (timezone: string, win: DataWindow) => storeToday(timezone, win.newest);
export const asOfOf = (win: DataWindow) => win.synced ?? new Date(0).toISOString();

export function resolveRange(input: { period?: Period; from?: string; to?: string }, today: string): { from: string; to: string } {
  if (input.from !== undefined || input.to !== undefined) {
    if (input.from === undefined || input.to === undefined) throw new AppError("INVALID_INPUT", "Give both from and to, or neither.");
    if (input.from > input.to) throw new AppError("INVALID_INPUT", `from (${input.from}) is after to (${input.to}).`);
    return { from: input.from, to: input.to };
  }
  switch (input.period ?? "last_30_days") {
    case "last_7_days":
      return { from: addDays(today, -6), to: today };
    case "last_30_days":
      return { from: addDays(today, -29), to: today };
    case "this_month":
      return { from: monthStart(monthOf(today)), to: today };
    case "last_month": {
      const m = addMonths(monthOf(today), -1);
      return { from: monthStart(m), to: monthEnd(m) };
    }
    case "this_year":
      return { from: `${today.slice(0, 4)}-01-01`, to: today };
  }
}

// A range wholly outside the data is NO_DATA, not an empty answer. A quiet stretch inside the data is a real zero.
export function assertInWindow(range: { from: string; to: string }, win: DataWindow): void {
  if (!win.first || !win.last) throw new AppError("NO_DATA", "This store has no synced orders yet.");
  if (range.to < win.first || range.from > win.last) {
    throw new AppError("NO_DATA", `This store has orders from ${win.first} to ${win.last}; nothing lies in ${range.from} to ${range.to}.`);
  }
}

export const queryIdFor = (tool: string, tenantId: string, input: unknown, asOf: string) =>
  `q_${createHash("sha256").update(JSON.stringify({ tool, t: tenantId, input, asOf })).digest("hex").slice(0, 12)}`;

export async function dbFor(deps: { db?: Db }): Promise<Db> {
  return deps.db ?? (await import("../db/client")).getDb();
}

export type Ctx = Pick<TenantContext, "tenantId" | "shop">;
