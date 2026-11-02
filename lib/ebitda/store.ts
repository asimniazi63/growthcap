import { and, eq, gte, lte } from "drizzle-orm";
import type { Db } from "../db/client";
import { costAssumptions, operatingCosts } from "../db/schema";
import { COST_CATEGORIES, DEFAULT_ASSUMPTIONS, type CostAssumptions, type CostCategory, type CostSheetRow, type CostSource } from "./types";

// Reads and writes of a brand's cost sheet: the operating costs by month and category, and the card-fee and fulfilment rates.
// The tenant is always the one the caller passes (the session's), and every query is scoped to it. These functions only store
// what they are given: the file parser and the edit endpoint check the values before they get here.

// The cells for the months from range.from to range.to (YYYY-MM, both included), by month and then in the order of COST_CATEGORIES.
export async function loadCostSheet(db: Db, tenantId: string, range: { from: string; to: string }): Promise<CostSheetRow[]> {
  const rows = await db
    .select({ month: operatingCosts.month, category: operatingCosts.category, amountCents: operatingCosts.amountCents, source: operatingCosts.source })
    .from(operatingCosts)
    .where(and(eq(operatingCosts.tenantId, tenantId), gte(operatingCosts.month, range.from), lte(operatingCosts.month, range.to)));
  const rank = (c: string) => COST_CATEGORIES.indexOf(c as CostCategory);
  return rows
    .map((r): CostSheetRow => ({ ...r, category: r.category as CostCategory }))
    .sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : rank(a.category) - rank(b.category)));
}

// With no row for the brand the defaults apply, and the source says so.
export async function loadAssumptions(db: Db, tenantId: string): Promise<{ assumptions: CostAssumptions; source: CostSource | "default" }> {
  const [row] = await db
    .select({
      cardFeeBps: costAssumptions.cardFeeBps,
      cardFeeFixedCents: costAssumptions.cardFeeFixedCents,
      fulfilmentCentsPerOrder: costAssumptions.fulfilmentCentsPerOrder,
      source: costAssumptions.source,
    })
    .from(costAssumptions)
    .where(eq(costAssumptions.tenantId, tenantId));
  if (!row) return { assumptions: { ...DEFAULT_ASSUMPTIONS }, source: "default" };
  const { source, ...assumptions } = row;
  return { assumptions, source };
}

// A person's edit: the cell becomes "manual", so a reload of the seed file never overwrites it, and records who typed it.
export async function upsertCostCell(db: Db, tenantId: string, userId: string, cell: { month: string; category: CostCategory; amountCents: number }): Promise<void> {
  const stamp = { amountCents: cell.amountCents, source: "manual" as const, updatedBy: userId, updatedAt: new Date() };
  await db
    .insert(operatingCosts)
    .values({ tenantId, month: cell.month, category: cell.category, ...stamp })
    .onConflictDoUpdate({ target: [operatingCosts.tenantId, operatingCosts.month, operatingCosts.category], set: stamp });
}

// A person removing a cell: the row goes whatever its source, so the cell reads as "not entered" again and a reload of the seed file
// can bring its seeded value back. Removing a cell that is not there does nothing. Scoped to the tenant like every other query here.
export async function deleteCostCell(db: Db, tenantId: string, cell: { month: string; category: CostCategory }): Promise<void> {
  await db.delete(operatingCosts).where(and(eq(operatingCosts.tenantId, tenantId), eq(operatingCosts.month, cell.month), eq(operatingCosts.category, cell.category)));
}

export async function upsertAssumptions(db: Db, tenantId: string, userId: string, a: CostAssumptions): Promise<void> {
  const row = {
    cardFeeBps: a.cardFeeBps,
    cardFeeFixedCents: a.cardFeeFixedCents,
    fulfilmentCentsPerOrder: a.fulfilmentCentsPerOrder,
    source: "manual" as const,
    updatedBy: userId,
    updatedAt: new Date(),
  };
  await db.insert(costAssumptions).values({ tenantId, ...row }).onConflictDoUpdate({ target: costAssumptions.tenantId, set: row });
}
