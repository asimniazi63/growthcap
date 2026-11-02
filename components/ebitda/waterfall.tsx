import { TriangleAlert } from "lucide-react";
import type { EbitdaMonth } from "@/lib/ebitda/types";
import { formatUnit, monthName } from "@/lib/pace/format";

// The bridge from net sales down to EBITDA for one month: net sales, then each cost taken off the running total, profit after variable
// costs, then the operating costs, then EBITDA. One bar to a line, with the line's name and amount above it, in plain SVG. The bars are
// placed in percentages of the card's width and the type is not scaled, so the words stay the size they are drawn at on a phone.
// The same figures are in the aria-label and in the "Show the numbers" table.
//
// A cost is a bar hanging from where the running total stood; net sales, profit after variable costs and EBITDA stand on the zero line.
// A loss runs left of it. A line that is zero has no bar. EBITDA is drawn dashed and pale when it is a ceiling, because a figure that is
// no higher than shown is not a firm one.

type Kind = "start" | "cost" | "subtotal" | "result";

interface Step {
  key: string;
  label: string;
  kind: Kind;
  cents: number; // as the bridge states the line: a cost is a positive amount here and is taken off
  notEntered?: boolean; // operating costs nobody has entered, which would otherwise read as a firm $0
}

function stepsOf(m: EbitdaMonth): Step[] {
  return [
    { key: "netSales", label: "Net sales", kind: "start", cents: m.netSalesCents },
    { key: "costOfGoods", label: "Cost of goods", kind: "cost", cents: m.costOfGoodsCents },
    { key: "cardFees", label: "Card fees", kind: "cost", cents: m.cardFeesCents },
    { key: "fulfilment", label: "Fulfilment", kind: "cost", cents: m.fulfilmentCents },
    { key: "adSpend", label: "Ad spend", kind: "cost", cents: m.adSpendCents },
    { key: "profitAfterVariableCosts", label: "Profit after variable costs", kind: "subtotal", cents: m.profitAfterVariableCostsCents },
    { key: "operatingCosts", label: "Operating costs", kind: "cost", cents: m.operatingCostsCents, notEntered: !m.operatingCostsEntered },
    { key: "ebitda", label: m.ebitdaIsCeiling ? "EBITDA (ceiling)" : "EBITDA", kind: "result", cents: m.ebitdaCents },
  ];
}

// Each step with the two ends of its bar, in cents. A cost starts where the running total stood and ends below it; the rest start at zero.
function place(steps: Step[]) {
  let running = 0;
  return steps.map((s) => {
    if (s.kind === "cost") {
      const from = running;
      running -= s.cents;
      return { ...s, from, to: running };
    }
    running = s.cents;
    return { ...s, from: 0, to: s.cents };
  });
}

const PAD = 0.5; // percent of the width kept clear at each end
const MIN_BAR = 0.4; // percent: a small amount still shows as a mark
const TOP = 6;
const ROW = 42;
const LABEL_Y = 15; // the baseline of a line's name and amount, below the top of its row
const BAR_Y = 24;
const BAR_H = 12;

const unitsLine = (n: number) => `${n} ${n === 1 ? "unit sold has" : "units sold have"} no unit cost`;

// The result is green when it is a profit and red when it is a loss; a ceiling also gets an outline in the same colour, which is dashed.
function barClassOf(kind: Kind, ahead: boolean, ceiling: boolean): string {
  if (kind === "start") return "fill-brand";
  if (kind === "cost") return "fill-ink-3";
  if (kind === "subtotal") return "fill-ink-2";
  if (ceiling) return ahead ? "fill-ahead stroke-ahead" : "fill-behind stroke-behind";
  return ahead ? "fill-ahead" : "fill-behind";
}

