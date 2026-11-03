import { ChevronDown } from "lucide-react";
import { ViewRenderer } from "@/components/views/view-renderer";
import { Skeleton } from "@/components/ui/skeleton";
import type { NumbersItem } from "@/lib/playbooks/numbers";

// The live numbers above a playbook's write-up (layer B of the Playbooks page): the views the chat can draw (a KPI row, a bar, a line,
// the cohort grid, the lift and dip), built by the server from the synced store data when the page opens, for the same period as the
// write-up. They are not model text and they are not the write-up's own figures: each carries its period, its as-of time and the id of
// the query behind it, so a figure can be traced. The compact ones are drawn open; the three big charts sit behind a closed Show row
// (the browser's own <details>), so the page stays calm. A view that cannot be drawn says so and leaves the others standing.

export function NumbersPanel({ items, currency }: { items: NumbersItem[]; currency: string }) {
  if (items.length === 0) return null;
  const drawn = items.some((i) => i.view.ok);
  return (
    <section aria-label="Live numbers" className="mt-5">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-3">Live numbers</h3>
        <p className="muted text-xs">Read from the synced store data when this page opened, for the same period as the write-up, not taken from the write-up. They can differ slightly if orders arrived after the run.</p>
      </div>
      {drawn ? (
        <div className="grid items-start gap-4 lg:grid-cols-2">
          {items.map((i) => {
            if (!i.view.ok) {
              return (
                <p key={i.key} role="note" className="muted rounded-xl border border-dashed border-line px-4 py-3 text-sm lg:col-span-2">
                  {`“${i.title}” couldn't be drawn from the synced data just now.`}
                </p>
              );
            }
            const view = <ViewRenderer data={i.view.data} title={i.title} currency={currency} />;
            if (i.fold) {
              return (
                <details key={i.key} className="group min-w-0 lg:col-span-2">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-2xl border border-line bg-paper-2 px-5 py-3 text-sm font-medium text-ink hover:bg-surface sm:px-6 [&::-webkit-details-marker]:hidden">
                    {i.fold}
                    <ChevronDown className="size-4 shrink-0 text-ink-3 transition-transform group-open:rotate-180" aria-hidden />
                  </summary>
                  <div className="mt-3">{view}</div>
                </details>
              );
            }
            return (
              <div key={i.key} className={i.wide ? "min-w-0 lg:col-span-2" : "min-w-0"}>
                {view}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="muted text-sm">No live numbers for this period: the synced data has none, or the queries failed. Reload the page to try again.</p>
      )}
    </section>
  );
}

// Where the numbers will land while the server reads them, so the write-up below is not pushed down when they arrive.
export function NumbersSkeleton() {
  return (
    <div role="status" className="mt-5">
      <span className="sr-only">Loading live numbers</span>
      <div aria-hidden className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-56 rounded-2xl" />
        <Skeleton className="h-56 rounded-2xl" />
      </div>
    </div>
  );
}
