import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ViewData } from "@/lib/views/types";
import { ViewRenderer } from "./view-renderer";

const basis = { queryIds: ["q_aaaaaaaaaaaa"], range: { from: "2026-09-01", to: "2026-09-30" }, asOf: "2026-10-31T10:34:26.000Z" };
const html = (data: ViewData, title = "A title") => renderToStaticMarkup(<ViewRenderer data={data} title={title} currency="USD" />);

describe("every view", () => {
  const sample: ViewData = { component: "kpi", cards: [{ metric: "orders", label: "Orders", unit: "count", value: 80, range: basis.range }], ...basis };
  it("shows its title, the period and where the numbers came from", () => {
    const out = html(sample, "March orders");
    expect(out).toContain("March orders");
    expect(out).toContain("September 1 to 30, 2026");
    expect(out).toContain("q_aaaaaaaaaaaa");
    expect(out).toContain("as of");
  });
  it("escapes a title and any store text, never rendering markup", () => {
    const bar: ViewData = { component: "bar", metric: "units", label: "Units sold", unit: "count", dimension: "product", bars: [{ label: "<img src=x onerror=alert(1)>", value: 3 }], ...basis };
    const out = html(bar, "<b>bold</b>");
    expect(out).not.toContain("<img");
    expect(out).not.toContain("<b>bold");
    expect(out).toContain("&lt;img");
  });
});

describe("kpi", () => {
  const data: ViewData = {
    component: "kpi",
    cards: [
      { metric: "net_sales", label: "Net sales", unit: "money", value: 629_448, range: basis.range, previous: 877_370, change: -247_922, pctChange: -0.2826, plan: { month: "2026-09", target: 700_000, planned: 700_000, actual: 629_448, gap: -70_552, pctGap: -0.1008, throughDate: "2026-09-30" } },
      { metric: "orders", label: "Orders", unit: "count", value: 80, range: basis.range },
    ],
    ...basis,
  };
  it("shows each value, how it moved in words, and how it stands against plan", () => {
    const out = html(data);
    expect(out).toContain("$6,294.48");
    expect(out).toContain("down 28.3%");
    expect(out).toContain("$8,773.70");
    expect(out).toContain("$705.52 behind plan");
    expect(out).toContain(">80<");
    expect(out).not.toContain("-$");
  });
});

describe("kpi: cards from different periods", () => {
  const aug = { from: "2026-08-01", to: "2026-08-31" };
  const data: ViewData = {
    component: "kpi",
    cards: [
      { metric: "net_sales", label: "Net sales", unit: "money", value: 629_448, range: basis.range },
      { metric: "net_sales", label: "Net sales", unit: "money", value: 877_370, range: aug },
    ],
    ...basis,
    range: { from: aug.from, to: basis.range.to },
  };
  it("shows each card's period so the two can be told apart, and renders both without clashing keys", () => {
    const out = html(data);
    expect(out).toContain("September 1 to 30, 2026");
    expect(out).toContain("August 1 to 31, 2026");
    expect(out).toContain("$6,294.48");
    expect(out).toContain("$8,773.70");
  });
  it("leaves the period off when every card is for the same one", () => {
    const one: ViewData = { ...data, range: basis.range, cards: [data.cards[0]!, { ...data.cards[0]!, metric: "orders", label: "Orders", unit: "count", value: 80 }] } as ViewData;
    expect(html(one).match(/September 1 to 30, 2026/g)?.length).toBe(1); // just the frame's own period line
  });
});

describe("line", () => {
  const data: ViewData = { component: "line", metric: "orders", label: "Orders", unit: "count", dimension: "day", points: [{ x: "2026-09-01", y: 1 }, { x: "2026-09-02", y: 5 }, { x: "2026-09-03", y: 3 }], ...basis };
  it("draws a polyline with a label that gives the range of values, and a table of the points", () => {
    const out = html(data);
    expect(out).toContain("<polyline");
    expect(out).toMatch(/aria-label="Orders by day, 3 points from 2026-09-01 to 2026-09-03, from 1 to 5"/);
    expect(out).toContain("<table");
    expect(out).toContain("2026-09-02");
  });
  it("copes with one point and with all zeros", () => {
    expect(() => html({ ...data, points: [{ x: "2026-09-01", y: 0 }] })).not.toThrow();
    expect(() => html({ ...data, points: [{ x: "a", y: 0 }, { x: "b", y: 0 }] })).not.toThrow();
  });
});

