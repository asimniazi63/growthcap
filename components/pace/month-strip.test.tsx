import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PaceMonth } from "@/lib/pace/view";
import { MonthStrip } from "./month-strip";

// Newest first, as listPaceMonths gives them: this month, two months behind plan (one by more than the bar shows), a month with
// nothing to compare, and the first month, ahead.
const months: PaceMonth[] = [
  { month: "2026-03", closed: false },
  { month: "2026-02", closed: true, netSales: { actual: 591_500, target: 650_688, gap: -59_188, pctGap: -0.091 } },
  { month: "2026-01", closed: true, netSales: { actual: 300_000, target: 500_000, gap: -200_000, pctGap: -0.4 } },
  { month: "2025-12", closed: true },
  { month: "2025-11", closed: true, netSales: { actual: 722_400, target: 700_000, gap: 22_400, pctGap: 0.032 } },
];

const html = (selected = "2026-02", list: PaceMonth[] = months) => renderToStaticMarkup(<MonthStrip months={list} selected={selected} />);
const items = (out: string) => [...out.matchAll(/<li[^>]*>[\s\S]*?<\/li>/g)].map((m) => m[0]);
const text = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const height = (li: string) => Number(/style="height:([\d.]+)px"/.exec(li)?.[1]);

describe("MonthStrip", () => {
  it("has one link per month, oldest on the left, each to that month on the page and this month to plain /pace", () => {
    const out = html();
    expect([...out.matchAll(/href="([^"]+)"/g)].map((m) => m[1])).toEqual(["/pace?month=2025-11", "/pace?month=2025-12", "/pace?month=2026-01", "/pace?month=2026-02", "/pace"]);
    // The links stay oldest first for the keyboard; the scroller opens at its newest end.
    expect(out).toContain("[direction:rtl]");
  });

  it("marks the month shown, and only that one, for assistive technology as well as the eye", () => {
    const li = items(html("2026-02"));
    expect(li.filter((l) => l.includes('aria-current="page"'))).toHaveLength(1);
    expect(li[3]).toContain('aria-current="page"');
    expect(li[3]).toContain("bg-brand-tint");
    expect(li[2]).not.toContain("bg-brand-tint");
    const link = /<a [^>]*>/.exec(items(html("2026-03"))[4]!)![0];
    expect(link).toContain('href="/pace"');
    expect(link).toContain('aria-current="page"');
  });

  it("draws a finished month ahead of its target up in the ahead colour and one behind down in the behind colour", () => {
    const li = items(html());
    expect(li[0]).toContain("bg-ahead");
    expect(li[0]).toContain("bottom-1/2");
    expect(li[0]).not.toContain("bg-behind");
    for (const i of [2, 3]) {
      expect(li[i]).toContain("bg-behind");
      expect(li[i]).toContain("top-1/2 left-1/2 w-3");
      expect(li[i]).not.toContain("bg-ahead");
    }
  });

  it("makes the bar longer for a bigger gap, within a shortest and a longest length", () => {
    const li = items(html());
    expect(height(li[0]!)).toBeCloseTo(5.2); // 3.2% ahead
    expect(height(li[3]!)).toBeCloseTo(9.2); // 9.1% behind
    expect(height(li[2]!)).toBe(20); // 40% behind: no longer than a quarter's bar
    const tiny = items(html("2026-02", [months[0]!, { month: "2026-02", closed: true, netSales: { actual: 650_000, target: 650_688, gap: -688, pctGap: -0.0011 } }]));
    expect(height(tiny[0]!)).toBeGreaterThanOrEqual(3);
  });

  it("gives a month with nothing to compare a neutral mark, and this month a hatched one that says to date", () => {
    const li = items(html());
    expect(li[1]).toContain("bg-ink-3/45");
    expect(li[4]).toContain("hatch");
    expect(text(li[4]!)).toContain("to date");
    for (const i of [1, 4]) {
      expect(li[i]).not.toContain("bg-ahead");
      expect(li[i]).not.toContain("bg-behind");
      expect(li[i]).not.toContain("style=");
    }
  });

  it("labels each month short, with the year on the first month and on January", () => {
    expect(items(html()).map(text)).toEqual(["Nov 2025", "Dec", "Jan 2026", "Feb", "Mar to date"]);
  });

  it("says in each link's label what its bar means, with the figures from the data", () => {
    const out = html();
    expect(out).toContain('aria-label="November 2025, 3.2% ahead of plan"');
    expect(out).toContain('aria-label="December 2025, no comparison with the plan"');
    expect(out).toContain('aria-label="January 2026, 40.0% behind plan"');
    expect(out).toContain('aria-label="February 2026, 9.1% behind plan"');
    expect(out).toContain('aria-label="March 2026, to date"');
    expect([...out.matchAll(/aria-label="([^"]+)"/g)].map((m) => m[1]).join(" ")).not.toMatch(/-\d/); // the direction in words, never a minus sign
  });

  it("says on plan for a month that hit its target exactly, and reads a gap too small for the percentage the way its bar points", () => {
    const now = months[0]!;
    const even = html("2026-03", [now, { month: "2026-02", closed: true, netSales: { actual: 650_688, target: 650_688, gap: 0, pctGap: 0 } }]);
    expect(even).toContain('aria-label="February 2026, on plan"');
    expect(even).toContain("bg-ahead");
    const hair = html("2026-03", [now, { month: "2026-02", closed: true, netSales: { actual: 650_687, target: 650_688, gap: -1, pctGap: -0 } }]);
    expect(hair).toContain('aria-label="February 2026, 0.0% behind plan"');
    expect(hair).toContain("bg-behind");
  });

  it("shows nothing when there is only one month to choose", () => {
    expect(html("2026-03", [months[0]!])).toBe("");
    expect(html("2026-03", [])).toBe("");
  });
});
