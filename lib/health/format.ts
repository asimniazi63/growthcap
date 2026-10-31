// Small display helpers for the store health page. Pure, so they work the same on the server and in tests.

const ZONE_FORMAT = new Map<string, Intl.DateTimeFormat>();

// "Oct 31, 2026, 11:31 AM" in the store's time zone.
export function formatInZone(date: Date, timeZone: string): string {
  let f = ZONE_FORMAT.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone, dateStyle: "medium", timeStyle: "short" });
    ZONE_FORMAT.set(timeZone, f);
  }
  return f.format(date);
}

const UTC_SLOT = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

// "Nov 1, 07:00 UTC": the daily sync runs on a UTC clock, so it is shown on one.
export function formatUtcSlot(date: Date): string {
  return `${UTC_SLOT.format(date)} UTC`;
}

const MONTH_LABEL = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", year: "numeric" });

// "2025-11" -> "Nov 2025"
export function formatMonthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return MONTH_LABEL.format(new Date(Date.UTC(y!, (m ?? 1) - 1, 1)));
}

// Integer cents -> "$1,018.60" in the store's currency.
export function formatCents(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
