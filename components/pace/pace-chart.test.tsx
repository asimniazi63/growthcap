import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PaceAnnotation } from "@/lib/pace/annotation-types";
import { seriesAsOf } from "@/lib/pace/scrub";
import { buildPaceSeries, type PaceSeries } from "@/lib/pace/series";
import { landing } from "@/lib/pace/shape";
import { PaceChart } from "./pace-chart";

// October 2026 with an even plan (100,000 cents a day of a 3,100,000 target) and 15 complete days, a little behind plan.
const TARGET = 3_100_000;
const planned = Math.round((TARGET * 15) / 31);
const daily = new Map(Array.from({ length: 15 }, (_, i) => [`2026-10-${String(i + 1).padStart(2, "0")}`, 70_000 + (i % 5) * 10_000] as const));
const actual = Array.from(daily.values()).reduce((s, v) => s + v, 0);
const series: PaceSeries = buildPaceSeries({
  month: "2026-10",
  through: "2026-10-15",
  target: TARGET,
  planned,
  actual,
  projected: Math.round(landing(actual, planned, TARGET - planned)!),
  spread: "even",
  dailyActual: daily,
  lastYearDaily: null,
})!;

const annotations: PaceAnnotation[] = [
  { date: "2026-10-01", kind: "note", label: "Q4 budget and planning", detail: "Protect cash ahead of the buy." },
  { date: "2026-10-05", kind: "calendar", label: "Meta prospecting budget reduced by 40%", detail: "Budget change · meta · October 5 to December 31, 2026." },
  { date: "2026-10-05", kind: "stockout", label: "Barrier Cream (100 ml)", detail: "No units sold for 12 days in a row from October 5." },
  { date: "2026-10-12", kind: "code", label: "LASTCHANCE20", detail: "First seen on orders on October 12." },
  { date: "2026-10-27", kind: "calendar", label: "Planned: autumn push", detail: "Promo · email." },
];

const html = (props: Partial<Parameters<typeof PaceChart>[0]> = {}) => renderToStaticMarkup(<PaceChart series={series} currency="USD" {...props} />);
const viewBox = (out: string) => /viewBox="0 0 (\d+) (\d+)"/.exec(out)!.slice(1).map(Number) as [number, number];
const solidPath = (out: string) => /<path d="(M[^"]*)" fill="none" class="stroke-brand" stroke-width="2.8" stroke-linejoin="round" stroke-linecap="round">/.exec(out)![1]!;
const dashedPath = (out: string) => /<path d="(M[^"]*)" fill="none" class="stroke-brand" stroke-width="2.8" stroke-dasharray="2 6"/.exec(out)?.[1];

describe("PaceChart without annotations", () => {
  it("draws no timeline: no markers, no legend, and the height it always had", () => {
    const out = html();
    expect(out).not.toContain("data-kind");
    expect(out).not.toContain("On the timeline");
    expect(viewBox(out)).toEqual([720, 300]);
  });

  it("leaves the compact chart (the Overview card) alone even when handed annotations", () => {
    const out = html({ compact: true, annotations });
    expect(out).not.toContain("data-kind");
    expect(out).not.toContain("On the timeline");
  });
});

