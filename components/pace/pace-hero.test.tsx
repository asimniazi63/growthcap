import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PaceAnnotation } from "@/lib/pace/annotation-types";
import { formatValue } from "@/lib/pace/format";
import type { PlanGap } from "@/lib/pace/gap";
import { gapAsOf } from "@/lib/pace/scrub";
import { buildPaceSeries, type PaceSeries } from "@/lib/pace/series";
import { landing } from "@/lib/pace/shape";
import type { PaceView } from "@/lib/pace/view";
import { PaceHero } from "./pace-hero";
import { PacePanel } from "./pace-panel";
import { PaceScrubber } from "./pace-scrubber";
import { reducedMotionNow, subscribeReducedMotion } from "./use-reduced-motion";

// The hook is swapped for a flag so a test can ask for less motion; its own behaviour is checked below against a stand-in window.
const motion = vi.hoisted(() => ({ reduced: false }));
vi.mock("@/components/pace/use-reduced-motion", async (importOriginal) => ({ ...(await importOriginal<typeof import("./use-reduced-motion")>()), useReducedMotion: () => motion.reduced }));

const TARGET = 3_100_000;
const planned = Math.round((TARGET * 15) / 31);
const daily = new Map(Array.from({ length: 15 }, (_, i) => [`2026-10-${String(i + 1).padStart(2, "0")}`, 70_000 + (i % 5) * 10_000] as const));
const actual = Array.from(daily.values()).reduce((s, v) => s + v, 0);
const projected = Math.round(landing(actual, planned, TARGET - planned)!);
const series: PaceSeries = buildPaceSeries({ month: "2026-10", through: "2026-10-15", target: TARGET, planned, actual, projected, spread: "even", dailyActual: daily, lastYearDaily: null })!;
// The gap as the page built it: what the hero shows at the last complete day.
const gap: PlanGap = { month: "2026-10", target: TARGET, planned, actual, gap: actual - planned, pctGap: Math.round(((actual - planned) / planned) * 1e4) / 1e4, projected, spread: "even", neededPerDay: 7_000, daysLeft: 16, throughDate: "2026-10-15" };
const annotations: PaceAnnotation[] = [
  { date: "2026-10-05", kind: "calendar", label: "Meta prospecting budget reduced by 40%" },
  { date: "2026-10-12", kind: "code", label: "LASTCHANCE20" },
];

const money = (v: number) => formatValue("net_sales", v, "USD");
const hero = (props: Partial<Parameters<typeof PaceHero>[0]> = {}) => renderToStaticMarkup(<PaceHero gap={gap} series={series} currency="USD" annotations={annotations} {...props} />);
const slider = (out: string) => /<input[^>]*type="range"[^>]*>/.exec(out)?.[0];

beforeEach(() => {
  motion.reduced = false;
});

describe("PaceHero at its default position", () => {
  it("shows the page's own figures untouched, with the slider on the last complete day", () => {
    const out = hero();
    expect(out).toContain(money(actual));
    expect(out).toContain(money(planned));
    expect(out).toContain(money(projected));
    expect(out).toContain("Need $70.00 a day for the rest of the month"); // the gap's own neededPerDay, not a recomputed one
    expect(out).not.toContain(" as of ");
    const s = slider(out)!;
    expect(s).toContain('min="1"');
    expect(s).toContain('max="15"');
    expect(s).toContain('value="15"');
    expect(s).toContain('aria-valuetext="October 15"');
    expect(s).toContain('aria-label="Replay the month: day to show"');
  });

  it("offers Play, and a Back to today that is off while already on today", () => {
    const out = hero();
    expect(out).toMatch(/<button[^>]*data-play[^>]*aria-label="Play the month from the start"[^>]*>/);
    expect(out).toMatch(/<button[^>]*disabled=""[^>]*>[^]*?Back to today/);
  });

  it("draws the chart exactly as the chart alone would, plus the slider and the markers", () => {
    const out = hero();
    expect(out).toContain("Cumulative net sales by day in October 2026");
    expect(out).toContain("data-kind=\"calendar\"");
    expect(out).toContain("Drag the slider to replay the month day by day.");
  });
});

