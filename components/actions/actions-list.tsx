"use client";

import { useState } from "react";
import type { LedgerView } from "@/lib/actions/ledger";
import { ActionCard, KIND_LABEL, personLabel, StatusBadge } from "./action-card";

const when = (iso: string, timezone: string) =>
  new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: timezone }).format(new Date(iso));

// The ledger for one brand: the changes waiting for a decision as cards, and every change below with who asked, who decided
// and whether it was a dry run. Titles and notes were written by the model, so they are shown as text only.
export function ActionsList({ actions, canDecide, me, timezone }: { actions: LedgerView[]; canDecide: boolean; me?: string; timezone: string }) {
  const [items, setItems] = useState(actions);
  // The cards stay on screen after a decision, so the result (a dry run's exact change, an error) is read where it was approved.
  const [waiting] = useState(() => actions.filter((a) => a.status === "proposed").map((a) => a.id));
  const update = (next: LedgerView) => setItems((cur) => cur.map((a) => (a.id === next.id ? next : a)));

  if (items.length === 0) {
    return <p className="rounded-lg border border-neutral-200 bg-white p-4 text-sm text-neutral-600">No actions yet. Ask the agent in Chat to propose a change, such as a plan target or a note on the calendar.</p>;
  }

  return (
    <div className="space-y-6">
      {waiting.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-neutral-700">Waiting for a decision</h2>
          {waiting.map((id) => {
            const a = items.find((x) => x.id === id);
            return a ? <ActionCard key={`${id}:${a.status}`} action={a} canDecide={canDecide} me={me} onChange={update} /> : null;
          })}
        </section>
      ) : null}

      <section>
        <h2 className="text-sm font-medium text-neutral-700">All actions</h2>
        <div className="mt-2 overflow-x-auto rounded-lg border border-neutral-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-neutral-200 text-xs text-neutral-500">
              <tr>
                <th className="px-3 py-2 font-normal">Action</th>
                <th className="px-3 py-2 font-normal">Kind</th>
                <th className="px-3 py-2 font-normal">Status</th>
                <th className="px-3 py-2 font-normal">Owner</th>
                <th className="px-3 py-2 font-normal">Approved by</th>
                <th className="px-3 py-2 font-normal">When</th>
                <th className="px-3 py-2 font-normal">Dry run</th>
              </tr>
            </thead>
            <tbody>
              {items.map((a) => (
                <tr key={a.id} className="border-b border-neutral-100 align-top last:border-0">
                  <td className="max-w-xs px-3 py-2">
                    <details>
                      <summary className="cursor-pointer">{a.title}</summary>
                      <div className="mt-2">
                        <ActionCard key={`${a.id}:${a.status}`} action={a} canDecide={canDecide} me={me} onChange={update} />
                      </div>
                    </details>
                  </td>
                  <td className="px-3 py-2 text-neutral-600">{KIND_LABEL[a.kind] ?? a.kind}</td>
                  <td className="px-3 py-2">
                    <StatusBadge status={a.status} dryRun={a.dryRun} />
                  </td>
                  <td className="px-3 py-2 text-neutral-600">{personLabel(a.owner, me)}</td>
                  <td className="px-3 py-2 text-neutral-600">{a.status === "proposed" ? "—" : a.status === "rejected" ? `${personLabel(a.decidedBy, me)} (rejected)` : personLabel(a.decidedBy, me)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-neutral-600">{when(a.decidedAt ?? a.createdAt, timezone)}</td>
                  <td className="px-3 py-2 text-neutral-600">{a.dryRun ? "Yes" : "No"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
