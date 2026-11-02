import { describe, expect, it } from "vitest";
import { costEditSchema } from "./costs-input";

const cell = { kind: "cell", month: "2026-09", category: "software", amountCents: 12_500 };
const assumptions = { kind: "assumptions", cardFeeBps: 290, cardFeeFixedCents: 30, fulfilmentCentsPerOrder: 450 };

describe("costEditSchema", () => {
  it("accepts a cell and a set of assumptions, and keeps nothing else", () => {
    expect(costEditSchema.parse(cell)).toEqual(cell);
    expect(costEditSchema.parse(assumptions)).toEqual(assumptions);
  });

  it("takes null for a cell's amount, which means remove the cell, and keeps nothing else", () => {
    const removal = { ...cell, amountCents: null };
    expect(costEditSchema.parse(removal)).toEqual(removal);
    expect(costEditSchema.safeParse({ ...removal, tenantId: "tenant-b" }).success).toBe(false); // still strict
  });

  it("accepts the edges of the allowed ranges", () => {
    expect(costEditSchema.safeParse({ ...cell, month: "2026-01", amountCents: 0 }).success).toBe(true);
    expect(costEditSchema.safeParse({ ...cell, month: "2026-12", amountCents: 100_000_000 }).success).toBe(true);
    expect(costEditSchema.safeParse({ ...assumptions, cardFeeBps: 0, cardFeeFixedCents: 0, fulfilmentCentsPerOrder: 0 }).success).toBe(true);
    expect(costEditSchema.safeParse({ ...assumptions, cardFeeBps: 1000, cardFeeFixedCents: 500, fulfilmentCentsPerOrder: 10_000 }).success).toBe(true);
  });

  it.each([
    ["a tenant on a cell", { ...cell, tenantId: "tenant-b" }],
    ["a tenant on the assumptions", { ...assumptions, tenantId: "tenant-b" }],
    ["a user id", { ...cell, updatedBy: "someone" }],
    ["no kind", { month: "2026-09", category: "software", amountCents: 1 }],
    ["an unknown kind", { ...cell, kind: "delete" }],
    ["an unknown category", { ...cell, category: "marketing" }],
    ["a category in the wrong case", { ...cell, category: "Software" }],
    ["a negative amount", { ...cell, amountCents: -1 }],
    ["a decimal amount", { ...cell, amountCents: 12.5 }],
    ["an amount as text", { ...cell, amountCents: "100" }],
    ["an amount above the cap", { ...cell, amountCents: 100_000_001 }],
    ["no amount at all, which is not a removal", { kind: "cell", month: "2026-09", category: "software" }],
    ["an undefined amount, which is not a removal", { ...cell, amountCents: undefined }],
    ["the text null for the amount", { ...cell, amountCents: "null" }],
    ["false for the amount", { ...cell, amountCents: false }],
    ["null for the month", { ...cell, month: null }],
    ["null for the category", { ...cell, category: null }],
    ["a month 13", { ...cell, month: "2026-13" }],
    ["month 00", { ...cell, month: "2026-00" }],
    ["a month without its leading zero", { ...cell, month: "2026-9" }],
    ["a date instead of a month", { ...cell, month: "2026-09-01" }],
    ["a two-digit year", { ...cell, month: "26-09" }],
    ["a card fee rate above 10%", { ...assumptions, cardFeeBps: 1001 }],
    ["a fixed fee above $5.00", { ...assumptions, cardFeeFixedCents: 501 }],
    ["fulfilment above $100.00 an order", { ...assumptions, fulfilmentCentsPerOrder: 10_001 }],
    ["a negative rate", { ...assumptions, cardFeeBps: -1 }],
    ["null for a rate, which removes nothing", { ...assumptions, cardFeeBps: null }],
    ["a decimal rate", { ...assumptions, cardFeeBps: 2.9 }],
    ["a missing rate", { kind: "assumptions", cardFeeBps: 290, cardFeeFixedCents: 30 }],
    ["a cell's fields on the assumptions", { ...assumptions, month: "2026-09" }],
    ["not an object", "2026-09"],
    ["null", null],
  ])("rejects %s", (_label, body) => {
    expect(costEditSchema.safeParse(body).success).toBe(false);
  });
});
