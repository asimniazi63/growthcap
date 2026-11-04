import Link from "next/link";
import { monthName } from "@/lib/pace/format";
import type { PaceMonth } from "@/lib/pace/view";

// The Pace page's calendar: every month from the first order to this one, oldest on the left, each a link to that month. A finished
// month's bar is its net sales against its whole-month target, drawn from a middle line: up in the ahead colour when it beat the
// target, down in the behind colour when it fell short, and longer for a bigger gap, so the direction is not told by colour alone.
// This month is still running, so its mark is hatched and says "to date". A month the plan can't be held against gets a flat grey mark.

const REACH = 20; // px: the longest a bar runs from the middle line, for a gap of CAP or more
const SHORTEST = 3; // px: so a gap of a fraction of a percent still shows which way it went
const CAP = 0.25; // a quarter ahead or behind fills the bar, as on the tiles' variance bars

const shortMonth = (month: string) => new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" }).format(new Date(`${month}-01T00:00:00Z`));

// How a month stood, in the words its link reads out: "9.1% behind plan", "3.2% ahead of plan", "to date". The percentage is written
// as formatPct writes it, but the direction comes from the gap, so a gap too small to move the percentage still reads the way its
// bar points.
function standing(m: PaceMonth): string {
  if (!m.closed) return "to date";
  const n = m.netSales;
  if (!n) return "no comparison with the plan";
  if (n.gap === 0) return "on plan";
  const size = n.pctGap === null ? "" : `${(Math.abs(n.pctGap) * 100).toFixed(1)}% `;
  return n.gap < 0 ? `${size}behind plan` : `${size}ahead of plan`;
}

function Bar({ m }: { m: PaceMonth }) {
  const n = m.netSales;
  let mark;
  if (!m.closed) {
    mark = <span className="hatch absolute top-1/2 left-1/2 h-4 w-3 -translate-x-1/2 -translate-y-1/2 rounded-[3px] border border-dashed border-estimate" />;
  } else if (!n) {
    mark = <span className="absolute top-1/2 left-1/2 h-1 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink-3/45" />;
  } else {
    const share = n.pctGap === null ? 0 : Math.min(Math.abs(n.pctGap), CAP) / CAP;
    const height = `${(SHORTEST + share * (REACH - SHORTEST)).toFixed(1)}px`;
    mark =
      n.gap >= 0 ? (
        <span className="absolute bottom-1/2 left-1/2 w-3 -translate-x-1/2 rounded-t-[3px] bg-ahead" style={{ height }} />
      ) : (
        <span className="absolute top-1/2 left-1/2 w-3 -translate-x-1/2 rounded-b-[3px] bg-behind" style={{ height }} />
      );
  }
  return (
    <span aria-hidden className="relative block h-11 w-full">
      <span className="absolute inset-x-1.5 top-1/2 h-px bg-line-strong" />
      {mark}
    </span>
  );
}

// The row scrolls sideways when it doesn't fit. The scroller runs right to left and the list inside it left to right again, so it
// opens at its right-hand end with the newest months in view, while the links stay oldest first for the keyboard and screen readers.
export function MonthStrip({ months, selected }: { months: readonly PaceMonth[]; selected: string }) {
  if (months.length < 2) return null; // one month is nothing to choose between
  const ordered = [...months].sort((a, b) => a.month.localeCompare(b.month));
  return (
    <nav aria-label="Months" className="card px-2 pt-2.5 pb-1">
      <p className="faint px-2 text-[12.5px]">Net sales against each month&apos;s target: above the line is ahead, below is behind.</p>
      {/* The list's padding keeps the focus ring and the selected month's ring inside the scroller, which clips. */}
      <div className="mt-0.5 overflow-x-auto [direction:rtl]">
        <ol className="flex w-max min-w-full gap-1 p-1 [direction:ltr]">
          {ordered.map((m, i) => {
            const on = m.month === selected;
            const label = `${monthName(m.month)}, ${standing(m)}`;
            const small = on ? "text-[11px] leading-tight" : "text-[11px] leading-tight text-ink-3";
            return (
              <li key={m.month} className="flex">
                <Link
                  href={m.closed ? `/pace?month=${m.month}` : "/pace"}
                  scroll={false}
                  aria-current={on ? "page" : undefined}
                  aria-label={label}
                  title={label}
                  className={`flex w-14 flex-col items-center rounded-xl px-1 pt-1.5 pb-2 text-center transition-colors ${on ? "bg-brand-tint text-brand-strong ring-1 ring-brand/40" : "text-ink-2 hover:bg-paper-2 hover:text-ink"}`}
                >
                  <Bar m={m} />
                  <span className={`mt-1 text-[13px] leading-tight ${on ? "font-semibold" : "font-medium"}`}>{shortMonth(m.month)}</span>
                  {i === 0 || m.month.endsWith("-01") ? <span className={small}>{m.month.slice(0, 4)}</span> : null}
                  {m.closed ? null : <span className={small}>to date</span>}
                </Link>
              </li>
            );
          })}
        </ol>
      </div>
    </nav>
  );
}
