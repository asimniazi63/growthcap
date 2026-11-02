import Link from "next/link";
import type { EbitdaMonth } from "@/lib/ebitda/types";
import { formatUnit, monthName } from "@/lib/pace/format";

// One row for each month: net sales, profit after variable costs, operating costs, EBITDA and EBITDA as a share of net sales. The month
// is a link to /ebitda?month=, which picks the month the waterfall draws; the selected month is tinted and carries aria-current, so it is
// not colour alone. A month whose EBITDA is a ceiling and a month that is not over yet are marked in words, and the marks are explained
// underneath only when a row has one.

export function BridgeTable({ months, selected, currency = "USD" }: { months: EbitdaMonth[]; selected: string; currency?: string }) {
  if (months.length === 0) return <p className="muted rounded-xl border border-dashed border-line-strong px-4 py-6 text-center text-sm">No months to show yet.</p>;

  // A zero is a zero, never -$0.00.
  const money = (cents: number) => formatUnit("money", cents === 0 ? 0 : cents, currency);
  const anyCeiling = months.some((m) => m.ebitdaIsCeiling);
  const anyPartial = months.some((m) => m.partial);

  return (
    <div>
      <div className="card overflow-x-auto">
        <table className="data-table min-w-[44rem] [&_tbody_tr:last-child_th]:border-b-0">
          <caption className="sr-only">EBITDA by month. Choose a month to draw its bridge.</caption>
          <thead>
            <tr>
              <th scope="col">Month</th>
              <th scope="col" className="num">
                Net sales
              </th>
              <th scope="col" className="num">
                Profit after variable costs
              </th>
              <th scope="col" className="num">
                Operating costs
              </th>
              <th scope="col" className="num">
                EBITDA
              </th>
              <th scope="col" className="num">
                EBITDA % of net sales
              </th>
            </tr>
          </thead>
          <tbody>
            {months.map((m) => {
              const on = m.month === selected;
              return (
                <tr key={m.month} aria-current={on ? "true" : undefined} className={on ? "[&>*]:bg-brand-tint [&>:first-child]:shadow-[inset_3px_0_0_var(--color-brand)]" : undefined}>
                  <th scope="row" className="relative text-[0.9rem] font-medium text-ink">
                    {/* The link stretches over its cell, so a click anywhere in the cell picks the month. */}
                    <Link href={`/ebitda?month=${m.month}`} scroll={false} aria-current={on ? "true" : undefined} className="after:absolute after:inset-0 after:content-[''] hover:underline">
                      {monthName(m.month)}
                    </Link>
                    {m.partial ? <span className="badge ml-2">Month to date</span> : null}
                  </th>
                  <td className="num">{money(m.netSalesCents)}</td>
                  <td className="num">{money(m.profitAfterVariableCostsCents)}</td>
                  <td className="num">{m.operatingCostsEntered ? money(m.operatingCostsCents) : <span className="faint">Not entered</span>}</td>
                  <td className="num whitespace-nowrap">
                    {m.ebitdaIsCeiling ? <span className="badge badge-warn mr-2">Ceiling</span> : null}
                    <span className="font-semibold">{money(m.ebitdaCents)}</span>
                  </td>
                  <td className="num">{m.ebitdaRate === null ? <span className="faint">n/a</span> : formatUnit("rate", m.ebitdaRate, currency)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {anyCeiling || anyPartial ? (
        <div className="faint mt-2 space-y-1 text-xs">
          {anyCeiling ? <p>Ceiling: a cost is missing for this month (operating costs were not entered, or some units have no unit cost), so the true EBITDA is no higher than shown.</p> : null}
          {anyPartial ? <p>Month to date: the month is not over, and its operating costs are prorated by the days counted so far.</p> : null}
        </div>
      ) : null}
    </div>
  );
}
