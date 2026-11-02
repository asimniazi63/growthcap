import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PlanGap } from "@/lib/pace/gap";
import type { PaceView } from "@/lib/pace/view";
import { PacePanel } from "./pace-panel";

const gap = (over: Partial<PlanGap>): PlanGap => ({ month: "2026-10", target: 100, planned: 50, actual: 40, gap: -10, pctGap: -0.2, throughDate: "2026-10-15", ...over });

const view = (over: Partial<PaceView> = {}): PaceView => ({
  today: "2026-10-16",
  month: "2026-10",
  through: "2026-10-15",
  started: true,
  demoClock: false,
  hasPlan: true,
  planLabel: "Solenne plan (fixture)",
  asOf: "2026-10-31T10:34:26.000Z",
  thisMonth: {
    range: { from: "2026-10-01", to: "2026-10-15" },
    queryId: "q_abc",
    gaps: {
      net_sales: gap({ target: 650_688, planned: 300_000, actual: 280_000, gap: -20_000, pctGap: -0.0667, projected: 610_000, spread: "last_year" }),
      orders: gap({ target: 92, planned: 40.5, actual: 44, gap: 3.5, pctGap: 0.0864, projected: 99.9, spread: "even" }),
      aov: gap({ target: 7_436, planned: 7_436, actual: 7_100, gap: -336, pctGap: -0.0452 }),
    },
  },
  lastMonth: {
    month: "2026-09",
    range: { from: "2026-09-01", to: "2026-09-30" },
    queryId: "q_def",
    gaps: { net_sales: gap({ month: "2026-09", target: 700_000, planned: 700_000, actual: 629_448, gap: -70_552, pctGap: -0.1008, throughDate: "2026-09-30" }) },
  },
  ...over,
});

const html = (v: PaceView) => renderToStaticMarkup(<PacePanel view={v} currency="USD" />);

describe("PacePanel: this month to date", () => {
  it("names the month and the last complete day, and shows actual, plan so far and the gap in words", () => {
    const out = html(view());
    expect(out).toContain("October 2026 to date");
    expect(out).toContain("through October 15");
    expect(out).toContain("$2,800.00"); // actual net sales
    expect(out).toContain("$3,000.00"); // plan so far
    expect(out).toContain("$200.00 behind plan");
    expect(out).toContain("3.5 ahead of plan");
    expect(out).not.toContain("-$"); // no minus signs
  });

  it("shows where the month will land, and calls it an estimate", () => {
    const out = html(view());
    expect(out).toContain("$6,100.00");
    expect(out).toMatch(/estimate/i);
  });

  it("says there is no month-end estimate yet, and how long it will take, while the month has fewer than five complete days", () => {
    const early = { daysCounted: 2, estimateAfterDays: 5 };
    const v = view({
      thisMonth: {
        range: { from: "2026-10-01", to: "2026-10-02" },
        queryId: "q_early",
        gaps: {
          net_sales: gap({ target: 650_688, planned: 40_000, actual: 90_000, gap: 50_000, pctGap: 1.25, spread: "even", earlyMonth: early, throughDate: "2026-10-02" }),
          orders: gap({ target: 92, planned: 6, actual: 9, gap: 3, pctGap: 0.5, spread: "even", earlyMonth: early, throughDate: "2026-10-02" }),
        },
      },
    });
    const out = html(v);
    expect(out).toContain("Needs 5 complete days (2 so far) for a month-end estimate");
    expect(out).toContain("No estimate yet (2 of 5 days)");
    expect(out).not.toMatch(/On this pace the month lands at about/);
    expect(out).not.toMatch(/Estimate \$/);
  });

  it("says how the plan was spread over the days", () => {
    const out = html(view());
    expect(out).toContain("last year&#x27;s daily pattern");
    expect(out).toContain("evenly");
  });

  it("shows a progress bar whose label gives the same figures", () => {
    const out = html(view());
    expect(out).toContain('role="img"');
    expect(out).toMatch(/aria-label="Net sales: \$2,800\.00 of a \$6,506\.88 target/);
  });

  it("shows average order value against its target without a month-end estimate", () => {
    const out = html(view());
    expect(out).toContain("Average order value");
    expect(out).toContain("$71.00");
    expect(out).toContain("$74.36");
  });
});

describe("PacePanel: states", () => {
  it("says the month hasn't started when no day of it is complete, and still shows last month", () => {
    const out = html(view({ today: "2026-11-01", month: "2026-11", through: "2026-10-31", started: false, thisMonth: null }));
    expect(out).toContain("November 2026 hasn&#x27;t started");
    expect(out).toContain("September 2026");
  });

  it("says plainly when there is no plan, instead of showing empty cards", () => {
    const out = html(view({ hasPlan: false, planLabel: null, thisMonth: { range: { from: "2026-10-01", to: "2026-10-15" }, queryId: "q" } }));
    expect(out).toContain("No plan has been loaded");
  });

  it("says when the plan has nothing for the month", () => {
    const out = html(view({ thisMonth: { range: { from: "2026-10-01", to: "2026-10-15" }, queryId: "q" } }));
    expect(out).toContain("doesn&#x27;t have targets for October 2026");
  });

  it("flags demo data and names the plan used", () => {
    const out = html(view({ demoClock: true }));
    expect(out).toContain("Solenne plan (fixture)");
  });
});

describe("PacePanel: last month", () => {
  it("shows how the month finished against its plan, in words", () => {
    const out = html(view());
    expect(out).toContain("September 2026 finished");
    expect(out).toContain("$7,000.00");
    expect(out).toContain("$6,294.48");
    expect(out).toContain("$705.52 behind plan");
    expect(out).toContain("10.1% behind");
  });
});

describe("PacePanel: what each remaining day has to bring", () => {
  it("says how much a day the rest of the month needs, from the figure the tool returned", () => {
    const v = view();
    v.thisMonth!.gaps!.net_sales = gap({ target: 650_688, planned: 300_000, actual: 280_000, gap: -20_000, pctGap: -0.0667, projected: 610_000, spread: "last_year", neededPerDay: 5420, daysLeft: 16 });
    v.thisMonth!.gaps!.orders = gap({ target: 92, planned: 40.5, actual: 44, gap: 3.5, pctGap: 0.0864, projected: 99.9, spread: "even", neededPerDay: 3, daysLeft: 16 });
    const out = html(v);
    expect(out).toContain("Need $54.20 a day for the rest of the month");
    expect(out).toContain("Need 3 orders a day for the rest of the month");
  });

  it("says the target is met rather than a figure, and shows nothing when the tool gave neither", () => {
    const v = view();
    v.thisMonth!.gaps!.net_sales = gap({ target: 100, planned: 50, actual: 120, gap: 70, pctGap: 1.4, projected: 150, spread: "even", targetMet: true, daysLeft: 16 });
    const out = html(v);
    expect(out).toContain("Target for the month already met");
    expect(html(view())).not.toContain("a day for the rest of the month");
  });
});
