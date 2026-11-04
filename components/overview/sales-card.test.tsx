import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { OverviewPace } from "@/lib/overview/data";
import type { PlanGap } from "@/lib/pace/gap";
import type { PaceSeries } from "@/lib/pace/series";
import type { PaceMonth } from "@/lib/pace/view";
import { SalesCard } from "./sales-card";

// The month picker is a client component that reads the router; there is no router in a static render.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/overview" }));

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
  current: "2026-10",
  closed: false,
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

const render = (v: OverviewPace, months?: PaceMonth[]) => renderToStaticMarkup(<SalesCard view={v} currency="USD" canPlan scope="tenant-a" months={months} />);

// October 2026 whole, as the card sees it from November: the plan for the whole month is its target, so no estimate.
const october: PlanGap = { month: "2026-10", target: 1_045_250, planned: 1_045_250, actual: 951_240, gap: -94_010, pctGap: -0.0899, spread: "even", throughDate: "2026-10-31" };
const octoberSeries: PaceSeries = {
  month: "2026-10",
  through: "2026-10-31",
  days: Array.from({ length: 31 }, (_, i) => ({ date: `2026-10-${String(i + 1).padStart(2, "0")}`, actual: Math.round((951_240 * (i + 1)) / 31), plan: Math.round((1_045_250 * (i + 1)) / 31) })),
  actualThrough: 951_240,
  planThrough: 1_045_250,
  target: 1_045_250,
  projected: null,
  spread: "even",
};
const lastMonth = (g: PlanGap | null = october): OverviewPace["lastMonth"] => ({ month: "2026-10", range: { from: "2026-10-01", to: "2026-10-31" }, gaps: g ? { net_sales: g } : undefined, queryId: "q_oct" });

// October picked on November 4.
const closed = (g: PlanGap = october, over: Partial<OverviewPace> = {}): OverviewPace =>
  view(g, {
    today: "2026-11-04",
    current: "2026-11",
    month: "2026-10",
    closed: true,
    through: "2026-10-31",
    thisMonth: { range: { from: "2026-10-01", to: "2026-10-31" }, gaps: { net_sales: g }, queryId: "q_oct" },
    lastMonth: { month: "2026-09", range: { from: "2026-09-01", to: "2026-09-30" }, gaps: { net_sales: { ...october, month: "2026-09", throughDate: "2026-09-30" } }, queryId: "q_sep" },
    series: octoberSeries,
    ...over,
  });

// November 4: three complete days of November, and October whole as last month.
const november = (g: PlanGap | undefined, over: Partial<OverviewPace> = {}): OverviewPace =>
  view(g, {
    today: "2026-11-04",
    current: "2026-11",
    month: "2026-11",
    through: "2026-11-03",
    thisMonth: { range: { from: "2026-11-01", to: "2026-11-03" }, gaps: g ? { net_sales: g } : undefined, queryId: "q_nov" },
    lastMonth: lastMonth(),
    series: null,
    ...over,
  });
const earlyNovember = gap({ month: "2026-11", projected: undefined, earlyMonth: { daysCounted: 3, estimateAfterDays: 5 }, throughDate: "2026-11-03" });
// November 1: nothing complete yet.
const firstOfNovember = november(undefined, { today: "2026-11-01", through: "2026-10-31", started: false, thisMonth: null });

const months: PaceMonth[] = [
  { month: "2026-11", closed: false },
  { month: "2026-10", closed: true, netSales: { actual: 951_240, target: 1_045_250, gap: -94_010, pctGap: -0.0899 } },
  { month: "2026-09", closed: true },
];

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

describe("the Overview sales card on a past month", () => {
  it("names the month in the title and says the figure is the whole month, with no estimate and no early-month words", () => {
    const out = render(closed());
    expect(out).toContain("Net sales in October 2026");
    expect(out).not.toContain("Net sales this month");
    expect(out).toContain("$9,512.40");
    expect(out).toContain("target $10,452.50");
    expect(out).toContain("The whole month, October 1 to 31, 2026.");
    expect(out).not.toContain("Complete days through");
    expect(out).not.toContain("by month end");
    expect(out).not.toContain("month-end estimate");
    expect(out).toContain("$940.10 behind plan");
    expect(out).toContain("Net sales in October 2026, running total, from $306.85 on October 1 to $9,512.40 on October 31.");
    expect(out).not.toContain("so far this month");
  });

  it("does not play Plan hit for a past month that met its target, and still says it was ahead", () => {
    const out = render(closed({ ...october, actual: 1_100_000, gap: 54_750, pctGap: 0.0524 }));
    expect(out).not.toContain("Plan hit");
    expect(out).not.toContain("plan-hit");
    expect(out).toContain("$547.50 ahead of plan");
  });

  it("does not add the last month line, which is for the start of the current month", () => {
    expect(render(closed())).not.toContain("finished at");
  });
});

describe("the last month line", () => {
  it("says how last month finished, with a link to it, while there is no month-end estimate yet", () => {
    const out = render(november(earlyNovember));
    expect(out).toContain("Based on 3 complete days, so no month-end estimate until 5 days are complete.");
    expect(out).toContain("October finished at $9,512.40, $940.10 behind plan (9.0% behind).");
    expect(out).toContain('href="/overview?month=2026-10"');
    expect(out).toContain("See October</a>");
  });

  it("leaves out the percentage when last month landed exactly on plan", () => {
    const out = render(november(earlyNovember, { lastMonth: lastMonth({ ...october, actual: 1_045_250, gap: 0, pctGap: 0 }) }));
    expect(out).toContain("October finished at $10,452.50, on plan.");
  });

  it("shows inside the empty state on the first day of the month, when there is nothing else to show", () => {
    const out = render(firstOfNovember);
    expect(out).toContain("The month has just started");
    expect(out).toContain("October finished at $9,512.40, $940.10 behind plan (9.0% behind).");
    expect(out).toContain('href="/overview?month=2026-10"');
  });

  it("is not there once the month has an estimate, or when last month had no net sales target", () => {
    expect(render(november(gap({ month: "2026-11", throughDate: "2026-11-03" })))).not.toContain("finished at");
    expect(render(november(earlyNovember, { lastMonth: lastMonth(null) }))).not.toContain("finished at");
    expect(render(november(earlyNovember, { lastMonth: null }))).not.toContain("See October");
  });
});

describe("the month picker", () => {
  it("sits in the header with every month, the shown one selected, when there is more than one month", () => {
    const now = render(november(earlyNovember), months);
    expect(now).toContain("<select");
    expect(now).toContain('<option value="2026-11" selected="">November 2026 (to date)</option>');
    expect(now).toContain("October 2026 · 9.0% behind");
    expect(now).toContain("September 2026");
    expect(render(closed(), months)).toContain('<option value="2026-10" selected="">October 2026 · 9.0% behind</option>');
  });

  it("is there on the first day of the month too, so a past month is one pick away", () => {
    expect(render(firstOfNovember, months)).toContain("<select");
  });

  it("is left out without months, or with only this month to pick", () => {
    expect(render(november(earlyNovember))).not.toContain("<select");
    expect(render(november(earlyNovember), [{ month: "2026-11", closed: false }])).not.toContain("<select");
  });
});