describe("bar", () => {
  const data: ViewData = {
    component: "bar", metric: "units", label: "Units sold", unit: "count", dimension: "product",
    bars: [{ label: "Hero Vitamin C Serum", value: 30, share: 0.204 }, { label: "Barrier Cream", value: 15, share: 0.102 }],
    truncated: { shown: 2, total: 24 }, ...basis,
  };
  it("sizes each bar against the largest, shows value and share, and says when it is showing part", () => {
    const out = html(data);
    expect(out).toContain("Hero Vitamin C Serum");
    expect(out).toContain("width:100%");
    expect(out).toContain("width:50%");
    expect(out).toContain("20.4%");
    expect(out).toContain("Showing 2 of 24");
  });
  it("draws empty bars when every value is zero", () => {
    expect(html({ ...data, bars: [{ label: "A", value: 0 }], truncated: undefined })).toContain("width:0%");
  });
});

describe("table", () => {
  const data: ViewData = {
    component: "table",
    columns: [{ key: "channel", label: "Channel" }, { key: "net_sales", label: "Net sales", unit: "money" }, { key: "refund_rate", label: "Refund rate", unit: "rate" }],
    rows: [{ channel: "web", net_sales: 5000, refund_rate: 0.0326 }, { channel: "pos", net_sales: null, refund_rate: 0 }],
    ...basis,
  };
  it("says so when a table has no rows", () => {
    expect(html({ ...data, rows: [] })).toContain("No rows for this period");
  });
  it("formats each column by its unit, and shows a missing value as a dash", () => {
    const out = html(data);
    expect(out).toContain("$50.00");
    expect(out).toContain("3.3%");
    expect(out).toContain("—");
  });
});

describe("gauge", () => {
  const data: ViewData = { component: "gauge", gauges: [{ metric: "net_sales", label: "Net sales", unit: "money", actual: 280_000, planned: 300_000, target: 650_688, projected: 610_000, throughDate: "2026-10-15" }], ...basis };
  it("shows actual against the plan so far and the target, with the estimate labelled", () => {
    const out = html(data);
    expect(out).toContain("$2,800.00");
    expect(out).toContain("$3,000.00");
    expect(out).toContain("$6,506.88");
    expect(out).toContain("$6,100.00");
    expect(out).toMatch(/estimate/i);
    expect(out).toMatch(/aria-label="Net sales: \$2,800\.00 of a \$6,506\.88 target, \$3,000\.00 planned so far/);
  });
  it("never draws past the end of the dial when the target is beaten", () => {
    const out = html({ ...data, gauges: [{ ...data.gauges[0]!, actual: 900_000 }] });
    expect(out).toContain("$9,000.00");
  });
});

describe("waterfall", () => {
  const data: ViewData = {
    component: "waterfall", metric: "net_sales", label: "Net sales", unit: "money", dimension: "channel",
    steps: [{ label: "Previous period", value: 85_000, kind: "start" }, { label: "web", value: 20_000, kind: "delta" }, { label: "pos", value: -20_000, kind: "delta" }, { label: "This period", value: 85_000, kind: "end" }],
    ...basis,
  };
  it("shows the start, each change as up or down in words, and the end", () => {
    const out = html(data);
    expect(out).toContain("Previous period");
    expect(out).toContain("up $200.00");
    expect(out).toContain("down $200.00");
    expect(out).toContain("This period");
    expect(out).not.toContain("-$");
  });
});

describe("cohort", () => {
  const data: ViewData = {
    component: "cohort",
    windowMonths: [1, 2],
    rows: [
      { cohort: "2026-03", cohortCustomers: 40, cells: [{ monthsSince: 1, customers: 40, repeaters: 6, repeatShare: 0.15 }, { monthsSince: 2, customers: 40, repeaters: 10, repeatShare: 0.25 }] },
      { cohort: "2026-09", cohortCustomers: 50, cells: [{ monthsSince: 1, customers: 50, repeaters: 5, repeatShare: 0.1 }, { monthsSince: 2, customers: 0, repeaters: 0, repeatShare: null }] },
    ],
    ...basis,
  };
  it("draws a heat grid with the figures printed, a label for a screen reader and a table of the numbers", () => {
    const out = html(data, "Repeat rate by first-order month");
    expect(out).toContain('role="img"');
    expect(out).toMatch(/aria-label="Repeat rate by first-order month and months since the first order/);
    expect(out).toContain("15.0%");
    expect(out).toContain("25.0%");
    expect(out).toContain("Show the numbers");
    expect(out).toContain("60 days");
    expect(out).toContain("rgba(15, 118, 110");
  });
  it("shows a dash, not a zero, where nobody is old enough yet", () => {
    expect(html(data)).toContain("—");
  });
});
