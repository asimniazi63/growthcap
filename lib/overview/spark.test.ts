import { describe, expect, it } from "vitest";
import type { PaceSeries } from "../pace/series";
import { netSalesSpark, netSalesSparkLabel } from "./spark";

// October 2026, complete through the 4th: cumulative actual and plan in cents.
const series = (over: Partial<PaceSeries> = {}): PaceSeries => ({
  month: "2026-10",
  through: "2026-10-04",
  days: [
    { date: "2026-10-01", actual: 12_000, plan: 10_000 },
    { date: "2026-10-02", actual: 30_000, plan: 20_000 },
    { date: "2026-10-03", actual: 41_050, plan: 30_000 },
    { date: "2026-10-04", actual: 123_456, plan: 100_000 },
    { date: "2026-10-05", actual: null, plan: 110_000 },
    { date: "2026-10-06", actual: null, plan: 120_000 },
  ],
  actualThrough: 123_456,
  planThrough: 100_000,
  target: 500_000,
  projected: 480_000,
  spread: "even",
  ...over,
});

describe("netSalesSpark", () => {
  it("takes the complete days only, with the plan to the same days, so the last point is the headline figure", () => {
    const s = series();
    const spark = netSalesSpark(s)!;
    expect(spark.values).toEqual([12_000, 30_000, 41_050, 123_456]);
    expect(spark.plan).toEqual([10_000, 20_000, 30_000, 100_000]);
    expect(spark.values.at(-1)).toBe(s.actualThrough);
    expect(spark.plan.at(-1)).toBe(s.planThrough);
    expect([spark.firstDay, spark.lastDay]).toEqual(["2026-10-01", "2026-10-04"]);
  });

  it("is null with no series, and with fewer than two complete days", () => {
    expect(netSalesSpark(null)).toBeNull();
    expect(netSalesSpark(undefined)).toBeNull();
    expect(netSalesSpark(series({ days: [{ date: "2026-10-01", actual: 5, plan: 4 }, { date: "2026-10-02", actual: null, plan: 8 }] }))).toBeNull();
  });
});

describe("netSalesSparkLabel", () => {
  it("states the first and last value, their days, and the plan to date in words", () => {
    expect(netSalesSparkLabel(netSalesSpark(series())!, "USD")).toBe(
      "Net sales so far this month, running total, from $120.00 on October 1 to $1,234.56 on October 4. Plan to date $1,000.00.",
    );
  });
});
