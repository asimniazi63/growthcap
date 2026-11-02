import { z } from "zod";
import { COST_CATEGORIES } from "./types";

// One edit to the cost sheet, as the PUT /api/ebitda/costs body. Money is whole cents. Both shapes are strict, so a body that names a
// tenant, a shop or anything else is refused; the brand and the person come from the session. A cell with a null amount is a request to
// remove the cell, which puts it back to "not entered"; a missing amount is not that, and is refused.
// The caps are sanity limits (a typo like an extra zero is caught here, not saved): $1,000,000 for one cost cell in one month, 10% for
// the card-fee rate, $5.00 fixed per order and $100.00 of fulfilment per order. The messages are sentences because the cost sheet shows
// them beside the cell that was refused.
export const costEditSchema = z.discriminatedUnion(
  "kind",
  [
    z.strictObject({
      kind: z.literal("cell"),
      month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "The month must be written like 2026-08."),
      category: z.enum(COST_CATEGORIES),
      amountCents: z.number().int().min(0).max(100_000_000, "A cost can be at most $1,000,000.00 in a month.").nullable(),
    }),
    z.strictObject({
      kind: z.literal("assumptions"),
      cardFeeBps: z.number().int().min(0).max(1000, "The card fee rate can be at most 10%."),
      cardFeeFixedCents: z.number().int().min(0).max(500, "The fixed card fee can be at most $5.00 an order."),
      fulfilmentCentsPerOrder: z.number().int().min(0).max(10_000, "Fulfilment can cost at most $100.00 an order."),
    }),
  ],
  "The edit must be a cost cell or the assumptions.",
);

export type CostEdit = z.infer<typeof costEditSchema>;
