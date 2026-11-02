import { describe, expect, it } from "vitest";
import { planGap, type PlanTargets } from "./gap";
import { buildPaceSeries, type PaceSeries } from "./series";
import { gapAsOf, lastDayOf, nextPlayDay, playIntervalMs, PLAY_SECONDS, seriesAsOf } from "./scrub";

const TARGET = 650_688;
const plan: PlanTargets = new Map([["2026-10", { net_sales: TARGET }]]);
// Last year's October: quiet, then a burst in the last week.
const lastYear = [...Array(24).fill(1000), 4000, 5000, 6000, 4000, 3000, 2000, 1000];
const lastYearDaily = async () => lastYear;

// Net sales by day through the 15th: a slow start, a good middle.
const daily = new Map<string, number>(Array.from({ length: 15 }, (_, i) => [`2026-10-${String(i + 1).padStart(2, "0")}`, [8000, 9000, 7000, 12_000, 30_000, 25_000, 6000, 5000, 11_000, 14_000, 22_000, 9000, 7000, 8000, 13_000][i]!]));
const cum = (through: number) => Array.from(daily.values()).slice(0, through).reduce((s, v) => s + v, 0);

async function makeSeries(through = 15): Promise<PaceSeries> {
  const to = `2026-10-${String(through).padStart(2, "0")}`;
  const g = (await planGap({ plan, range: { from: "2026-10-01", to }, metrics: ["net_sales"], values: { net_sales: cum(through) }, lastYearDaily }))!.net_sales!;
  const s = buildPaceSeries({ month: "2026-10", through: to, target: g.target, planned: g.planned, actual: g.actual, projected: g.projected ?? null, spread: g.spread!, dailyActual: daily, lastYearDaily: lastYear });
  expect(s).not.toBeNull();
  return s!;
}

describe("gapAsOf: the same arithmetic as planGap, on the days up to the day asked for", () => {
  it.each([4, 9, 15])("matches planGap for October 1 to %i, to the cent", async (day) => {
    const series = await makeSeries(15);
    const to = `2026-10-${String(day).padStart(2, "0")}`;
    const truth = (await planGap({ plan, range: { from: "2026-10-01", to }, metrics: ["net_sales"], values: { net_sales: cum(day) }, lastYearDaily }))!.net_sales!;
    const got = gapAsOf(series, day);
    expect(got.throughDate).toBe(to);
    expect(got.actual).toBe(truth.actual);
    expect(Math.abs(got.planned - truth.planned)).toBeLessThanOrEqual(1);
    expect(Math.abs(got.gap - truth.gap)).toBeLessThanOrEqual(1);
    expect(Math.abs(got.pctGap! - truth.pctGap!)).toBeLessThan(0.001);
    expect(Math.abs(got.projected! - truth.projected!)).toBeLessThanOrEqual(5); // the plan curve is rounded to a cent a day, and the estimate scales it by actual over plan
    expect(got.daysLeft).toBe(truth.daysLeft);
    expect(Math.abs(got.neededPerDay! - truth.neededPerDay!)).toBeLessThanOrEqual(1);
    expect(got.targetMet).toBe(truth.targetMet);
  });

  it("changes with the day: an early look at the month gives a different estimate and a different need a day", async () => {
    const series = await makeSeries(15);
    const early = gapAsOf(series, 5);
    const late = gapAsOf(series, 15);
    expect(early.projected).not.toBe(late.projected);
    expect(early.neededPerDay).not.toBe(late.neededPerDay);
    expect(early.daysLeft).toBe(26);
    expect(late.daysLeft).toBe(16);
  });

  it("says the target is met, with no need a day, once the actual passes it", async () => {
    const series = await makeSeries(15);
    const rich: PaceSeries = { ...series, target: 100_000 }; // the 15 days brought in more than this
    const g = gapAsOf(rich, 15);
    expect(g.targetMet).toBe(true);
    expect(g.neededPerDay).toBeUndefined();
  });

  it("leaves out the estimate on the last day of the month", async () => {
    const series = await makeSeries(15);
    const whole: PaceSeries = { ...series, through: "2026-10-31", days: series.days.map((d) => ({ ...d, actual: d.actual ?? 1 })) };
    const g = gapAsOf(whole, 31);
    expect(g.projected).toBeUndefined();
    expect(g.neededPerDay).toBeUndefined();
    expect(g.daysLeft).toBeUndefined();
  });

  it("never reads a later day: changing every day after the one asked for changes nothing", async () => {
    const series = await makeSeries(15);
    const tampered: PaceSeries = {
      ...series,
      days: series.days.map((d, i) => (i >= 9 ? { ...d, actual: d.actual === null ? null : 99_999_999, plan: d.plan + 5_000_000 } : d)),
    };
    expect(gapAsOf(tampered, 9)).toEqual(gapAsOf(series, 9));
    expect(seriesAsOf(tampered, 9).days.slice(0, 9)).toEqual(seriesAsOf(series, 9).days.slice(0, 9));
    expect(seriesAsOf(tampered, 9).projected).toBe(seriesAsOf(series, 9).projected);
  });

  it("keeps the day inside the month's complete days", async () => {
    const series = await makeSeries(15);
    expect(gapAsOf(series, 0).throughDate).toBe("2026-10-01");
    expect(gapAsOf(series, 99).throughDate).toBe("2026-10-15");
    expect(gapAsOf(series, 6.4).throughDate).toBe("2026-10-06");
  });
});

describe("seriesAsOf", () => {
  it("is today's series itself at the last complete day, so nothing changes until the slider moves", async () => {
    const series = await makeSeries(15);
    expect(lastDayOf(series)).toBe(15);
    expect(seriesAsOf(series, 15)).toBe(series);
    expect(seriesAsOf(series, 40)).toBe(series);
  });

  it("stops the actual line at the day, leaves the plan as it was, and recomputes the estimate from the days up to it", async () => {
    const series = await makeSeries(15);
    const s = seriesAsOf(series, 9);
    expect(s.through).toBe("2026-10-09");
    expect(s.days).toHaveLength(31);
    expect(s.days.slice(0, 9).map((d) => d.actual)).toEqual(series.days.slice(0, 9).map((d) => d.actual));
    expect(s.days.slice(9).every((d) => d.actual === null)).toBe(true);
    expect(s.days.map((d) => d.plan)).toEqual(series.days.map((d) => d.plan));
    expect(s.actualThrough).toBe(cum(9));
    expect(s.planThrough).toBe(series.days[8]!.plan);
    expect(s.projected).not.toBeNull();
    expect(s.projected).not.toBe(series.projected);
    expect(s.target).toBe(series.target);
    expect(series.days[10]!.actual).not.toBeNull(); // the original is untouched
  });
});

describe("the replay's timing", () => {
  it("steps a month forward in about eight seconds, one day at a time, and stops at the last day", () => {
    expect(PLAY_SECONDS).toBe(8);
    expect(playIntervalMs(31) * 30).toBeGreaterThan(7900);
    expect(playIntervalMs(31) * 30).toBeLessThan(8100);
    expect(playIntervalMs(1)).toBeGreaterThan(0);
    expect(nextPlayDay(3, 15)).toBe(4);
    expect(nextPlayDay(15, 15)).toBe(15);
    let d = 1;
    for (let i = 0; i < 40; i++) d = nextPlayDay(d, 15);
    expect(d).toBe(15);
  });
});