export function Waterfall({ month, currency = "USD" }: { month: EbitdaMonth; currency?: string }) {
  // A zero is a zero, never -$0.00: a cost line that is nothing would otherwise be negated to negative zero.
  const money = (cents: number) => formatUnit("money", cents === 0 ? 0 : cents, currency);
  const rate = (fraction: number | null) => (fraction === null ? null : formatUnit("rate", fraction, currency));
  const placed = place(stepsOf(month));
  const ends = placed.flatMap((p) => [p.from, p.to]);
  const lo = Math.min(0, ...ends);
  const span = Math.max(0, ...ends) - lo || 1; // a month where every line is zero has no length to draw
  const wide = 100 - 2 * PAD;
  const at = (cents: number) => PAD + ((cents - lo) / span) * wide;
  const zero = `${at(0).toFixed(2)}%`;
  const height = TOP + placed.length * ROW;

  const shown = (p: (typeof placed)[number]) => (p.notEntered ? "Not entered" : money(p.kind === "cost" ? -p.cents : p.cents));
  const profitRate = rate(month.profitAfterVariableCostsRate);
  const ebitdaRate = rate(month.ebitdaRate);
  const noRates = profitRate === null || ebitdaRate === null;

  const ariaLabel = [
    `EBITDA bridge for ${monthName(month.month)}${month.partial ? " (month to date)" : ""}: net sales ${money(month.netSalesCents)}`,
    `less cost of goods ${money(month.costOfGoodsCents)}, card fees ${money(month.cardFeesCents)}, fulfilment ${money(month.fulfilmentCents)} and ad spend ${money(month.adSpendCents)}`,
    `profit after variable costs ${money(month.profitAfterVariableCostsCents)}${profitRate ? ` (${profitRate} of net sales)` : ""}`,
    month.operatingCostsEntered ? `less operating costs ${money(month.operatingCostsCents)}` : "operating costs were not entered",
    `EBITDA ${money(month.ebitdaCents)}${ebitdaRate ? ` (${ebitdaRate} of net sales)` : ""}${month.ebitdaIsCeiling ? ", a ceiling: no higher than shown" : ""}.`,
  ].join("; ");

  return (
    <div>
      {month.ebitdaIsCeiling ? (
        <div role="note" className="mb-4 flex gap-3 rounded-xl border border-warn/30 bg-warn-tint px-4 py-3 text-sm">
          <TriangleAlert className="mt-0.5 size-4.5 shrink-0 text-warn" aria-hidden />
          <div className="min-w-0">
            <p className="font-semibold text-ink">EBITDA is a ceiling for this month</p>
            <p className="mt-0.5 text-ink-2">The true figure is no higher than shown, because some costs are missing.</p>
            {!month.operatingCostsEntered || month.unitsWithoutCost > 0 ? (
              <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-ink">
                {!month.operatingCostsEntered ? <li>No operating costs were entered for this month.</li> : null}
                {month.unitsWithoutCost > 0 ? <li>{unitsLine(month.unitsWithoutCost)}.</li> : null}
              </ul>
            ) : null}
          </div>
        </div>
      ) : null}
      {month.partial ? (
        <p className="muted mb-4 text-sm">
          <span className="font-medium text-ink">Month to date.</span> Operating costs are prorated by the days counted so far.
        </p>
      ) : null}

      <svg role="img" aria-label={ariaLabel} width="100%" height={height} className="block">
        {placed.map((p, i) => {
          const top = TOP + i * ROW;
          const total = p.kind !== "cost";
          const length = (Math.abs(p.to - p.from) / span) * wide;
          // A bar is never shorter than a mark, and never pushed past the right-hand edge to make room for it.
          const w = length > 0 ? Math.max(length, MIN_BAR) : 0;
          const x = Math.min(at(Math.min(p.from, p.to)), 100 - PAD - w);
          const ahead = p.cents >= 0;
          const ceiling = p.kind === "result" && month.ebitdaIsCeiling;
          const amountClass = p.notEntered ? "fill-ink-3" : p.kind === "result" ? (ahead ? "fill-ahead" : "fill-behind") : "fill-ink";
          return (
            <g key={p.key}>
              {/* The zero line is only drawn beside the bar, so it never runs through a name or an amount. */}
              <line data-zero="" x1={zero} x2={zero} y1={top + BAR_Y - 3} y2={top + BAR_Y + BAR_H + 3} className="stroke-line-strong" strokeWidth={1} />
              <text x={0} y={top + LABEL_Y} fontSize={13} fontWeight={total ? 650 : 400} className={total ? "fill-ink" : "fill-ink-2"}>
                {p.label}
              </text>
              <text x="100%" y={top + LABEL_Y} textAnchor="end" fontSize={13} fontWeight={total ? 650 : 500} className={`num ${amountClass}`}>
                {shown(p)}
              </text>
              {w > 0 ? (
                <rect
                  data-line={p.key}
                  x={`${x.toFixed(2)}%`}
                  y={top + BAR_Y}
                  width={`${w.toFixed(2)}%`}
                  height={BAR_H}
                  rx={3}
                  className={barClassOf(p.kind, ahead, ceiling)}
                  fillOpacity={p.kind === "cost" ? 0.55 : ceiling ? 0.3 : undefined}
                  strokeWidth={ceiling ? 1.5 : undefined}
                  strokeDasharray={ceiling ? "4 3" : undefined}
                />
              ) : null}
            </g>
          );
        })}
      </svg>

      {noRates ? (
        <p className="muted mt-2 text-sm">
          {month.netSalesCents === 0
            ? "No net sales this month, so there is no percentage of net sales to show."
            : "Net sales were below zero this month, so there is no percentage of net sales to show."}
        </p>
      ) : (
        <p className="muted num mt-2 text-sm">
          Profit after variable costs is {profitRate} of net sales; EBITDA is {ebitdaRate}.
        </p>
      )}

      <details className="mt-3 text-sm">
        <summary className="muted w-fit cursor-pointer rounded-md py-1 font-medium hover:text-ink">Show the numbers</summary>
        <div className="mt-2 overflow-auto rounded-xl border border-line">
          <table className="data-table [&_tbody_tr:last-child_th]:border-b-0">
            <caption className="sr-only">
              EBITDA bridge for {monthName(month.month)}
              {month.partial ? ", month to date" : ""}
            </caption>
            <thead>
              <tr>
                <th scope="col">Line</th>
                <th scope="col" className="num">
                  Amount
                </th>
              </tr>
            </thead>
            <tbody>
              {placed.map((p) => {
                const total = p.kind !== "cost";
                const share = p.key === "profitAfterVariableCosts" ? profitRate : p.key === "ebitda" ? ebitdaRate : undefined;
                return (
                  <tr key={p.key} data-line={p.key}>
                    <th scope="row" className={total ? "font-semibold" : "font-normal"}>
                      {p.label}
                      {p.key === "profitAfterVariableCosts" || p.key === "ebitda" ? (
                        <span className="faint block text-xs font-normal">Share of net sales: {share ?? "n/a"}</span>
                      ) : null}
                      {p.key === "costOfGoods" && month.unitsWithoutCost > 0 ? (
                        <span className="faint block text-xs font-normal">{unitsLine(month.unitsWithoutCost)}, so they add nothing here</span>
                      ) : null}
                    </th>
                    <td className={`num ${p.notEntered ? "faint" : total ? "font-semibold" : ""}`}>{shown(p)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
