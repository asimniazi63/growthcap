// Time travel for the Pace chart: the month as it stood on an earlier day. Pure functions. Each one reads only the days up to the
// day asked for (plus the month's target), so nothing from a later day can show in an earlier view.

import type { PlanGap } from "./gap";
import type { PaceSeries } from "./series";
import { landing, MIN_DAYS_FOR_ESTIMATE } from "./shape";

export const PLAY_SECONDS = 8;

// The last complete day, 1-based: the latest day the scrubber can show, and today's view.
export function lastDayOf(series: PaceSeries): number {
  return Math.max(1, series.days.findIndex((d) => d.date === series.through) + 1);
}

const clampDay = (series: PaceSeries, day: number) => Math.min(lastDayOf(series), Math.max(1, Math.round(day)));

// The net sales gap as it stood at the end of `day` (1-based), worked out the way planGap does it: the plan so far is the
// plan curve on that day, the month-end estimate is landing() on what had happened and the plan still to come, and what is
// needed a day is what is left to the target spread over the days left. Cents are rounded as planGap rounds them.
export function gapAsOf(series: PaceSeries, rawDay: number): PlanGap {
  const day = clampDay(series, rawDay);
  const here = series.days[day - 1]!;
  const actual = here.actual ?? 0;
  const planned = here.plan;
  const gap = actual - planned;
  const daysLeft = series.days.length - day;
  const out: PlanGap = {
    month: series.month,
    target: series.target,
    planned,
    actual,
    gap,
    pctGap: planned === 0 ? null : Math.round((gap / planned) * 1e4) / 1e4,
    spread: series.spread,
    throughDate: here.date,
  };
  if (daysLeft > 0) {
    if (day >= MIN_DAYS_FOR_ESTIMATE) {
      const projected = landing(actual, planned, series.target - planned);
      if (projected !== null) out.projected = Math.round(projected);
    } else {
      out.earlyMonth = { daysCounted: day, estimateAfterDays: MIN_DAYS_FOR_ESTIMATE };
    }
    const remaining = series.target - actual;
    out.daysLeft = daysLeft;
    if (remaining > 0) out.neededPerDay = Math.round(remaining / daysLeft);
    else out.targetMet = true;
  }
  return out;
}

// The series cut at `day`: actual is drawn only up to it, the plan is as it was, and the month-end estimate is recomputed from
// the days up to it. At or past the last complete day this is the series itself, so today's view is exactly what the page built.
export function seriesAsOf(series: PaceSeries, rawDay: number): PaceSeries {
  const day = clampDay(series, rawDay);
  if (day >= lastDayOf(series)) return series;
  const g = gapAsOf(series, day);
  return {
    ...series,
    through: g.throughDate,
    days: series.days.map((d, i) => (i < day ? d : { ...d, actual: null })),
    actualThrough: g.actual,
    planThrough: g.planned,
    projected: g.projected ?? null,
  };
}

export const playIntervalMs = (lastDay: number) => Math.round((PLAY_SECONDS * 1000) / Math.max(1, lastDay - 1));

// One step of the replay: the next day, stopping at the last.
export const nextPlayDay = (day: number, lastDay: number) => Math.min(lastDay, day + 1);
