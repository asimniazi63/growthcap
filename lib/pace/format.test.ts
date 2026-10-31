import { describe, expect, it } from "vitest";
import { formatGap, formatPct, formatValue, monthName } from "./format";

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
