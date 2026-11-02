import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { EbitdaMonth } from "@/lib/ebitda/types";
import { BridgeTable } from "./bridge-table";

// A complete month that adds up: 600,000 - 240,000 - 21,000 - 54,000 - 120,000 = 165,000, and 165,000 - 90,000 = 75,000.
const month = (over: Partial<EbitdaMonth> = {}): EbitdaMonth => ({
  month: "2026-08",
  partial: false,
  orders: 120,
  newCustomerOrders: 50,
  netSalesCents: 600_000,
  costOfGoodsCents: 240_000,
  cardFeesCents: 21_000,
  fulfilmentCents: 54_000,
  adSpendCents: 120_000,
  profitAfterVariableCostsCents: 165_000,
  operatingCosts: [{ category: "software", amountCents: 90_000 }],
  operatingCostsCents: 90_000,
  operatingCostsEntered: true,
  ebitdaCents: 75_000,
  ebitdaRate: 0.125,
  profitAfterVariableCostsRate: 0.275,
  unitsWithoutCost: 0,
  ebitdaIsCeiling: false,
  ...over,
});

const august = month();
// September: $2,500 of operating costs, so a loss of $850.00, which is -14.2% of net sales.
const september = month({ month: "2026-09", operatingCosts: [{ category: "payroll", amountCents: 250_000 }], operatingCostsCents: 250_000, ebitdaCents: -85_000, ebitdaRate: -85_000 / 600_000 });
// October: only partly through, with no operating costs entered, so its EBITDA is a ceiling.
const october = month({ month: "2026-10", partial: true, operatingCosts: [], operatingCostsCents: 0, operatingCostsEntered: false, ebitdaCents: 165_000, ebitdaRate: 0.275, ebitdaIsCeiling: true });

const html = (months: EbitdaMonth[], selected = "2026-09", props: { currency?: string } = {}) => renderToStaticMarkup(<BridgeTable months={months} selected={selected} {...props} />);
const text = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const rows = (out: string) => [...out.matchAll(/<tr[^>]*>(?:(?!<\/tr>)[\s\S])*<\/tr>/g)].map((m) => m[0]).filter((r) => !r.includes('scope="col"'));

describe("BridgeTable", () => {
  it("has one row for each month, in the order given, with net sales, profit after variable costs, operating costs, EBITDA and its rate", () => {
    const out = html([august, september]);
    const body = rows(out);
    expect(body).toHaveLength(2);
    expect(text(body[0]!)).toBe("August 2026 $6,000.00 $1,650.00 $900.00 $750.00 12.5%");
    expect(text(body[1]!)).toBe("September 2026 $6,000.00 $1,650.00 $2,500.00 -$850.00 -14.2%");
    expect(out).toMatch(/<caption class="sr-only">[^<]*by month/);
  });

  it("names the five figures in its header", () => {
    const head = text(/<thead>[\s\S]*<\/thead>/.exec(html([august]))![0]);
    expect(head).toBe("Month Net sales Profit after variable costs Operating costs EBITDA EBITDA % of net sales");
  });

  it("links each month to /ebitda?month=YYYY-MM", () => {
    const out = html([august, september, october]);
    for (const m of ["2026-08", "2026-09", "2026-10"]) expect(out).toContain(`href="/ebitda?month=${m}"`);
    expect(out.match(/<a /g)).toHaveLength(3);
  });

  it("highlights the selected month and no other, for assistive technology as well as the eye", () => {
    const body = rows(html([august, september, october], "2026-09"));
    expect(body[1]).toContain('aria-current="true"');
    expect(body[1]).toContain("bg-brand-tint");
    expect(body[0]).not.toContain("aria-current");
    expect(body[2]).not.toContain("aria-current");
    expect(body[0]).not.toContain("bg-brand-tint");
    // The link in the selected row says so too.
    expect(/<a [^>]*>/.exec(body[1]!)![0]).toContain('aria-current="true"');
  });

  it("highlights nothing when the selected month is not in the list", () => {
    expect(html([august, september], "2025-01")).not.toContain("aria-current");
  });

  it("marks a ceiling month, and only that month, and explains the mark underneath", () => {
    const out = html([august, september, october]);
    const body = rows(out);
    expect(body[2]).toContain("Ceiling");
    expect(body[0]).not.toContain("Ceiling");
    expect(body[1]).not.toContain("Ceiling");
    expect(text(out)).toContain("Ceiling: a cost is missing for this month");
    expect(text(out)).toContain("no higher than shown");
  });

  it("marks a month to date, and says its operating costs are prorated", () => {
    const out = html([august, october]);
    const body = rows(out);
    expect(body[1]).toContain("Month to date");
    expect(body[0]).not.toContain("Month to date");
    expect(text(out)).toContain("prorated");
  });

  it("explains nothing it does not show: no ceiling or month-to-date note when no month needs one", () => {
    const out = html([august, september]);
    expect(out).not.toContain("Ceiling");
    expect(out).not.toContain("ceiling");
    expect(out).not.toContain("Month to date");
    expect(out).not.toContain("prorated");
  });

  it("shows operating costs that were not entered as 'Not entered', never as $0.00", () => {
    const body = rows(html([august, october]));
    expect(text(body[1]!)).toContain("Not entered");
    expect(text(body[1]!)).not.toContain("$0.00");
    expect(text(body[0]!)).not.toContain("Not entered");
  });

  it("shows an operating cost that was entered as zero as $0.00", () => {
    const zero = month({ operatingCosts: [{ category: "other", amountCents: 0 }], operatingCostsCents: 0, ebitdaCents: 165_000, ebitdaRate: 0.275 });
    expect(text(rows(html([zero]))[0]!)).toContain("$0.00");
  });

  it("shows n/a, not NaN, for the rate of a month with no sales", () => {
    const none = month({
      netSalesCents: 0,
      costOfGoodsCents: 0,
      cardFeesCents: 0,
      fulfilmentCents: 0,
      adSpendCents: 0,
      profitAfterVariableCostsCents: 0,
      operatingCosts: [{ category: "software", amountCents: 5_000 }],
      operatingCostsCents: 5_000,
      ebitdaCents: -5_000,
      ebitdaRate: null,
      profitAfterVariableCostsRate: null,
    });
    const out = html([none]);
    expect(text(rows(out)[0]!)).toBe("August 2026 $0.00 $0.00 $50.00 -$50.00 n/a");
    expect(out).not.toMatch(/NaN|undefined|Infinity/);
  });

  it("says so, and draws no table, when there are no months", () => {
    const out = html([]);
    expect(out).not.toContain("<table");
    expect(text(out)).toContain("No months to show yet");
  });

  it("uses the currency it is given, and dollars when it is not given one", () => {
    expect(html([august], "2026-08", { currency: "GBP" })).toContain("£6,000.00");
    expect(html([august])).toContain("$6,000.00");
  });

  it("scrolls sideways inside its card on a narrow screen instead of squeezing the figures", () => {
    const out = html([august]);
    expect(out).toContain("overflow-x-auto");
    expect(out).toMatch(/<table class="data-table min-w-/);
  });
});
