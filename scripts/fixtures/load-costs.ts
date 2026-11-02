// Loads a store's costs.csv and cost-assumptions.csv into its tenant (the EBITDA cost sheet). Each file is checked in full before
// anything is written, so a bad row stores nothing, and both loads can be run again: the same file leaves the same rows. A cell
// with source "manual" was typed in by a person, so a reload never overwrites it. A cell the file no longer lists stays in the
// database, as ad spend does.
import { sql } from "drizzle-orm";
import type { Db } from "../../lib/db/client";
import { costAssumptions, operatingCosts } from "../../lib/db/schema";
import { COST_CATEGORIES, type CostAssumptions, type CostCategory, type CostSource } from "../../lib/ebitda/types";
import type { CostRow } from "../seed/types";
import { readRows } from "./load-pace";

export type { CostRow };

const realMonth = (s: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
const wholeNumber = (s: string) => /^\d+$/.test(s);
// The largest value of the integer columns that hold these numbers, so the check refuses what the database would.
const MAX_INT = 2_147_483_647;
const MAX_CARD_FEE_BPS = 10_000; // 100% of net sales

export function parseCosts(text: string): CostRow[] {
  const seen = new Set<string>();
  return readRows(text, ["month", "category", "amount"]).map(({ line, cells: [month, category, amount] }) => {
    if (!realMonth(month!)) throw new Error(`Line ${line}: "${month}" is not a month (YYYY-MM).`);
    if (!(COST_CATEGORIES as readonly string[]).includes(category!)) throw new Error(`Line ${line}: "${category}" is not a cost category (${COST_CATEGORIES.join(", ")}).`);
    if (!wholeNumber(amount!) || Number(amount) > MAX_INT) throw new Error(`Line ${line}: amount "${amount}" must be a whole number of cents from 0 to ${MAX_INT}.`);
    const key = `${month}|${category}`;
    if (seen.has(key)) throw new Error(`Line ${line}: ${category} in ${month} appears twice.`);
    seen.add(key);
    return { month: month!, category: category as CostCategory, amountCents: Number(amount) };
  });
}

// The keys of cost-assumptions.csv and the field of CostAssumptions each one fills.
const RATE_FIELDS = {
  card_fee_bps: "cardFeeBps",
  card_fee_fixed_cents: "cardFeeFixedCents",
  fulfilment_cents_per_order: "fulfilmentCentsPerOrder",
} as const satisfies Record<string, keyof CostAssumptions>;

export function parseCostAssumptions(text: string): CostAssumptions {
  const found: Partial<CostAssumptions> = {};
  for (const { line, cells: [key, value] } of readRows(text, ["key", "value"])) {
    if (!Object.hasOwn(RATE_FIELDS, key!)) throw new Error(`Line ${line}: "${key}" is not a rate we know (${Object.keys(RATE_FIELDS).join(", ")}).`);
    const field = RATE_FIELDS[key as keyof typeof RATE_FIELDS];
    if (found[field] !== undefined) throw new Error(`Line ${line}: ${key} appears twice.`);
    const max = field === "cardFeeBps" ? MAX_CARD_FEE_BPS : MAX_INT;
    if (!wholeNumber(value!) || Number(value) > max) throw new Error(`Line ${line}: ${key} "${value}" must be a whole number from 0 to ${max}.`);
    found[field] = Number(value);
  }
  const missing = Object.entries(RATE_FIELDS).filter(([, field]) => found[field] === undefined);
  if (missing.length > 0) throw new Error(`The file is missing ${missing.map(([key]) => key).join(", ")}.`);
  return found as CostAssumptions;
}

// One statement, so it is all or nothing. The WHERE on the update skips a cell a person edited, and skips a fixture cell the file did
// not change, so loading the same file again touches nothing, not even updated_at.
export async function loadCosts(db: Db, tenantId: string, csv: string): Promise<{ rows: number }> {
  const parsed = parseCosts(csv);
  if (parsed.length === 0) return { rows: 0 };
  const source: CostSource = "fixture";
  await db
    .insert(operatingCosts)
    .values(parsed.map((r) => ({ tenantId, month: r.month, category: r.category, amountCents: r.amountCents, source })))
    .onConflictDoUpdate({
      target: [operatingCosts.tenantId, operatingCosts.month, operatingCosts.category],
      set: { amountCents: sql`excluded.amount_cents`, updatedAt: sql`now()` },
      setWhere: sql`${operatingCosts.source} = 'fixture' and ${operatingCosts.amountCents} is distinct from excluded.amount_cents`,
    });
  return { rows: parsed.length };
}

// The brand's three rates are one row, with the same rule: a row a person edited is never overwritten.
export async function loadCostAssumptions(db: Db, tenantId: string, csv: string): Promise<void> {
  const rates = parseCostAssumptions(csv);
  const source: CostSource = "fixture";
  await db
    .insert(costAssumptions)
    .values({ tenantId, ...rates, source })
    .onConflictDoUpdate({
      target: costAssumptions.tenantId,
      set: {
        cardFeeBps: sql`excluded.card_fee_bps`,
        cardFeeFixedCents: sql`excluded.card_fee_fixed_cents`,
        fulfilmentCentsPerOrder: sql`excluded.fulfilment_cents_per_order`,
        updatedAt: sql`now()`,
      },
      setWhere: sql`${costAssumptions.source} = 'fixture' and (${costAssumptions.cardFeeBps}, ${costAssumptions.cardFeeFixedCents}, ${costAssumptions.fulfilmentCentsPerOrder}) is distinct from (excluded.card_fee_bps, excluded.card_fee_fixed_cents, excluded.fulfilment_cents_per_order)`,
    });
}
