import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client";
import { isUuid } from "../ids";
import { savedViews } from "../db/schema";
import { AppError } from "../errors";
import { queryMetric, queryMetricInputSchema } from "../metrics/query";
import type { TenantContext } from "../tenancy/context";
import { dbFor, parseInput } from "../tools/common";
import { buildView, type ViewSource } from "./build";
import { VIEW_COMPONENTS, type ViewComponent, type ViewData, type ViewSourceRef } from "./types";

// Pinned views. A person pins a view they liked in the chat; what is kept is the tool and its input, so every load re-runs
// the query against today's data, for the signed-in brand, and nothing the browser sent can name another one.

export const MAX_SAVED_VIEWS = 12;

const pinInput = z.strictObject({
  title: z.string().trim().min(1).max(80),
  component: z.enum(VIEW_COMPONENTS),
  sources: z.array(z.strictObject({ tool: z.literal("query_metric"), input: z.unknown() })).min(1).max(3),
});
export type PinInput = z.input<typeof pinInput>;

export interface SavedView {
  id: string;
  title: string;
  component: ViewComponent;
  sources: ViewSourceRef[];
  createdAt: Date;
}

// Runs each source's query for this brand. The input is checked by the tool's own strict schema first, so a tenant, a shop
// or any invented field is refused.
export async function runSources(ctx: TenantContext, sources: ViewSourceRef[], deps: { db?: Db } = {}): Promise<ViewSource[]> {
  const out: ViewSource[] = [];
  for (const s of sources) {
    if (s.tool !== "query_metric") throw new AppError("INVALID_INPUT", "Views are drawn from query_metric results only.");
    const input = parseInput(queryMetricInputSchema, s.input);
    out.push({ tool: "query_metric", input, result: await queryMetric(ctx, input, deps) });
  }
  return out;
}

export async function rebuild(ctx: TenantContext, view: Pick<SavedView, "component" | "sources">, deps: { db?: Db } = {}): Promise<ViewData> {
  return buildView(view.component, await runSources(ctx, view.sources, deps));
}

export async function pinView(ctx: TenantContext, raw: PinInput, deps: { db?: Db } = {}): Promise<{ id: string }> {
  const input = parseInput(pinInput, raw);
  const db = await dbFor(deps);
  const mine = and(eq(savedViews.tenantId, ctx.tenantId), eq(savedViews.userId, ctx.userId));
  const [count] = await db.select({ n: sql<number>`count(*)::int` }).from(savedViews).where(mine);
  if ((count?.n ?? 0) >= MAX_SAVED_VIEWS) throw new AppError("INVALID_INPUT", `You can pin up to ${MAX_SAVED_VIEWS} views. Remove one first.`);

  // Draw it once now: a view that can't be drawn is refused here, not saved to fail on every page load.
  const sources = await runSources(ctx, input.sources, deps);
  buildView(input.component, sources);

  const [row] = await db
    .insert(savedViews)
    .values({ tenantId: ctx.tenantId, userId: ctx.userId, title: input.title, component: input.component, sources: sources.map((s) => ({ tool: s.tool, input: s.input })) })
    .returning({ id: savedViews.id });
  return { id: row!.id };
}

export async function listViews(ctx: TenantContext, deps: { db?: Db } = {}): Promise<SavedView[]> {
  const db = await dbFor(deps);
  const rows = await db
    .select()
    .from(savedViews)
    .where(and(eq(savedViews.tenantId, ctx.tenantId), eq(savedViews.userId, ctx.userId)))
    .orderBy(desc(savedViews.createdAt));
  return rows.map((r) => ({ id: r.id, title: r.title, component: r.component as ViewComponent, sources: r.sources, createdAt: r.createdAt }));
}

export async function removeView(ctx: TenantContext, id: string, deps: { db?: Db } = {}): Promise<boolean> {
  if (!isUuid(id)) return false;
  const db = await dbFor(deps);
  const gone = await db
    .delete(savedViews)
    .where(and(eq(savedViews.id, id), eq(savedViews.tenantId, ctx.tenantId), eq(savedViews.userId, ctx.userId)))
    .returning({ id: savedViews.id });
  return gone.length > 0;
}