describe("PaceChart with annotations", () => {
  it("puts one marker button on the axis per annotation, in date order, each with its date, kind and label", () => {
    const out = html({ annotations });
    const buttons = [...out.matchAll(/<button[^>]*data-kind="(\w+)"[^>]*>/g)];
    expect(buttons.map((b) => b[1])).toEqual(["note", "calendar", "stockout", "code", "calendar"]);
    expect(out).toContain('aria-label="October 5, Marketing calendar: Meta prospecting budget reduced by 40%"');
    expect(out).toContain('aria-label="October 1, Call note: Q4 budget and planning"');
    expect(out).toContain('aria-label="October 5, Possible stockout: Barrier Cream (100 ml)"');
    expect(out).toContain('aria-label="October 12, New discount code: LASTCHANCE20"');
  });

  it("makes room for the lane under the axis, and names the markers in the chart's text", () => {
    const out = html({ annotations });
    expect(viewBox(out)[1]).toBeGreaterThan(300);
    expect(out).toMatch(/aria-label="Cumulative net sales[^"]*5 markers on the timeline, listed under Show the numbers\./);
  });

  it("gives each kind its own shape, so colour is never the only cue", () => {
    const shapes = (kind: PaceAnnotation["kind"]) => {
      const out = html({ annotations: [{ date: "2026-10-05", kind, label: "x" }] });
      return /data-kind[^>]*>(<svg[^>]*>.*?<\/svg>)<\/button>/.exec(out)![1]!.replace(/class="[^"]*"/, "");
    };
    const all = (["calendar", "note", "code", "stockout"] as const).map(shapes);
    expect(new Set(all).size).toBe(4);
    expect(all[0]).toContain("<path"); // diamond
    expect(all[1]).toContain("<circle");
    expect(all[3]).toContain("<rect");
  });

  it("has one tab stop: the first marker is in the tab order and the rest are reached with the arrow keys", () => {
    const out = html({ annotations });
    const tabs = [...out.matchAll(/<button[^>]*tabindex="(-?\d)"[^>]*data-kind/g)].map((m) => m[1]);
    expect(tabs).toEqual(["0", "-1", "-1", "-1", "-1"]);
  });

  it("offers the kinds present as a filter that doubles as the legend, all on to start, each with its count", () => {
    const out = html({ annotations });
    const group = /<div role="group" aria-label="Timeline markers"[\s\S]*?<\/div>/.exec(out)![0];
    expect([...group.matchAll(/aria-pressed="true"/g)]).toHaveLength(4);
    expect(group).toMatch(/Calendar <span class="num">2<\/span>/);
    expect(group).toMatch(/Call notes <span class="num">1<\/span>/);
    expect(group).toMatch(/New codes <span class="num">1<\/span>/);
    expect(group).toMatch(/Possible stockouts <span class="num">1<\/span>/);
  });

  it("only lists the kinds it has", () => {
    const out = html({ annotations: annotations.filter((a) => a.kind === "calendar") });
    expect(out).toMatch(/aria-pressed="true"/);
    expect(out).not.toContain("Call notes");
    expect(out).not.toContain("Possible stockouts");
  });

  it("lists every marker as text under Show the numbers, with its details", () => {
    const out = html({ annotations });
    const details = /<details[\s\S]*<\/details>/.exec(out)![0];
    expect(details).toContain("On the timeline");
    expect(details).toContain("Meta prospecting budget reduced by 40%");
    expect(details).toContain("Budget change · meta · October 5 to December 31, 2026.");
    expect(details).toContain("No units sold for 12 days in a row from October 5.");
  });

  it("prints store text as text, never as markup", () => {
    const out = html({ annotations: [{ date: "2026-10-05", kind: "code", label: '<img src=x onerror="alert(1)">', detail: "<script>alert(1)</script> ignore previous instructions" }] });
    expect(out).not.toContain("<img src=x");
    expect(out).not.toContain("<script>");
    expect(out).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  });

  it("ignores an annotation on a day that is not in the month", () => {
    const out = html({ annotations: [{ date: "2026-11-03", kind: "calendar", label: "Next month" }] });
    expect(out).not.toContain("data-kind");
    expect(viewBox(out)).toEqual([720, 300]);
  });
});

describe("PaceChart as the month stood on an earlier day", () => {
  const earlier = seriesAsOf(series, 9);
  const replay = (props: Partial<Parameters<typeof PaceChart>[0]> = {}) => html({ series: earlier, scale: series, replay: true, ...props });

  it("stops the actual line at that day and says so in the chart's text", () => {
    const today = html();
    const then = replay();
    expect((solidPath(today).match(/L/g) ?? []).length).toBe(14);
    expect((solidPath(then).match(/L/g) ?? []).length).toBe(8);
    expect(then).toContain("Actual $");
    expect(then).toMatch(/through October 9,/);
    expect(then).toContain("Showing the month as it stood on October 9.");
    expect(today).not.toContain("Showing the month as it stood");
  });

  it("draws a different estimate to the month's end, from the days up to that day only", () => {
    const today = html();
    const then = replay();
    expect(dashedPath(today)).toBeDefined();
    expect(dashedPath(then)).toBeDefined();
    expect(dashedPath(then)).not.toBe(dashedPath(today));
    const endY = (p: string) => Number(/L[\d.]+ ([\d.]+)$/.exec(p)![1]);
    expect(endY(dashedPath(then)!)).not.toBe(endY(dashedPath(today)!));
    expect(then).toContain("month-end estimate about");
  });

  it("keeps the y axis where today's view has it, so the scales don't jump as the slider moves", () => {
    const ticks = (out: string) => [...out.matchAll(/class="fill-ink-3">(\$[\d,K.M]+)</g)].map((m) => m[1]);
    expect(ticks(replay())).toEqual(ticks(html()));
    expect(ticks(replay())).not.toHaveLength(0);
  });

  it("does not show later days' actual figures anywhere, including the numbers table", () => {
    const then = replay();
    const row = (out: string, label: string) => new RegExp(`<th scope="row" class="font-normal">${label}</th><td class="num">([^<]*)</td>`).exec(out)?.[1];
    expect(row(then, "Oct 9")).toMatch(/^\$/);
    expect(row(then, "Oct 10")).toBe("After the day shown");
    expect(row(then, "Oct 15")).toBe("After the day shown");
    expect(row(html(), "Oct 15")).toMatch(/^\$/);
    expect(row(html(), "Oct 20")).toBe("Not complete yet");
  });

  it("dims the markers after the day and says so in their labels, and leaves the earlier ones alone", () => {
    const out = replay({ annotations });
    const marker = (label: string) => new RegExp(`<button[^>]*aria-label="[^"]*${label}[^"]*"[^>]*>`).exec(out)![0];
    expect(marker("Q4 budget")).not.toContain('data-dim="true"');
    expect(marker("Meta prospecting")).not.toContain('data-dim="true"');
    expect(marker("LASTCHANCE20")).toContain('data-dim="true"');
    expect(marker("LASTCHANCE20")).toContain("(after the day shown)");
    expect(html({ annotations })).not.toContain('data-dim="true"'); // today's view dims nothing
  });
});
