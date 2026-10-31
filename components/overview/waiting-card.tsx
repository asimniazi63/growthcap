"use client";

import { Check, CheckCircle2, FileCode } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { KIND_ICON, KIND_LABEL } from "@/components/actions/action-card";
import type { LedgerView } from "@/lib/actions/ledger";
import type { ActionKind } from "@/lib/actions/types";
import type { PendingRow } from "@/lib/overview/data";
import { ApproveInline } from "./approve-inline";
import { RefreshNow } from "./refresh-now";

// The newest changes waiting for a decision, each with an Approve button. Titles were written by the model, so they are text.
export function WaitingCard({ rows, total }: { rows: PendingRow[]; total: number }) {
  const [approved, setApproved] = useState<ReadonlySet<string>>(new Set());
  const mark = (a: LedgerView) => setApproved((cur) => new Set(cur).add(a.id));
  // Until the page re-reads its data, rows approved here are still in `rows` and `total`.
  const open = total - rows.filter((r) => approved.has(r.id)).length;

  return (
    <section className="card card-pad" aria-labelledby="ov-waiting">
      {/* Read the page again after each approval so the sidebar count updates. It lives here, not in the button, because the button is replaced by "Approved" and would unmount first. */}
      {approved.size > 0 ? <RefreshNow key={approved.size} /> : null}
      <div className="mb-3 flex items-center justify-between gap-2.5">
        <h2 id="ov-waiting" className="section-title">
          Waiting for you
        </h2>
        {open > 0 ? <span className="badge badge-warn num">{open} to approve</span> : <span className="badge badge-ahead">All clear</span>}
      </div>

      {rows.length === 0 ? (
        <p className="muted flex items-center gap-2 py-2 text-sm">
          <CheckCircle2 className="size-4 shrink-0 text-ahead" aria-hidden />
          Nothing is waiting for approval.
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {rows.map((r) => {
            const Icon = KIND_ICON[r.kind as ActionKind] ?? FileCode;
            const done = approved.has(r.id);
            return (
              <li key={r.id} className={`flex items-center gap-3 py-3 transition-opacity ${done ? "opacity-60" : ""}`}>
                <span className="grid size-[34px] shrink-0 place-items-center rounded-full bg-brand-tint text-brand-strong">
                  <Icon className="size-4" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="break-words text-sm font-medium leading-snug text-ink">{r.title}</p>
                  <p className="faint mt-0.5 text-xs">
                    {KIND_LABEL[r.kind as ActionKind] ?? r.kind}
                    {r.proposed ? ` · Proposed ${r.proposed}` : ""}
                  </p>
                </div>
                {done ? (
                  <span className="badge badge-ahead shrink-0">
                    <Check className="size-3" aria-hidden />
                    Approved
                  </span>
                ) : (
                  <ApproveInline id={r.id} title={r.title} onApproved={mark} />
                )}
              </li>
            );
          })}
        </ul>
      )}

      <Link href="/actions" className="btn btn-secondary btn-sm mt-3">
        Open all actions
      </Link>
    </section>
  );
}
