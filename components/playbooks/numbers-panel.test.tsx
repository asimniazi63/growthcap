import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { NumbersItem } from "@/lib/playbooks/numbers";
import type { ViewData } from "@/lib/views/types";
import { NumbersPanel, NumbersSkeleton } from "./numbers-panel";

// The live numbers above a playbook's write-up. The figures are drawn by the same components as a chat answer (ViewRenderer, tested in
// components/views); this tests what the panel adds: the heading, the note on where the numbers come from, the grid, and what it
// says when a view could not be drawn.

const basis = { queryIds: ["q_aaaaaaaaaaaa"], range: { from: "2025-11-28", to: "2025-12-01" }, asOf: "2026-11-03T12:00:00.000Z" };
const kpi: ViewData = {
  component: "kpi",
  cards: [{ metric: "net_sales", label: "Net sales", unit: "money", value: 208_300, range: basis.range, previous: 55_520, change: 152_780, pctChange: 2.752 }],
  ...basis,
};
const bar: ViewData = { component: "bar", metric: "orders", label: "Orders", unit: "count", dimension: "discount_code", bars: [{ label: "BFCM25", value: 29 }, { label: "none", value: 4 }], ...basis };

const ok = (key: string, title: string, data: ViewData, wide = false, fold: string | null = null): NumbersItem => ({ key, title, wide, fold, view: { ok: true, data } });
const failed = (key: string, title: string, wide = false, fold: string | null = null): NumbersItem => ({ key, title, wide, fold, view: { ok: false } });
const html = (items: NumbersItem[]) => renderToStaticMarkup(<NumbersPanel items={items} currency="USD" />);
const plain = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

describe("NumbersPanel", () => {
  it("shows a Live numbers heading, says the figures are drawn from the synced data and not from the write-up, and draws each view", () => {
    const out = html([ok("weekend", "The weekend in numbers", kpi), ok("codes", "Orders by discount code", bar)]);
    expect(out).toContain("<h3");
    expect(plain(out)).toContain("Live numbers");
    expect(plain(out)).toContain("synced store data");
    expect(plain(out)).toContain("same period as the write-up");
    expect(plain(out)).toContain("not taken from the write-up");
    expect(out).toContain("The weekend in numbers");
    expect(out).toContain("Orders by discount code");
    expect(out).toContain("$2,083.00"); // the kpi card's own formatting
    expect(out).toContain("BFCM25");
    expect(out).toContain("q_aaaaaaaaaaaa"); // the source badge: the figure can be traced to its query
    expect((out.match(/<figure/g) ?? []).length).toBe(2);
  });

  it("gives a wide view the full width of the grid, and a narrow one half", () => {
    const out = html([ok("a", "Narrow", kpi), ok("b", "Wide", bar, true)]);
    const narrow = out.slice(out.indexOf("Narrow") - 400, out.indexOf("Narrow"));
    expect(narrow).not.toContain("lg:col-span-2");
    const wide = out.slice(out.indexOf("Wide") - 400, out.indexOf("Wide"));
    expect(wide).toContain("lg:col-span-2");
    expect(out).toContain("lg:grid-cols-2");
  });

  it("puts a folded view behind a closed Show row: the title and the chart are in the page, but only the row is seen until it is opened", () => {
    const out = html([ok("a", "Open one", kpi), ok("b", "Folded one", bar, true, "Show the folded one")]);
    expect((out.match(/<details/g) ?? []).length).toBe(1);
    expect(out).not.toMatch(/<details[^>]*\sopen/);
    const row = out.slice(out.indexOf("<details"), out.indexOf("</summary>"));
    expect(plain(row)).toContain("Show the folded one");
    expect(row).not.toContain("<figure"); // the row holds the label only
    const inside = out.slice(out.indexOf("</summary>"), out.indexOf("</details>"));
    expect(inside).toContain("<figure");
    expect(inside).toContain("Folded one");
    expect(inside).toContain("BFCM25");
    expect(out.slice(0, out.indexOf("<details"))).toContain("Open one"); // the open one is not in a fold
    expect(out.slice(0, out.indexOf("<details"))).toContain("<figure");
  });

  it("gives a fold the full width of the grid", () => {
    const out = html([ok("a", "Open one", kpi), ok("b", "Folded one", bar, false, "Show the folded one")]);
    expect(out.slice(out.indexOf("<details"), out.indexOf("<details") + 140)).toContain("lg:col-span-2");
  });

  it("says which folded view could not be drawn, by its title, and leaves no empty fold", () => {
    const out = html([ok("a", "Open one", kpi), failed("b", "Folded one", true, "Show the folded one")]);
    expect(out).not.toContain("<details");
    expect(plain(out)).toContain("Folded one");
    expect(plain(out)).toMatch(/couldn(?:'|&#x27;)t be drawn/);
  });

  it("names a view that could not be drawn and still draws the others", () => {
    const out = html([failed("weekend", "The weekend in numbers"), ok("codes", "Orders by discount code", bar)]);
    expect(plain(out)).toContain("The weekend in numbers");
    expect(plain(out)).toMatch(/couldn(?:'|&#x27;)t be drawn/);
    expect(out).toContain("BFCM25");
    expect((out.match(/<figure/g) ?? []).length).toBe(1);
  });

  it("says once, plainly, that there are no live numbers when every view failed", () => {
    const out = html([failed("a", "One"), failed("b", "Two")]);
    expect(plain(out)).toContain("No live numbers for this period");
    expect(out).not.toContain("<figure");
    expect(out).not.toContain("couldn&#x27;t be drawn");
  });

  it("draws nothing at all when there are no views", () => {
    expect(html([])).toBe("");
  });

  it("writes a title as text: markup in it is escaped", () => {
    const out = html([ok("a", "<img src=x onerror=alert(1)>", kpi), ok("b", "Two", bar)]);
    expect(out).not.toContain("<img");
    expect(out).toContain("&lt;img");
  });
});

describe("NumbersSkeleton", () => {
  it("holds the place while the numbers load, and tells assistive tech once that they are loading", () => {
    const out = renderToStaticMarkup(<NumbersSkeleton />);
    expect((out.match(/role="status"/g) ?? []).length).toBe(1);
    expect(plain(out)).toContain("Loading live numbers");
    expect(out).toContain("skeleton");
  });
});
