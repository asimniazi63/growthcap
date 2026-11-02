import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { OverviewPace } from "@/lib/overview/data";
import type { PlanGap } from "@/lib/pace/gap";
import type { PaceSeries } from "@/lib/pace/series";
import { SalesCard } from "./sales-card";

// October 2026 through the 3rd: cumulative net sales and plan in cents.
const series: PaceSeries = {
  month: "2026-10",
  through: "2026-10-03",
  days: [
    { date: "2026-10-01", actual: 40_000, plan: 30_000 },
    { date: "2026-10-02", actual: 90_000, plan: 60_000 },
    { date: "2026-10-03", actual: 150_000, plan: 90_000 },
    { date: "2026-10-04", actual: null, plan: 120_000 },
  ],
  actualThrough: 150_000,
  planThrough: 90_000,
  target: 400_000,
  projected: 380_000,
  spread: "even",
};

const gap = (over: Partial<PlanGap> = {}): PlanGap => ({ month: "2026-10", target: 400_000, planned: 90_000, actual: 150_000, gap: 60_000, pctGap: 0.667, projected: 380_000, spread: "even", throughDate: "2026-10-03", ...over });

const view = (g: PlanGap | undefined, over: Partial<OverviewPace> = {}): OverviewPace => ({
  today: "2026-10-04",
  month: "2026-10",
  through: "2026-10-03",
  started: true,
  demoClock: false,
  hasPlan: true,
  planLabel: "Plan",
  asOf: "2026-10-04T08:00:00.000Z",
  thisMonth: { range: { from: "2026-10-01", to: "2026-10-03" }, gaps: g ? { net_sales: g } : undefined, queryId: "q_1" },
  lastMonth: null,
  series,
  ...over,
});

const render = (v: OverviewPace) => renderToStaticMarkup(<SalesCard view={v} currency="USD" canPlan scope="tenant-a" />);

describe("the Overview sales card", () => {
  it("shows the final figure in the page HTML, with the count-up wrapping it, and a sparkline that says its first and last values", () => {
    const out = render(view(gap()));
    expect(out).toContain("$1,500.00");
    expect(out).not.toContain("$0.00");
    expect(out).toContain('<span class="sr-only">$1,500.00</span>');
    expect(out).toContain("spark-line");
    expect(out).toContain("Net sales so far this month, running total, from $400.00 on October 1 to $1,500.00 on October 3. Plan to date $900.00.");
  });

  it("says there is no month-end estimate, and why, in the first days of the month", () => {
    const out = render(view(gap({ projected: undefined, earlyMonth: { daysCounted: 3, estimateAfterDays: 5 } })));
    expect(out).toContain("Based on 3 complete days, so no month-end estimate until 5 days are complete.");
    expect(out).not.toContain("by month end");
  });

  it("shows the Plan hit badge when the month's target is met, next to the gap badge", () => {
    const out = render(view(gap({ actual: 400_000, target: 400_000, gap: 310_000, targetMet: true })));
    expect(out).toContain("Plan hit for October");
    expect(out).toContain("plan-hit-ring");
    expect(out).toContain("plan-hit-tick");
    expect(out).toContain("ahead of plan");
  });

  it("does not show Plan hit when the target is not met, even when ahead of the plan so far", () => {
    const out = render(view(gap()));
    expect(out).not.toContain("Plan hit");
    expect(out).toContain("ahead of plan");
  });

  it("leaves out the sparkline when there is no series", () => {
    const out = render(view(gap(), { series: null }));
    expect(out).not.toContain("spark-line");
    expect(out).toContain("$1,500.00");
  });

  it("shows the empty states with no figure, no sparkline and no Plan hit", () => {
    for (const v of [view(undefined, { started: false, thisMonth: null }), view(undefined, { hasPlan: false, thisMonth: null }), view(undefined)]) {
      const out = render(v);
      expect(out).not.toContain("Plan hit");
      expect(out).not.toContain("spark-line");
    }
    expect(render(view(undefined, { started: false, thisMonth: null }))).toContain("The month has just started");
  });
});
