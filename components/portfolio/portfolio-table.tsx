import { formatGap, formatPct, formatValue, monthName, type Tone } from "@/lib/pace/format";
import type { PortfolioRow } from "@/lib/portfolio/portfolio";

const TONE: Record<Tone, string> = { ahead: "text-emerald-700", behind: "text-rose-700", even: "text-neutral-600" };

// The signed-in person's brands, most dollars behind plan first. A brand with nothing to compare shows a plain note.
export function PortfolioTable({ rows }: { rows: PortfolioRow[] }) {
  if (rows.length === 0) {
    return <p className="rounded-lg border border-neutral-200 bg-white px-4 py-3 text-sm text-neutral-600">None of your brands are set up here yet.</p>;
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-neutral-200 text-xs uppercase tracking-wide text-neutral-500">
          <tr>
            <th className="px-4 py-2 font-medium">Brand</th>
            <th className="px-4 py-2 font-medium">Net sales this month</th>
            <th className="px-4 py-2 font-medium">Against plan</th>
            <th className="px-4 py-2 font-medium">Estimate for month end</th>
            <th className="px-4 py-2 font-medium">Biggest driver</th>
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
            return (
              <tr key={r.tenantId} className="border-b border-neutral-100 align-top last:border-0">
                <td className="px-4 py-3 font-medium">{r.name}</td>
                {g && gap ? (
                  <>
                    <td className="px-4 py-3">
                      {formatValue("net_sales", g.actual, r.currency)}
                      <span className="block text-xs text-neutral-500">
                        {monthName(g.month)}, through {g.throughDate}
                      </span>
                    </td>
                    <td className={`px-4 py-3 ${TONE[gap.tone]}`}>
                      {gap.text}
                      {pct ? ` (${pct})` : ""}
                    </td>
                    <td className="px-4 py-3">{g.projected !== undefined ? formatValue("net_sales", g.projected, r.currency) : "Not available"}</td>
                    <td className="px-4 py-3">
                      {r.driver && driver ? (
                        <>
                          {r.driver.label}
                          <span className={`block text-xs ${TONE[driver.tone]}`}>{direction}</span>
                        </>
                      ) : (
                        <span className="text-neutral-500">Not available</span>
                      )}
                    </td>
                  </>
                ) : (
                  <td colSpan={4} className="px-4 py-3 text-neutral-600">
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