describe("PaceHero replaying an earlier day", () => {
  const out = hero({ initialDay: 9 });
  const then = gapAsOf(series, 9);

  it("labels the figures with the day and takes every one of them from the days up to it", () => {
    expect(out).toContain("Net sales as of October 9");
    expect(out).toContain(money(then.actual));
    expect(out).toContain(money(then.planned));
    expect(out).toContain(money(then.projected!));
    expect(out).toContain(`Need ${money(then.neededPerDay!)} a day for the rest of the month`);
    expect(out).not.toContain(money(actual)); // today's actual is nowhere on the page
    expect(out).not.toContain(money(projected));
  });

  it("puts the slider on that day, with its date as the spoken value, and enables the way back", () => {
    const s = slider(out)!;
    expect(s).toContain('value="9"');
    expect(s).toContain('aria-valuetext="October 9"');
    expect(out).toContain("The month as it stood on October 9. Later days are left out.");
    expect(out).not.toMatch(/<button[^>]*disabled=""[^>]*>[^]*?Back to today/);
  });

  it("says ahead or behind plan as of that day", () => {
    const ahead = then.gap >= 0;
    expect(out).toContain(ahead ? "ahead of plan" : "behind plan");
  });

  it("puts the chart on that day too: the actual line stops and the later markers are dimmed", () => {
    expect(out).toMatch(/through October 9,/);
    expect(out).toContain('data-dim="true"'); // the 12th
    expect(out).toContain("Showing the month as it stood on October 9.");
  });

  it("starts on the last day when handed a day outside the month, and has no replay for a month with fewer than three days", () => {
    expect(slider(hero({ initialDay: 99 }))).toContain('value="15"');
    const short = buildPaceSeries({ month: "2026-10", through: "2026-10-02", target: TARGET, planned: Math.round((TARGET * 2) / 31), actual: 140_000, projected: null, spread: "even", dailyActual: new Map([["2026-10-01", 70_000], ["2026-10-02", 70_000]]), lastYearDaily: null })!;
    const outShort = renderToStaticMarkup(<PaceHero gap={{ ...gap, planned: short.planThrough, actual: 140_000 }} series={short} currency="USD" />);
    expect(slider(outShort)).toBeUndefined();
    expect(outShort).not.toContain("Play");
  });
});

describe("the scrubber under a request for less motion", () => {
  it("keeps the slider and the way back but offers no Play button", () => {
    motion.reduced = true;
    const out = hero();
    expect(slider(out)).toBeDefined();
    expect(out).toContain("Back to today");
    expect(out).not.toContain("data-play");
    expect(out).not.toContain("Play the month");
  });

  it("is the same with the scrubber used on its own", () => {
    const plot = { width: 720, x: (d: number) => 60 + (d - 1) * 20, left: 60, right: 700 };
    const props = { days: series.days, day: 5, last: 15, onDay: () => {}, playing: false, onPlaying: () => {}, plot };
    const normal = renderToStaticMarkup(<PaceScrubber {...props} reducedMotion={false} />);
    const calm = renderToStaticMarkup(<PaceScrubber {...props} reducedMotion />);
    expect(normal).toContain("data-play");
    expect(normal).toContain("motion-reduce:hidden"); // and hidden by CSS before the page is live
    expect(calm).not.toContain("data-play");
    expect(slider(calm)).toContain('value="5"');
    expect(slider(normal)).toContain('aria-valuetext="October 5"');
  });

  it("shows Pause while it is running", () => {
    const plot = { width: 720, x: (d: number) => 60 + (d - 1) * 20, left: 60, right: 700 };
    const out = renderToStaticMarkup(<PaceScrubber days={series.days} day={5} last={15} onDay={() => {}} playing onPlaying={() => {}} reducedMotion={false} plot={plot} />);
    expect(out).toContain('aria-label="Pause the replay"');
  });
});

describe("the reduced-motion query", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reads the device setting, and is false where there is no window", () => {
    expect(reducedMotionNow()).toBe(false); // node: no window
    vi.stubGlobal("window", { matchMedia: (q: string) => ({ matches: q.includes("prefers-reduced-motion: reduce") }) });
    expect(reducedMotionNow()).toBe(true);
    vi.stubGlobal("window", { matchMedia: () => ({ matches: false }) });
    expect(reducedMotionNow()).toBe(false);
  });

  it("tells a subscriber when the setting changes, and stops when it unsubscribes", () => {
    const listeners = new Set<() => void>();
    vi.stubGlobal("window", { matchMedia: () => ({ matches: false, addEventListener: (_: string, l: () => void) => listeners.add(l), removeEventListener: (_: string, l: () => void) => listeners.delete(l) }) });
    let calls = 0;
    const off = subscribeReducedMotion(() => calls++);
    listeners.forEach((l) => l());
    expect(calls).toBe(1);
    off();
    expect(listeners.size).toBe(0);
  });
});

describe("PacePanel with the chart", () => {
  const view: PaceView = {
    today: "2026-10-16",
    month: "2026-10",
    through: "2026-10-15",
    started: true,
    demoClock: false,
    hasPlan: true,
    planLabel: "Plan",
    asOf: "2026-10-31T10:34:26.000Z",
    thisMonth: { range: { from: "2026-10-01", to: "2026-10-15" }, queryId: "q", gaps: { net_sales: gap } },
    lastMonth: null,
    series,
  };

  it("hands the annotations to the chart, and draws it without them when there are none", () => {
    const withMarks = renderToStaticMarkup(<PacePanel view={view} currency="USD" annotations={annotations} />);
    expect(withMarks).toContain('data-kind="calendar"');
    expect(withMarks).toContain('type="range"');
    const without = renderToStaticMarkup(<PacePanel view={view} currency="USD" />);
    expect(without).not.toContain("data-kind");
    expect(without).toContain('type="range"');
  });
});
