"use client";

import { ChevronRight, ListChecks } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { EmptyState } from "@/components/ui/empty-state";
import type { LedgerView } from "@/lib/actions/ledger";
import { ActionCard, KIND_LABEL, Person, StatusBadge } from "./action-card";

const when = (iso: string, timezone: string) =>
  new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: timezone }).format(new Date(iso));

// The ledger for one brand: the changes waiting for a decision as cards, and every change below with who asked, who decided
// and whether it was a dry run. Titles and notes were written by the model, so they are shown as text only.
export function ActionsList({ actions, canDecide, me, names, timezone }: { actions: LedgerView[]; canDecide: boolean; me?: string; names?: Record<string, string>; timezone: string }) {
  const [items, setItems] = useState(actions);
  // The cards stay on screen after a decision, so the result (a dry run's exact change, an error) is read where it was approved.
  const [waiting] = useState(() => actions.filter((a) => a.status === "proposed").map((a) => a.id));
  const update = (next: LedgerView) => setItems((cur) => cur.map((a) => (a.id === next.id ? next : a)));

  if (items.length === 0) {
    return (
      <EmptyState
        icon={ListChecks}
        title="No actions yet"
        action={
          <Link href="/chat" className="btn btn-secondary">
            Open Chat
          </Link>
        }
      >
        Ask the agent in Chat to propose a change, such as a plan target or a note on the calendar.
      </EmptyState>
    );
  }

  const open = items.filter((a) => a.status === "proposed").length;

  return (
    <div className="space-y-10">
      {waiting.length > 0 ? (
        <section className="space-y-4">
          <div className="flex items-center gap-2.5">
            <h2 className="section-title">Waiting for a decision</h2>
            {open > 0 ? <span className="badge badge-warn num">{open}</span> : null}
          </div>
          {waiting.map((id) => {
            const a = items.find((x) => x.id === id);
            return a ? <ActionCard key={`${id}:${a.status}`} action={a} canDecide={canDecide} me={me} names={names} onChange={update} /> : null;
          })}
        </section>
      ) : null}

      <section className="space-y-4">
        <div className="flex items-baseline gap-2.5">
          <h2 className="section-title">All actions</h2>
          <span className="faint num text-sm">{items.length}</span>
        </div>
        <div className="card overflow-hidden">
          <ul className="divide-y divide-line">
            {items.map((a) => {
              const decided = a.status === "proposed" ? null : a.status === "rejected" ? "Rejected" : "Approved";
              return (
                <li key={a.id}>
                  <details className="group">
                    <summary className="grid cursor-pointer list-none grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-2 px-4 py-3.5 hover:bg-paper/60 sm:grid-cols-[auto_minmax(0,1fr)_auto] [&::-webkit-details-marker]:hidden">
                      <ChevronRight className="mt-1 size-4 shrink-0 text-ink-3 transition-transform group-open:rotate-90" aria-hidden />
                      <div className="min-w-0">
                        <p className="break-words font-medium text-ink">{a.title}</p>
                        <p className="faint mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-sm">
                          <span>{KIND_LABEL[a.kind] ?? a.kind}</span>
                          <span>
                            Owner: <Person id={a.owner} me={me} names={names} />
                          </span>
                          {decided ? (
                            <span>
                              {decided} by <Person id={a.decidedBy} me={me} names={names} />
                            </span>
                          ) : null}
                          <span className="num">{when(a.decidedAt ?? a.createdAt, timezone)}</span>
                        </p>
                      </div>
                      <span className="col-start-2 flex flex-wrap items-center gap-1.5 sm:col-start-3 sm:justify-end">
                        {a.dryRun && a.status !== "done" ? <span className="badge">Dry run</span> : null}
                        <StatusBadge status={a.status} dryRun={a.dryRun} />
                      </span>
                    </summary>
                    <div className="border-t border-line bg-paper/50 p-3 sm:p-4">
                      <ActionCard key={`${a.id}:${a.status}`} action={a} canDecide={canDecide} me={me} names={names} onChange={update} />
                    </div>
                  </details>
                </li>
              );
            })}
          </ul>
        </div>
      </section>
    </div>
  );
}
