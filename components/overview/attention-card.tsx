import Link from "next/link";
import type { AttentionItem, Severity } from "@/lib/overview/attention";

const STRIPE: Record<Severity, { border: string; fill: string; hint: string }> = {
  behind: { border: "border-l-behind", fill: "bg-behind", hint: "Needs action. " },
  warn: { border: "border-l-warn", fill: "bg-warn", hint: "Worth a look. " },
  info: { border: "border-l-brand", fill: "bg-brand", hint: "Good news. " },
};

// What the numbers say needs a look, worked out in code from this month's plan gaps and the stock cover. Product names are
// store text, so everything here is rendered as text.
export function AttentionCard({ items, note }: { items: AttentionItem[]; note?: string }) {
  return (
    <section className="card card-pad" aria-labelledby="ov-attention">
      <div className="mb-1 flex items-center justify-between gap-2.5">
        <h2 id="ov-attention" className="section-title">
          Needs attention
        </h2>
        <span className="faint text-[0.8125rem]">From the latest sync</span>
      </div>
      {items.length === 0 ? (
        <p className="muted py-3 text-sm">Nothing to flag right now.</p>
      ) : (
        <ul>
          {items.map((it) => {
            const s = STRIPE[it.severity];
            return (
              <li key={it.key} className={`mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-3 rounded-xl border-y border-r border-l-4 border-y-line border-r-line bg-paper py-3 pl-4 pr-3.5 ${s.border}`}>
                <div className="min-w-0 flex-1 basis-56">
                  <p className="break-words text-[0.9375rem] font-medium leading-snug text-ink">
                    <span className="sr-only">{s.hint}</span>
                    {it.title}
                  </p>
                  <p className="faint mt-0.5 break-words text-[0.8125rem]">{it.detail}</p>
                </div>
                {it.cover !== undefined ? (
                  <div className="h-1.5 w-28 shrink-0 overflow-hidden rounded-full bg-paper-2" aria-hidden>
                    <div className={`h-full rounded-full ${s.fill}`} style={{ width: `${Math.round(it.cover * 100)}%` }} />
                  </div>
                ) : null}
                <Link href={`/chat?q=${encodeURIComponent(it.question)}`} className="btn btn-secondary btn-sm shrink-0">
                  {it.cta}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {note ? <p className="faint mt-3 text-xs">{note}</p> : null}
    </section>
  );
}
