// Dates in plain words, for the proof drawer and the cards on traced figures. Pure, so they can be checked on their own.

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function parseDay(text: string): { y: number; m: number; d: number } | null {
  const hit = DAY.exec(text);
  if (!hit) return null;
  const [y, m, d] = [Number(hit[1]), Number(hit[2]), Number(hit[3])];
  return m >= 1 && m <= 12 && d >= 1 && d <= 31 ? { y, m, d } : null;
}

// "2026-09-01" to "2026-09-30" reads "September 1 to 30, 2026".
export function formatPeriod(range: { from: string; to: string }): string {
  const a = parseDay(range.from);
  const b = parseDay(range.to);
  if (!a || !b) return range.from === range.to ? range.from : `${range.from} to ${range.to}`;
  const first = `${MONTHS[a.m - 1]} ${a.d}`;
  if (a.y === b.y && a.m === b.m && a.d === b.d) return `${first}, ${a.y}`;
  if (a.y === b.y && a.m === b.m) return `${first} to ${b.d}, ${a.y}`;
  if (a.y === b.y) return `${first} to ${MONTHS[b.m - 1]} ${b.d}, ${a.y}`;
  return `${first}, ${a.y} to ${MONTHS[b.m - 1]} ${b.d}, ${b.y}`;
}

// "2026-10-31T10:34:00.000Z" reads "October 31, 10:34 UTC" (with the year when it is not this year).
export function formatAsOf(iso: string, now: Date = new Date()): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  const year = at.getUTCFullYear() === now.getUTCFullYear() ? "" : `, ${at.getUTCFullYear()}`;
  return `${MONTHS[at.getUTCMonth()]} ${at.getUTCDate()}${year}, ${pad(at.getUTCHours())}:${pad(at.getUTCMinutes())} UTC`;
}
