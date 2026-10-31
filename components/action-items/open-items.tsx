import { CalendarClock, ListChecks, Quote, UserRound } from "lucide-react";
import { MarkDoneButton } from "@/components/action-items/mark-done-button";
import { EmptyState } from "@/components/ui/empty-state";
import { getDb } from "@/lib/db/client";
import { isOverdue, listOpenItems, todayFor } from "@/lib/action-items/store";
import { canManageNotes } from "@/lib/call-notes/access";
import type { TenantContext } from "@/lib/tenancy/context";

const dayLabel = (ymd: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${ymd}T00:00:00Z`));

// The brand's open action items from call notes: owner, due date (overdue in red text), the sentence it came from and a Mark done
// button. Server component: it loads its own data for the signed-in brand and renders nothing for a client viewer.
// Mount it on /pace: <OpenItems ctx={ctx} />. Everything shown came from note text, so it is only ever rendered as text.
export async function OpenItems({ ctx }: { ctx: TenantContext }) {
  if (!canManageNotes(ctx)) return null;
  const items = await listOpenItems(getDb(), ctx);
  const today = todayFor(ctx);
  const overdue = items.filter((i) => isOverdue(i, today)).length;

  return (
    <section aria-label="Open action items" className="card card-pad">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="section-title">Open action items</h2>
        {items.length > 0 ? (
          <div className="flex items-center gap-1.5">
            <span className="badge">
              <span className="num">{items.length}</span> open
            </span>
            {overdue > 0 ? (
              <span className="badge badge-behind">
                <span className="num">{overdue}</span> overdue
              </span>
            ) : null}
          </div>
        ) : null}
      </header>

      {items.length === 0 ? (
        <div className="mt-3">
          <EmptyState icon={ListChecks} title="No open action items">
            Follow-ups from a call note show up here once you confirm them on the Plan page.
          </EmptyState>
        </div>
      ) : (
        <ul className="mt-3 divide-y divide-line">
          {items.map((item) => {
            const late = isOverdue(item, today);
            return (
              <li key={item.id} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0 flex-1">
                  <p className="break-words text-sm font-medium text-ink">{item.title}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-4 gap-y-0.5 text-sm text-ink-2">
                    <span className="inline-flex items-center gap-1.5">
                      <UserRound className="size-3.5 text-ink-3" aria-hidden />
                      {item.owner}
                    </span>
                    <span className={`inline-flex items-center gap-1.5 ${late ? "font-medium text-behind" : ""}`}>
                      <CalendarClock className={`size-3.5 ${late ? "" : "text-ink-3"}`} aria-hidden />
                      {item.dueOn ? <span className="num">{late ? `Overdue, was due ${dayLabel(item.dueOn)}` : `Due ${dayLabel(item.dueOn)}`}</span> : "No due date"}
                    </span>
                  </p>
                  {item.quote ? (
                    <p className="mt-1 flex items-start gap-1.5 text-sm text-ink-3">
                      <Quote className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                      <span className="min-w-0">
                        {item.quote}
                        {item.source ? <span className="whitespace-nowrap"> ({item.source})</span> : null}
                      </span>
                    </p>
                  ) : null}
                </div>
                <MarkDoneButton id={item.id} />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
