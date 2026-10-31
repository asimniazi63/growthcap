// Store-local calendar dates as "YYYY-MM-DD" strings. Nothing here reads the system clock.

export function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  const p = (s: string) => s.split("-").map(Number) as [number, number, number];
  const [fy, fm, fd] = p(from);
  const [ty, tm, td] = p(to);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
}

export function isValidDate(ymd: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(ymd) && addDays(ymd, 0) === ymd;
}

export const monthOf = (ymd: string) => ymd.slice(0, 7);
export const monthStart = (month: string) => `${month}-01`;

export function monthEnd(month: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return addDays(m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`, -1);
}

export function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const idx = y * 12 + (m - 1) + n;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
}

// The Monday on or before the date.
export function weekStart(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number) as [number, number, number];
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  return addDays(ymd, -((dow + 6) % 7));
}

export const isWholeMonth = (from: string, to: string) => from === monthStart(monthOf(from)) && to === monthEnd(monthOf(from));

// The same range a year earlier. A whole month stays a whole month (Feb 29 -> Feb 28 of the year before).
export function sameRangeLastYear(from: string, to: string): { from: string; to: string } {
  if (isWholeMonth(from, to)) {
    const m = addMonths(monthOf(from), -12);
    return { from: monthStart(m), to: monthEnd(m) };
  }
  const shift = (d: string) => {
    const [y, m, day] = d.split("-").map(Number) as [number, number, number];
    const cand = `${y - 1}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    return isValidDate(cand) ? cand : `${y - 1}-${String(m).padStart(2, "0")}-28`;
  };
  return { from: shift(from), to: shift(to) };
}

// The range just before: the previous calendar month for a whole month, otherwise the same number of days.
export function previousRange(from: string, to: string): { from: string; to: string } {
  if (isWholeMonth(from, to)) {
    const m = addMonths(monthOf(from), -1);
    return { from: monthStart(m), to: monthEnd(m) };
  }
  const len = daysBetween(from, to) + 1;
  return { from: addDays(from, -len), to: addDays(from, -1) };
}
