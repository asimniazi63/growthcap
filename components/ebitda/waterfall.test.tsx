import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { EbitdaMonth } from "@/lib/ebitda/types";
import { Waterfall } from "./waterfall";

// A complete month that adds up: 600,000 - 240,000 - 21,000 - 54,000 - 120,000 = 165,000, and 165,000 - 90,000 = 75,000.
const month = (over: Partial<EbitdaMonth> = {}): EbitdaMonth => ({
  month: "2026-09",
  partial: false,
  orders: 120,
  newCustomerOrders: 50,
  netSalesCents: 600_000,
  costOfGoodsCents: 240_000,
  cardFeesCents: 21_000,
  fulfilmentCents: 54_000,
  adSpendCents: 120_000,
  profitAfterVariableCostsCents: 165_000,
  operatingCosts: [
    { category: "software", amountCents: 30_000 },
    { category: "contractors", amountCents: 60_000 },
  ],
  operatingCostsCents: 90_000,
  operatingCostsEntered: true,
  ebitdaCents: 75_000,
  ebitdaRate: 0.125,
  profitAfterVariableCostsRate: 0.275,
  unitsWithoutCost: 0,
  ebitdaIsCeiling: false,
  ...over,
});

// The same month with $2,500 of operating costs instead: EBITDA is -$850.00, which is -14.2% of net sales.
const loss = month({
  operatingCosts: [{ category: "payroll", amountCents: 250_000 }],
  operatingCostsCents: 250_000,
  ebitdaCents: -85_000,
  ebitdaRate: -85_000 / 600_000,
});

// A month with no sales at all, only a software bill: rates have nothing to divide by, so they are null.
const noSales = month({
  orders: 0,
  newCustomerOrders: 0,
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

// Operating costs missing for the month: the bridge stops at profit after variable costs and EBITDA is a ceiling.
const notEntered = month({ operatingCosts: [], operatingCostsCents: 0, operatingCostsEntered: false, ebitdaCents: 165_000, ebitdaRate: 0.275, ebitdaIsCeiling: true });

const html = (m: EbitdaMonth, props: { currency?: string } = {}) => renderToStaticMarkup(<Waterfall month={m} {...props} />);
// The chart itself: the notice above it carries a small icon that is an <svg> too.
const svgOf = (out: string) => /<svg[^>]*role="img"[\s\S]*?<\/svg>/.exec(out)![0];
const tableOf = (out: string) => /<table[\s\S]*?<\/table>/.exec(out)![0];
const ariaLabel = (out: string) => /aria-label="([^"]*)"/.exec(/<svg[^>]*role="img"[^>]*>/.exec(out)![0])![1]!;
const text = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
// The bars by line key, as percentages of the chart's width. A line that is zero has no bar.
const bars = (out: string) =>
  Object.fromEntries(
    [...svgOf(out).matchAll(/<rect[^>]*data-line="(\w+)"[^>]*>/g)].map((m) => [m[1]!, { x: Number(/ x="([\d.]+)%"/.exec(m[0])![1]), w: Number(/ width="([\d.]+)%"/.exec(m[0])![1]), tag: m[0] }]),
  );
const zeroLine = (out: string) => Number(/ x1="([\d.]+)%"/.exec(/<line[^>]*data-zero[^>]*>/.exec(svgOf(out))![0])![1]);

const KEYS = ["netSales", "costOfGoods", "cardFees", "fulfilment", "adSpend", "profitAfterVariableCosts", "operatingCosts", "ebitda"];
const LABELS = ["Net sales", "Cost of goods", "Card fees", "Fulfilment", "Ad spend", "Profit after variable costs", "Operating costs", "EBITDA"];

