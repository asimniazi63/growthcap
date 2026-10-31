// Store-local dates and times. Dates are "YYYY-MM-DD" strings; nothing here reads the system clock.

export function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  const f = from.split("-").map(Number) as [number, number, number];
  const t = to.split("-").map(Number) as [number, number, number];
  return Math.round((Date.UTC(t[0], t[1] - 1, t[2]) - Date.UTC(f[0], f[1] - 1, f[2])) / 86400000);
}

export function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** 0 = Sunday … 6 = Saturday */
export function weekday(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function monthOf(ymd: string): string {
  return ymd.slice(0, 7);
}

/** The store-local date of a processedAt string (they carry the store's offset, so this is just the prefix). */
export function localDate(iso: string): string {
  return iso.slice(0, 10);
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function offsetMinutes(timeZone: string, utcMs: number): number {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" });
    formatters.set(timeZone, f);
  }
  const part = f.formatToParts(new Date(utcMs)).find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  const m = /GMT([+-])(\d{2}):(\d{2})/.exec(part);
  if (!m) return 0;
  return (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
}

const pad = (n: number) => String(n).padStart(2, "0");

/** ISO 8601 for a store-local wall-clock time, with that date's UTC offset (DST-aware). */
export function localIso(timeZone: string, ymd: string, hh: number, mm: number, ss = 0): string {
  const [y, mo, d] = ymd.split("-").map(Number) as [number, number, number];
  const wallAsUtc = Date.UTC(y, mo - 1, d, hh, mm, ss);
  let offset = offsetMinutes(timeZone, wallAsUtc);
  offset = offsetMinutes(timeZone, wallAsUtc - offset * 60000);
  const sign = offset < 0 ? "-" : "+";
  const abs = Math.abs(offset);
  return `${ymd}T${pad(hh)}:${pad(mm)}:${pad(ss)}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}
