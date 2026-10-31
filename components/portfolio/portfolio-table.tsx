import { ArrowDownRight, ArrowUpRight, LayoutGrid, Minus, TrendingDown, TrendingUp } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { formatGap, formatPct, formatValue, monthName, type Tone } from "@/lib/pace/format";
import type { PortfolioRow } from "@/lib/portfolio/portfolio";

const TONE: Record<Tone, string> = { ahead: "text-ahead", behind: "text-behind", even: "text-ink-2" };
const BADGE: Record<Tone, string> = { ahead: "badge-ahead", behind: "badge-behind", even: "" };
const BADGE_ICON = { ahead: ArrowUpRight, behind: ArrowDownRight, even: Minus } as const;
const DRIVER_ICON = { ahead: TrendingUp, behind: TrendingDown, even: Minus } as const;

// The signed-in person's brands, most dollars behind plan first. A brand with nothing to compare shows a plain note.
export function PortfolioTable({ rows }: { rows: PortfolioRow[] }) {
  if (rows.length === 0) {
    return (
      <EmptyState icon={LayoutGrid} title="No brands to compare yet">
        None of your brands are set up here yet.
      </EmptyState>
    );
  }
  return (
    <div className="card overflow-x-auto">
      <table className="data-table min-w-[820px]">
        <thead>
          <tr>
            <th scope="col">Brand</th>
            <th scope="col" className="num">
              Net sales this month
            </th>
            <th scope="col" className="num">
              Against plan
            </th>
            <th scope="col" className="num">
              Estimate for month end
            </th>
            <th scope="col">Biggest driver</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const g = r.gap;
            const gap = g ? formatGap("net_sales", g.gap, r.currency) : null;
            const pct = g ? formatPct(g.pctGap) : null;
            // The driver tree compares the whole month with the month's whole target, so beside a month-to-date gap only its
            // direction is shown, not its dollars.
            const driver = r.driver ? formatGap("net_sales", r.driver.deltaCents, r.currency) : null;
            const direction = driver ? (driver.tone === "ahead" ? "Ahead of plan" : driver.tone === "behind" ? "Behind plan" : "On plan") : null;
            const GapIcon = gap ? BADGE_ICON[gap.tone] : null;
            const DriverIcon = driver ? DRIVER_ICON[driver.tone] : null;
            return (
              <tr key={r.tenantId}>
                <td>
                  <span className="font-medium">{r.name}</span>
                  <span className="faint block text-xs">{r.currency}</span>
                </td>
                {g && gap && GapIcon ? (
                  <>
                    <td className="num">
                      <span className="font-medium">{formatValue("net_sales", g.actual, r.currency)}</span>
                      <span className="faint block text-xs">
                        {monthName(g.month)}, through {g.throughDate}
                      </span>
                    </td>
                    <td className="num">
                      <span className={`block font-semibold ${TONE[gap.tone]}`}>{gap.text}</span>
                      {pct ? (
                        <span className={`badge mt-1 ${BADGE[gap.tone]}`}>
                          <GapIcon className="size-3.5" aria-hidden />
                          {pct}
                        </span>
                      ) : null}
                    </td>
                    <td className="num">
                      {g.projected !== undefined ? (
                        <span className="border-b border-dashed border-estimate text-ink-2">{formatValue("net_sales", g.projected, r.currency)}</span>
                      ) : (
                        <span className="faint">Not available</span>
                      )}
                    </td>
                    <td>
                      {r.driver && driver && DriverIcon ? (
                        <span className="flex items-start gap-2">
                          <DriverIcon className={`mt-0.5 size-4 shrink-0 ${TONE[driver.tone]}`} aria-hidden />
                          <span>
                            <span className="block">{r.driver.label}</span>
                            <span className={`block text-xs ${TONE[driver.tone]}`}>{direction}</span>
                          </span>
                        </span>
                      ) : (
                        <span className="faint">Not available</span>
                      )}
                    </td>
                  </>
                ) : (
                  <td colSpan={4} className="muted">
                    {r.note}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
