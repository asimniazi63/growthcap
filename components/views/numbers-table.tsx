import { ChevronRight } from "lucide-react";

// The text alternative behind a chart: "Show the numbers" opens a table of what was drawn. The first column is text and the
// rest are figures. A chart with more than one kind of figure gives several small tables. Each table scrolls inside its own box.
export interface NumbersSection {
  head: string[];
  rows: string[][];
  caption?: string;
}

export function NumbersTable({ sections }: { sections: NumbersSection[] }) {
  return (
    <details className="group mt-4">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded-md text-[13px] font-medium text-brand-strong marker:content-none [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-4 transition-transform group-open:rotate-90" aria-hidden />
        Show the numbers
      </summary>
      <div className="mt-2 space-y-3">
        {sections.map((s, n) => (
          <div key={n}>
            {s.caption ? <p className="muted mb-1.5 text-[13px]">{s.caption}</p> : null}
            <div className="max-h-72 overflow-auto rounded-xl border border-line">
              <table className="data-table" aria-label={s.caption ?? s.head[0]}>
                <thead>
                  <tr>
                    {s.head.map((h, i) => (
                      <th key={i} scope="col" className={i > 0 ? "num" : undefined}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {s.rows.map((r, i) => (
                    <tr key={i}>
                      {r.map((c, j) => (j === 0 ? <th key={j} scope="row" className={`py-[0.7rem] text-[0.9rem] font-normal text-ink ${i === s.rows.length - 1 ? "border-b-0" : ""}`}>{c}</th> : <td key={j} className="num">{c}</td>))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>
    </details>
  );
}
