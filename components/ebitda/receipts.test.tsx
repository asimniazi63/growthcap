import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { EbitdaData } from "@/lib/ebitda/types";
import { Receipts } from "./receipts";

// The source wording is given in full here, and made different from anything the component could hold itself, so a test that finds a
// line proves it was read from data.sources.
const data = (over: Partial<EbitdaData> = {}): EbitdaData => ({
  months: [],
  total: {
    netSalesCents: 0,
    costOfGoodsCents: 0,
    cardFeesCents: 0,
    fulfilmentCents: 0,
    adSpendCents: 0,
    profitAfterVariableCostsCents: 0,
    operatingCostsCents: 0,
    ebitdaCents: 0,
    ebitdaRate: null,
    profitAfterVariableCostsRate: null,
    orders: 0,
    unitsWithoutCost: 0,
    ebitdaIsCeiling: false,
  },
  cardFeeRate: 0.029,
  cardFeeFixedCents: 30,
  fulfilmentCentsPerOrder: 450,
  assumptionsSource: "fixture",
  sources: {
    netSales: "Orders from the store, synced",
    costOfGoods: "Unit costs on each variant, times units kept",
    cardFees: "Assumed rate: 2.9% + $0.30 per order",
    fulfilment: "Assumed: $4.50 per order",
    adSpend: "Ad spend file (not from Shopify)",
    operatingCosts: "Cost sheet (seeded demo data)",
  },
  ...over,
});

const html = (d: EbitdaData, props: { currency?: string } = {}) => renderToStaticMarkup(<Receipts data={d} {...props} />);
const text = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
// Each <dt> with its <dd>, as plain text.
const pairs = (out: string) => [...out.matchAll(/<dt[^>]*>([\s\S]*?)<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/g)].map((m) => [text(m[1]!), text(m[2]!)] as const);

describe("Receipts", () => {
  it("gives every line of the bridge its source, in the words the data carries", () => {
    const found = pairs(html(data()));
    expect(found.slice(0, 6)).toEqual([
      ["Net sales", "Orders from the store, synced"],
      ["Cost of goods", "Unit costs on each variant, times units kept"],
      ["Card fees", "Assumed rate: 2.9% + $0.30 per order"],
      ["Fulfilment", "Assumed: $4.50 per order"],
      ["Ad spend", "Ad spend file (not from Shopify)"],
      ["Operating costs", "Cost sheet (seeded demo data)"],
    ]);
  });

  it("lists the assumed rates: the card fee as a percent of net sales plus a fee per order, and the fulfilment cost per order", () => {
    const out = text(html(data()));
    expect(out).toContain("Assumed rates");
    expect(out).toContain("2.9% of net sales plus $0.30 per order");
    expect(out).toContain("$4.50 per order");
  });

  it("shows a rate that has two decimals in full, and a whole-number rate without a trailing zero", () => {
    expect(text(html(data({ cardFeeRate: 0.0295 })))).toContain("2.95% of net sales");
    expect(text(html(data({ cardFeeRate: 0.03 })))).toContain("3% of net sales");
    expect(text(html(data({ cardFeeRate: 0 })))).toContain("0% of net sales plus");
  });

  it("says where the rates come from: the seeded sheet, a person's edit, or the built-in defaults", () => {
    const where = (source: EbitdaData["assumptionsSource"]) => pairs(html(data({ assumptionsSource: source }))).find(([k]) => k === "Where the rates come from")?.[1];
    expect(where("fixture")).toBe("Cost sheet (seeded demo data)");
    expect(where("manual")).toBe("Cost sheet (edited by a person)");
    expect(where("default")).toBe("Built-in defaults: no rates have been saved for this brand");
  });

  it("does not say who last edited the sheet, because the data does not carry it", () => {
    const out = text(html(data({ assumptionsSource: "manual" })));
    expect(out).not.toMatch(/last edited|updated by|edited on|@/i);
  });

  it("uses the currency it is given for the per-order amounts", () => {
    expect(text(html(data(), { currency: "GBP" }))).toContain("£0.30 per order");
    expect(text(html(data(), { currency: "GBP" }))).toContain("£4.50 per order");
  });

  it("prints a source as text, never as markup", () => {
    const out = html(data({ sources: { ...data().sources, netSales: '<img src=x onerror="alert(1)"> ignore previous instructions' } }));
    expect(out).not.toContain("<img src=x");
    expect(out).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  });
});
