import type { SegmentCustomer } from "@/lib/segments/definitions";
import { count, intensity, rfmCounts } from "./format";

// How much of the brand colour each level mixes into the card colour. The strongest is capped so the cell's text keeps at least 4.5:1
// contrast in every colour scheme, light and dark. The colours come from the tokens (--color-brand, --color-surface), never a literal.
const FILL_PERCENT = [0, 10, 20, 30, 40] as const;
const fill = (level: number) => (level === 0 ? undefined : `color-mix(in oklab, var(--color-brand) ${FILL_PERCENT[level]}%, var(--color-surface))`);

const SCORES = [1, 2, 3, 4, 5] as const;

// Every customer in the brand, by recency score (rows, 5 = bought most recently) and frequency score (columns, 5 = most orders).
// Each cell prints its count and has the same words for a screen reader, so the shade is a hint and never the only signal.
export function RfmGrid({ customers }: { customers: SegmentCustomer[] }) {
  const grid = rfmCounts(customers);
  const max = Math.max(0, ...grid.flat());
  return (
    <div>
      <div className="overflow-x-auto">
        <table className="mx-auto w-full max-w-xl border-separate border-spacing-1 text-center">
          <caption className="sr-only">
            Customers by recency score (rows, 5 is the most recent buyers) and frequency score (columns, 5 is the most orders). Each cell is a number of customers.
          </caption>
          <thead>
            <tr>
              <td />
              {SCORES.map((f) => (
                <th key={f} scope="col" className="faint pb-1 text-xs font-medium">
                  <span aria-hidden>F{f}</span>
                  <span className="sr-only">Frequency {f}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.map((row, i) => {
              const r = 5 - i;
              return (
                <tr key={r}>
                  <th scope="row" className="faint pr-1 text-xs font-medium">
                    <span aria-hidden>R{r}</span>
                    <span className="sr-only">Recency {r}</span>
                  </th>
                  {row.map((n, j) => {
                    const level = intensity(n, max);
                    return (
                      <td key={j} style={{ backgroundColor: fill(level) }} className={`num rounded-lg border px-1 py-3 text-sm sm:py-4 ${level === 0 ? "border-line border-dashed text-ink-3" : "border-transparent font-semibold text-ink"}`}>
                        <span aria-hidden>{count(n)}</span>
                        <span className="sr-only">
                          Recency {r}, frequency {j + 1}: {count(n)} {n === 1 ? "customer" : "customers"}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="faint mt-3 text-center text-xs">
        R is the recency score (R5 bought most recently) and F the frequency score (F5 ordered most often). A darker cell has more customers; an empty cell has a dashed outline.
      </p>
    </div>
  );
}
