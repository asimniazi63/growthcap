// The month's net sales day by day, for the Pace chart. Money is integer cents; every value is cumulative from the first of
// the month. `actual` is null for days after `through` (the last complete day). The Pace agent owns this file's builder;
// the Overview page and the chart read the shape below.

import { addDays, monthEnd, monthOf, monthStart } from "../metrics/dates";
import { dayWeights } from "./shape";

export interface PaceSeriesDay {
  date: string; // YYYY-MM-DD, store time
  actual: number | null; // cumulative net sales through that day, cents; null after `through`
  plan: number; // cumulative planned net sales through that day, cents
}

export interface PaceSeries {
  month: string; // YYYY-MM
  through: string; // last complete day counted
  days: PaceSeriesDay[]; // every day of the month, in order
  actualThrough: number; // cumulative actual through `through`, cents
  planThrough: number; // cumulative plan through `through`, cents
  target: number; // the month's net sales target, cents
  projected: number | null; // month-end estimate, cents (an estimate, never drawn solid)
  spread: "last_year" | "even"; // how the plan was spread over the days
}

export interface BuildPaceSeriesInput {
  month: string; // YYYY-MM
  through: string; // last complete day counted, inside `month`
  target: number; // the month's net sales target, cents
  planned: number; // the plan so far from the gap (cents): the plan curve must land on it at `through`
  actual: number; // actual net sales through `through` from the gap (cents): the daily figures must add up to it
  projected?: number | null; // the gap's month-end estimate, if there is one
  spread: "last_year" | "even";
  dailyActual: ReadonlyMap<string, number>; // net sales by day, cents; a day not in the map had none
  lastYearDaily: number[] | null; // last year's same month, one value per day (day 1 first), as the gap used it
}

// The month day by day, built from the same pieces the gap uses (dayWeights and the daily query), so the picture and the
// numbers beside it agree. Null when they cannot be made to agree: the page then shows the cards without the chart.
export function buildPaceSeries(input: BuildPaceSeriesInput): PaceSeries | null {
  const { month, through, target, planned, actual } = input;
  const daysInMonth = Number(monthEnd(month).slice(8));
  if (monthOf(through) !== month) return null;
  const throughDay = Number(through.slice(8));
  if (!(throughDay >= 1) || throughDay > daysInMonth || !(target > 0)) return null;
  if (input.spread === "last_year" && !input.lastYearDaily) return null; // the plan's spread can't be drawn without its pattern

  const weights = dayWeights(daysInMonth, input.spread === "last_year" ? input.lastYearDaily : null);
  const first = monthStart(month);
  const days: PaceSeriesDay[] = [];
  let share = 0;
  let cumActual = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const date = addDays(first, d - 1);
    share += weights[d - 1]!;
    let plan = Math.round(target * share);
    if (d === daysInMonth) plan = Math.round(target); // the whole month is the whole target
    if (d === throughDay) {
      if (Math.abs(plan - planned) > 1) return null; // the curve does not land on the gap's plan so far
      plan = planned;
    }
    if (d <= throughDay) cumActual += input.dailyActual.get(date) ?? 0;
    if (d === throughDay && Math.abs(cumActual - actual) > 1) return null; // the days do not add up to the gap's actual
    days.push({ date, actual: d <= throughDay ? (d === throughDay ? actual : cumActual) : null, plan });
  }
  // Keep the plan from stepping backwards after the pin at `through` (a one-cent rounding at most).
  for (let i = 1; i < days.length; i++) if (days[i]!.plan < days[i - 1]!.plan) days[i]!.plan = days[i - 1]!.plan;

  return {
    month,
    through,
    days,
    actualThrough: actual,
    planThrough: planned,
    target: Math.round(target),
    projected: input.projected ?? null,
    spread: input.spread,
  };
}
