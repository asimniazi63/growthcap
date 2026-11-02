import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PlanGap } from "@/lib/pace/gap";
import type { PortfolioRow } from "@/lib/portfolio/portfolio";
import { PortfolioTable } from "./portfolio-table";

const gap: PlanGap = { month: "2026-10", target: 1_000_000, planned: 600_000, actual: 550_000, gap: -50_000, pctGap: -0.0833, projected: 900_000, spread: "even", throughDate: "2026-10-30" };
const row = (over: Partial<PortfolioRow> = {}): PortfolioRow => ({
  tenantId: "t1",
  name: "Alpha",
  currency: "USD",
  role: "gc_partner",
  gap,
  driver: null,
  spark: { values: [100_000, 300_000, 550_000], plan: [120_000, 350_000, 600_000], firstDay: "2026-10-28", lastDay: "2026-10-30" },
  note: null,
  ...over,
});

describe("the portfolio table", () => {
  it("shows each brand's net sales as the final figure, with a sparkline that has a text alternative", () => {
    const out = renderToStaticMarkup(<PortfolioTable rows={[row()]} />);
    expect(out).toContain("$5,500.00");
    expect(out).not.toContain("$0.00");
    expect(out).toContain("spark-line");
    expect(out).toContain("from $1,000.00 on October 28 to $5,500.00 on October 30. Plan to date $6,000.00.");
  });

  it("shows the figure without a sparkline when the brand has no series, and the note when it has no gap", () => {
    const out = renderToStaticMarkup(<PortfolioTable rows={[row({ spark: null }), row({ tenantId: "t2", name: "Beta", gap: null, spark: null, note: "No plan is loaded for this brand." })]} />);
    expect(out).toContain("$5,500.00");
    expect(out).not.toContain("spark-line");
    expect(out).toContain("No plan is loaded for this brand.");
  });

  it("says so when there are no brands", () => {
    expect(renderToStaticMarkup(<PortfolioTable rows={[]} />)).toContain("No brands to compare yet");
  });
});
