import { describe, expect, it } from "vitest";
import { earlyBasis, estimateWait, estimateWaitShort, formatGap, formatMove, formatPct, formatRange, formatUnit, formatValue, monthName } from "./format";

describe("formatValue", () => {
  it("writes money in dollars from cents, counts plainly, and rates as percentages", () => {
    expect(formatValue("net_sales", 629_448, "USD")).toBe("$6,294.48");
    expect(formatValue("aov", 7_390, "USD")).toBe("$73.90");
    expect(formatValue("orders", 92, "USD")).toBe("92");
    expect(formatValue("orders", 31.4, "USD")).toBe("31.4");
    expect(formatValue("orders", 31.0, "USD")).toBe("31");
    expect(formatValue("returning_customer_rate", 0.5217, "USD")).toBe("52.2%");
  });
  it("uses the store's currency", () => {
    expect(formatValue("net_sales", 100_000, "EUR")).toBe("€1,000.00");
  });
});

describe("formatGap and formatPct", () => {
  it("says ahead or behind in words, with the size and no minus sign", () => {
    expect(formatGap("net_sales", -60_488, "USD")).toEqual({ text: "$604.88 behind plan", tone: "behind" });
    expect(formatGap("orders", 4.5, "USD")).toEqual({ text: "4.5 ahead of plan", tone: "ahead" });
    expect(formatGap("returning_customer_rate", -0.1217, "USD")).toEqual({ text: "12.2 points behind plan", tone: "behind" });
  });
  it("calls a zero gap on plan", () => {
    expect(formatGap("orders", 0, "USD")).toEqual({ text: "on plan", tone: "even" });
  });
  it("writes a gap fraction as a percentage in words, and nothing when there is no plan yet", () => {
    expect(formatPct(-0.093)).toBe("9.3% behind");
    expect(formatPct(0.04)).toBe("4.0% ahead");
    expect(formatPct(null)).toBeNull();
  });
});

describe("monthName", () => {
  it("writes a month in words", () => {
    expect(monthName("2026-10")).toBe("October 2026");
    expect(monthName("2026-01")).toBe("January 2026");
  });
});

describe("formatUnit, formatMove and formatRange", () => {
  it("formats by unit, including a ratio", () => {
    expect(formatUnit("ratio", 2.5, "USD")).toBe("2.50x");
    expect(formatUnit("money", 100, "USD")).toBe("$1.00");
  });
  it("says a change in words", () => {
    expect(formatMove(-0.2826)).toBe("down 28.3%");
    expect(formatMove(0.04)).toBe("up 4.0%");
    expect(formatMove(0)).toBe("no change");
    expect(formatMove(null)).toBeNull();
  });
  it("writes a range of dates compactly", () => {
    expect(formatRange("2026-09-01", "2026-09-30")).toBe("September 1 to 30, 2026");
    expect(formatRange("2026-09-28", "2026-10-03")).toBe("September 28 to October 3, 2026");
    expect(formatRange("2026-10-05", "2026-10-05")).toBe("October 5, 2026");
  });
});

describe("the early-month wording", () => {
  const one = { daysCounted: 1, estimateAfterDays: 5 };
  const four = { daysCounted: 4, estimateAfterDays: 5 };

  it("says how many complete days a month has and how many its estimate needs", () => {
    expect(estimateWait(one)).toBe("Needs 5 complete days (1 so far)");
    expect(estimateWaitShort(four)).toBe("No estimate yet (4 of 5 days)");
  });

  it("says what the ahead or behind badge rests on, in the singular for one day", () => {
    expect(earlyBasis(one)).toBe("Based on 1 complete day");
    expect(earlyBasis(four)).toBe("Based on 4 complete days");
  });
});
