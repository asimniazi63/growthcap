"use client";

import { CalendarDays } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { formatPct, monthName } from "@/lib/pace/format";
import type { PaceMonth } from "@/lib/pace/view";

// The page's link for a month: ?month=YYYY-MM for a past month, and no month param for this month, so "now" keeps a clean URL.
// Every other search param is kept.
export function monthHref(pathname: string, search: string, month: string, current: string): string {
  const params = new URLSearchParams(search);
  if (month === current) params.delete("month");
  else params.set("month", month);
  const qs = params.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

// "November 2026 (to date)" for this month, "October 2026 · 9.1% behind" for a past month with a target.
export function monthOptionLabel(m: PaceMonth): string {
  const name = monthName(m.month);
  if (!m.closed) return `${name} (to date)`;
  const pct = m.netSales ? formatPct(m.netSales.pctGap) : null;
  return pct ? `${name} · ${pct}` : name;
}

// One month picker for every page that shows a month (Pace, Overview, Portfolio). Picking a month changes ?month= in the URL, and
// the page, a server component, reads it and loads that month. `months` comes from listPaceMonths, newest first. The other search
// params are read from the address bar at the moment of the change (no useSearchParams, so no Suspense boundary is needed).
export function MonthPicker({ months, selected, label = "Month", className = "" }: { months: readonly PaceMonth[]; selected: string; label?: string; className?: string }) {
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const current = months.find((m) => !m.closed)?.month ?? selected;
  if (months.length === 0) return null;
  return (
    <label className={`inline-flex items-center gap-2 text-sm ${className}`}>
      <CalendarDays className="size-4 shrink-0 text-ink-3" aria-hidden />
      <span className="sr-only">{label}</span>
      <select value={selected} onChange={(e) => router.push(monthHref(pathname, window.location.search, e.target.value, current), { scroll: false })} className="field w-auto py-1.5 text-sm">
        {months.map((m) => (
          <option key={m.month} value={m.month}>
            {monthOptionLabel(m)}
          </option>
        ))}
      </select>
    </label>
  );
}
