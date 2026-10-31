import { and, asc, eq, ilike, inArray } from "drizzle-orm";
import type { Db } from "../db/client";
import { calendarEvents, products } from "../db/schema";
import { AppError } from "../errors";
import { isUuid } from "../ids";
import type { LandingCampaign, LandingProduct } from "./types";

// What the landing page reads from the brand's own tables. Every query is scoped to the tenant.

const escapeLike = (s: string) => s.replace(/[\\%_]/g, "\\$&");

const toCampaign = (r: typeof calendarEvents.$inferSelect): LandingCampaign => ({
  id: r.id,
  title: r.title,
  dateFrom: r.dateFrom,
  dateTo: r.dateTo,
  channel: r.channel,
  details: r.details,
});

export async function campaignById(db: Db, tenantId: string, id: string): Promise<LandingCampaign | null> {
  if (!isUuid(id)) return null;
  const [row] = await db.select().from(calendarEvents).where(and(eq(calendarEvents.tenantId, tenantId), eq(calendarEvents.id, id))).limit(1);
  return row ? toCampaign(row) : null;
}

// The campaign a person means: by id, or by its title when the model has the name and not the id. A title that fits
// several rows is an error that lists them, so the model asks which one.
export async function findCampaign(db: Db, tenantId: string, ref: string): Promise<LandingCampaign> {
  const byId = await campaignById(db, tenantId, ref);
  if (byId) return byId;
  const rows = await db
    .select()
    .from(calendarEvents)
    .where(and(eq(calendarEvents.tenantId, tenantId), ilike(calendarEvents.title, `%${escapeLike(ref.trim())}%`)))
    .orderBy(asc(calendarEvents.dateFrom))
    .limit(6);
  const exact = rows.filter((r) => r.title.toLowerCase() === ref.trim().toLowerCase());
  const pick = exact.length === 1 ? exact : rows;
  if (pick.length === 1) return toCampaign(pick[0]!);
  if (pick.length === 0) {
    const all = await db.select().from(calendarEvents).where(eq(calendarEvents.tenantId, tenantId)).orderBy(asc(calendarEvents.dateFrom)).limit(12);
    const list = all.map((r) => `${r.id} "${r.title}" (${r.dateFrom} to ${r.dateTo})`).join("; ");
    throw new AppError("INVALID_INPUT", `No planned campaign matches that. The calendar has: ${list || "nothing yet"}. Use one of those ids.`);
  }
  throw new AppError("INVALID_INPUT", `Several planned campaigns match: ${pick.map((r) => `${r.id} "${r.title}" (${r.dateFrom} to ${r.dateTo})`).join("; ")}. Use the id of one.`);
}

// The active products with these handles, in this brand. A draft or archived product has no page on the storefront.
export async function activeProducts(db: Db, tenantId: string, handles: string[]): Promise<LandingProduct[]> {
  if (handles.length === 0) return [];
  const rows = await db
    .select({ handle: products.handle, title: products.title })
    .from(products)
    .where(and(eq(products.tenantId, tenantId), inArray(products.handle, handles), eq(products.status, "ACTIVE")));
  return rows;
}

// A few of this brand's active product handles, for an error message that tells the model what it can use.
export async function sampleHandles(db: Db, tenantId: string, limit = 12): Promise<string[]> {
  const rows = await db.select({ handle: products.handle }).from(products).where(and(eq(products.tenantId, tenantId), eq(products.status, "ACTIVE"))).orderBy(products.handle).limit(limit);
  return rows.map((r) => r.handle);
}
