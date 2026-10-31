// The arithmetic behind pacing. Pure functions: no database, no clock.

// How a month's target is spread over its days. `lastYearDaily` is the same month last year, one value per day (day 1 first),
// or null when the data doesn't cover it. A day with nothing (or a net refund) counts as zero. Without a usable pattern the
// target is spread evenly. The result has one weight per day of this month and adds up to 1.
export function dayWeights(daysInMonth: number, lastYearDaily: number[] | null): number[] {
  const even = () => Array<number>(daysInMonth).fill(1 / daysInMonth);
  if (!lastYearDaily || lastYearDaily.length === 0) return even();
  const clean = lastYearDaily.map((v) => (v > 0 ? v : 0));
  const total = clean.reduce((s, v) => s + v, 0);
  if (total <= 0) return even();
  const average = total / clean.length;
  const raw = Array.from({ length: daysInMonth }, (_, i) => clean[i] ?? average); // a day last year's month didn't have gets the average day
  const sum = raw.reduce((s, v) => s + v, 0);
  return raw.map((v) => v / sum);
}

// The share of the month's target that falls on days fromDay to toDay (1-based, both included).
export function shareThrough(weights: number[], fromDay: number, toDay: number): number {
  let share = 0;
  for (let d = Math.max(1, fromDay); d <= Math.min(weights.length, toDay); d++) share += weights[d - 1]!;
  return share;
}

// Where the month will land: what has happened so far plus the rest of the plan, scaled by how the month has gone against
// its plan so far. An estimate with no range. Null before any of the plan has come due.
export function landing(actualToDate: number, plannedToDate: number, plannedRest: number): number | null {
  if (plannedToDate <= 0) return null;
  return actualToDate + plannedRest * (actualToDate / plannedToDate);
}
