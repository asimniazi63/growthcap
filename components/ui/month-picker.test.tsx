import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { MonthPicker, monthHref, monthOptionLabel } from "./month-picker";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/pace" }));

const months = [
  { month: "2026-11", closed: false },
  { month: "2026-10", closed: true, netSales: { actual: 900_000, target: 1_000_000, gap: -100_000, pctGap: -0.1 } },
  { month: "2026-09", closed: true, netSales: { actual: 1_050_000, target: 1_000_000, gap: 50_000, pctGap: 0.05 } },
  { month: "2026-08", closed: true }, // no target that month
];

describe("monthHref", () => {
  it("puts a past month in ?month= and keeps the other params", () => {
    expect(monthHref("/pace", "", "2026-10", "2026-11")).toBe("/pace?month=2026-10");
    expect(monthHref("/segments", "?segment=lapsed", "2026-10", "2026-11")).toBe("/segments?segment=lapsed&month=2026-10");
    expect(monthHref("/pace", "?month=2026-09", "2026-10", "2026-11")).toBe("/pace?month=2026-10");
  });

  it("drops the param for this month, so now has a clean URL", () => {
    expect(monthHref("/pace", "?month=2026-10", "2026-11", "2026-11")).toBe("/pace");
    expect(monthHref("/overview", "?month=2026-10&x=1", "2026-11", "2026-11")).toBe("/overview?x=1");
  });
});

describe("monthOptionLabel", () => {
  it("says how each past month finished against plan, and that this month is still running", () => {
    expect(months.map(monthOptionLabel)).toEqual(["November 2026 (to date)", "October 2026 · 10.0% behind", "September 2026 · 5.0% ahead", "August 2026"]);
  });
});

describe("MonthPicker", () => {
  it("lists the months newest first with the shown month selected", () => {
    const html = renderToStaticMarkup(<MonthPicker months={months} selected="2026-10" />);
    expect(html.match(/<option/g)).toHaveLength(4);
    expect(html).toMatch(/<option value="2026-10" selected="">October 2026 · 10.0% behind<\/option>/);
    expect(html.indexOf("2026-11")).toBeLessThan(html.indexOf("2026-08"));
    expect(html).toContain('<span class="sr-only">Month</span>');
  });

  it("draws nothing without months", () => {
    expect(renderToStaticMarkup(<MonthPicker months={[]} selected="2026-11" />)).toBe("");
  });
});