describe("Waterfall", () => {
  it("draws net sales, each cost, profit after variable costs, operating costs and EBITDA, in that order, and the table repeats every line", () => {
    const out = html(month());
    expect([...tableOf(out).matchAll(/<tr[^>]*data-line="(\w+)"/g)].map((r) => r[1])).toEqual(KEYS);

    const chart = text(svgOf(out));
    const table = text(tableOf(out));
    for (const label of LABELS) {
      expect(chart).toContain(label);
      expect(table).toContain(label);
    }
    // Costs read as subtractions and totals as they are, the same in the chart and in the table.
    for (const figure of ["$6,000.00", "-$2,400.00", "-$210.00", "-$540.00", "-$1,200.00", "$1,650.00", "-$900.00", "$750.00"]) {
      expect(chart).toContain(figure);
      expect(table).toContain(figure);
    }
    // And the chart runs down in the bridge's order.
    const at = LABELS.map((l) => chart.indexOf(l));
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it("gives the whole bridge in the chart's text, names the month, and offers the numbers under a disclosure", () => {
    const out = html(month());
    expect(/<svg[^>]*role="img"/.test(out)).toBe(true);
    const label = ariaLabel(out);
    expect(label).toContain("September 2026");
    for (const figure of ["$6,000.00", "$2,400.00", "$210.00", "$540.00", "$1,200.00", "$1,650.00", "$900.00", "$750.00"]) expect(label).toContain(figure);
    expect(label).toContain("12.5%"); // EBITDA as a share of net sales
    expect(label).toContain("27.5%"); // profit after variable costs as a share of net sales
    expect(out).toMatch(/<details[\s\S]*<summary[^>]*>Show the numbers<\/summary>[\s\S]*<table/);
  });

  it("is as wide as the card it sits in, so its words stay the size they are drawn at", () => {
    expect(/<svg[^>]*role="img"[^>]*>/.exec(html(month()))![0]).toContain('width="100%"');
  });

  it("scales each bar to its amount, hangs each cost from the running total, and keeps every bar inside the chart", () => {
    const b = bars(html(month()));
    expect(Object.keys(b)).toEqual(KEYS);
    // The cost of goods is 40% of net sales, so its bar is 40% as long; the fees are 3.5% and EBITDA 12.5%.
    expect(b.costOfGoods!.w / b.netSales!.w).toBeCloseTo(0.4, 2);
    expect(b.cardFees!.w / b.netSales!.w).toBeCloseTo(0.035, 2);
    expect(b.ebitda!.w / b.netSales!.w).toBeCloseTo(0.125, 2);
    // The cost of goods bar ends where net sales ends; the card fees end where the cost of goods bar began.
    expect(b.costOfGoods!.x + b.costOfGoods!.w).toBeCloseTo(b.netSales!.x + b.netSales!.w, 1);
    expect(b.cardFees!.x + b.cardFees!.w).toBeCloseTo(b.costOfGoods!.x, 1);
    // The subtotals and the result stand on the zero line.
    expect(b.profitAfterVariableCosts!.x).toBeCloseTo(zeroLine(html(month())), 1);
    expect(b.ebitda!.x).toBeCloseTo(zeroLine(html(month())), 1);
    for (const bar of Object.values(b)) {
      expect(bar.x).toBeGreaterThanOrEqual(0);
      expect(bar.x + bar.w).toBeLessThanOrEqual(100);
    }
  });

  it("draws EBITDA in the ahead colour when it is positive and in the behind colour when it is negative", () => {
    expect(bars(html(month())).ebitda!.tag).toContain("fill-ahead");
    expect(bars(html(loss)).ebitda!.tag).toContain("fill-behind");
  });

  it("copes with a negative EBITDA: the bar runs left of the zero line, the figure keeps its sign, and nothing is NaN", () => {
    const out = html(loss);
    const b = bars(out);
    const zero = zeroLine(out);
    expect(b.ebitda!.x + b.ebitda!.w).toBeCloseTo(zero, 1); // a loss ends at the zero line
    expect(b.ebitda!.x).toBeLessThan(zero);
    expect(b.profitAfterVariableCosts!.x).toBeCloseTo(zero, 1); // a profit starts at it
    // Operating costs start where profit after variable costs ended and carry on past zero.
    expect(b.operatingCosts!.x + b.operatingCosts!.w).toBeCloseTo(b.profitAfterVariableCosts!.x + b.profitAfterVariableCosts!.w, 1);
    expect(b.operatingCosts!.x).toBeLessThan(zero);
    expect(text(tableOf(out))).toContain("-$850.00");
    expect(text(svgOf(out))).toContain("-$850.00");
    expect(ariaLabel(out)).toContain("-$850.00");
    expect(out).toContain("-14.2%");
    expect(out).not.toMatch(/NaN|undefined|Infinity/);
    for (const bar of Object.values(b)) {
      expect(bar.x).toBeGreaterThanOrEqual(0);
      expect(bar.x + bar.w).toBeLessThanOrEqual(100);
    }
  });

  it("copes with a month with no sales: no rates, no NaN, no bar for a line that is zero, and a sentence saying why there is no percentage", () => {
    const out = html(noSales);
    expect(out).not.toMatch(/NaN|undefined|Infinity/);
    expect(Object.keys(bars(out))).toEqual(["operatingCosts", "ebitda"]); // only the software bill and the loss it causes have any length
    expect(text(tableOf(out))).toContain("-$50.00");
    expect(text(tableOf(out))).toContain("n/a");
    expect(text(out)).toContain("No net sales this month, so there is no percentage of net sales to show.");
    expect(ariaLabel(out)).not.toContain("%");
  });

  it("copes with a month where every line is zero", () => {
    const empty = month({
      orders: 0,
      newCustomerOrders: 0,
      netSalesCents: 0,
      costOfGoodsCents: 0,
      cardFeesCents: 0,
      fulfilmentCents: 0,
      adSpendCents: 0,
      profitAfterVariableCostsCents: 0,
      operatingCosts: [],
      operatingCostsCents: 0,
      ebitdaCents: 0,
      ebitdaRate: null,
      profitAfterVariableCostsRate: null,
    });
    const out = html(empty);
    expect(out).not.toMatch(/NaN|undefined|Infinity|-\$0\.00/);
    expect(Object.keys(bars(out))).toEqual([]);
  });

  it("does not show a missing operating cost as $0: the line says it was not entered", () => {
    const out = html(notEntered);
    expect(text(tableOf(out))).toMatch(/Operating costs Not entered/);
    expect(text(svgOf(out))).toContain("Not entered");
    expect(text(out)).not.toContain("-$0.00");
    expect(Object.keys(bars(out))).not.toContain("operatingCosts");
    expect(ariaLabel(out)).toContain("operating costs were not entered");
  });

  describe("ceilings", () => {
    const note = (out: string) => text(out.slice(out.indexOf('role="note"'), out.indexOf('<svg role="img"')));

    it("says why when operating costs were not entered", () => {
      const out = html(notEntered);
      expect(note(out)).toContain("EBITDA is a ceiling for this month");
      expect(note(out)).toContain("no higher than shown");
      expect(note(out)).toContain("No operating costs were entered for this month.");
      expect(note(out)).not.toContain("no unit cost");
    });

    it("says why when some units have no unit cost, with the count in the right number", () => {
      const out = html(month({ unitsWithoutCost: 7, ebitdaIsCeiling: true }));
      expect(note(out)).toContain("7 units sold have no unit cost.");
      expect(note(out)).not.toContain("No operating costs were entered");
      expect(note(html(month({ unitsWithoutCost: 1, ebitdaIsCeiling: true })))).toContain("1 unit sold has no unit cost.");
    });

    it("gives both reasons when there are two", () => {
      const out = html({ ...notEntered, unitsWithoutCost: 3 });
      expect(note(out)).toContain("No operating costs were entered for this month.");
      expect(note(out)).toContain("3 units sold have no unit cost.");
    });

    it("draws a ceiling EBITDA dashed and pale, never as a solid, firm bar, and calls it a ceiling in the chart's words", () => {
      const out = html(notEntered);
      expect(bars(out).ebitda!.tag).toContain("stroke-dasharray");
      expect(bars(html(month())).ebitda!.tag).not.toContain("stroke-dasharray");
      expect(ariaLabel(out)).toContain("a ceiling");
      expect(text(svgOf(out))).toContain("EBITDA (ceiling)");
      expect(text(tableOf(out))).toContain("EBITDA (ceiling)");
    });

    it("shows no notice and no mention of a ceiling for a complete month", () => {
      const out = html(month());
      expect(out).not.toContain('role="note"');
      expect(out).not.toContain("ceiling");
      expect(out).not.toContain("no unit cost");
    });
  });

  it("notes in the table the units that carry no cost of goods", () => {
    const out = html(month({ unitsWithoutCost: 4, ebitdaIsCeiling: true }));
    expect(text(tableOf(out))).toContain("4 units sold have no unit cost, so they add nothing here");
  });

  it("marks a month to date and says its operating costs are prorated", () => {
    const out = html(month({ partial: true }));
    expect(text(out)).toContain("Month to date");
    expect(text(out)).toContain("prorated");
    expect(ariaLabel(out)).toContain("month to date");
    expect(text(html(month()))).not.toContain("Month to date");
  });

  it("uses the currency it is given, and dollars when it is not given one", () => {
    expect(html(month(), { currency: "GBP" })).toContain("£6,000.00");
    expect(html(month())).toContain("$6,000.00");
  });

  it("takes its colours from the theme, never a hard-coded one", () => {
    const svg = svgOf(html(month()));
    expect(svg).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(/);
    expect(svg).toContain("fill-brand");
  });
});
