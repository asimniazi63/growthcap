import { addDays } from "./metrics/dates";

// The only place a store's "today" is derived from the system time. Tool defaults, named periods and the date
// given to the model all call storeToday(); tests and evals pin "now" with setTestNow().
const STALE_AFTER_MS = 36 * 60 * 60 * 1000;

let pinnedNowMs: number | null = null;

export function setTestNow(iso: string | null): void {
  if (iso === null) {
    pinnedNowMs = null;
    return;
  }
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) throw new Error(`setTestNow: not a valid timestamp: ${iso}`);
  pinnedNowMs = ms;
}

function nowMs(): number {
  return pinnedNowMs ?? Date.now();
}

export function localDate(ms: number, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(ms));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

// The store-local date "today". A demo store between top-ups has no recent orders. When the newest order is more than
// 36 hours old, today is the day AFTER that order, as it would be on a live store the morning after its last order:
// if the data stops on the last day of a month, that month is "last month" and the new month has no orders yet.
export function storeToday(timezone: string, newestOrderAt: string | null): string {
  const now = nowMs();
  if (newestOrderAt) {
    const newest = Date.parse(newestOrderAt);
    if (!Number.isNaN(newest) && now - newest > STALE_AFTER_MS) return addDays(localDate(newest, timezone), 1);
  }
  return localDate(now, timezone);
}

// True when the store has had no order for more than 36 hours, so "today" has been set to the day after its newest
// order (a demo store between top-ups). The Pace page says so; the chat no longer shows a banner for it.
export function isDemoClock(timezone: string, newestOrderAt: string | null): boolean {
  return storeToday(timezone, newestOrderAt) !== localDate(nowMs(), timezone);
}
