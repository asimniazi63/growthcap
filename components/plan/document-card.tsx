"use client";

import { AlertTriangle, Check, ChevronRight, FileSpreadsheet, FileText, Loader2, Quote } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { METRICS } from "@/lib/metrics/registry";
import { formatValue, monthName } from "@/lib/pace/format";
import type { DocumentDetail, DocumentSummary } from "@/lib/plan-in/store";

const STATUS: Record<DocumentSummary["status"], { text: string; tone: string }> = {
  uploaded: { text: "Not read yet", tone: "badge-warn" },
  read: { text: "Waiting for review", tone: "badge-brand" },
  confirmed: { text: "Confirmed", tone: "badge-ahead" },
  discarded: { text: "Discarded", tone: "" },
};

const isDetail = (d: DocumentSummary | DocumentDetail): d is DocumentDetail => "changes" in d;
const day = (iso: string) => iso.slice(0, 10);

function ChangesTable({ doc, currency }: { doc: DocumentDetail; currency: string }) {
  const open = doc.status === "read";
  return (
    <div className="mt-4 overflow-x-auto rounded-xl border border-line">
      <table className="data-table min-w-[34rem]">
        <thead>
          <tr>
            <th>Month</th>
            <th>Metric</th>
            {open ? <th className="num">Now</th> : null}
            <th className="num">{open ? "Proposed" : "Target"}</th>
            <th>From the document</th>
          </tr>
        </thead>
        <tbody>
          {doc.changes.map((c) => (
            <tr key={`${c.month}|${c.metric}`}>
              <td className="whitespace-nowrap">{monthName(c.month)}</td>
              <td>{METRICS[c.metric].label}</td>
              {open ? <td className="num whitespace-nowrap text-ink-2">{c.current === null ? "no target" : formatValue(c.metric, c.current, currency)}</td> : null}
              <td className="num whitespace-nowrap font-medium">
                {formatValue(c.metric, c.proposed, currency)}
                {open && c.current === c.proposed ? <span className="ml-1 font-normal text-ink-3">(no change)</span> : null}
              </td>
              <td className="text-ink-2">
                <span className="flex items-start gap-1.5">
                  <Quote className="mt-0.5 size-3.5 shrink-0 text-ink-3" aria-hidden />
                  <span className="min-w-0">
                    {c.sentence} <span className="whitespace-nowrap text-ink-3">(page {c.page})</span>
                  </span>
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Proposal({ doc, currency }: { doc: DocumentDetail; currency: string }) {
  const unapplied = doc.proposal?.unapplied ?? [];
  const unverified = doc.proposal?.unverified ?? [];
  return (
    <div>
      {doc.changes.length > 0 ? <ChangesTable doc={doc} currency={currency} /> : <p className="muted mt-4 text-sm">No targets that the plan can hold were found in this document.</p>}
      {unapplied.length > 0 ? (
        <div className="mt-4 rounded-xl border border-warn/25 bg-warn-tint/60 px-3.5 py-3">
          <h4 className="flex items-center gap-2 text-sm font-medium text-warn">
            <AlertTriangle className="size-4 shrink-0" aria-hidden />
            Found, but not applied
          </h4>
          <ul className="mt-1.5 space-y-1.5 text-sm text-ink-2">
            {unapplied.map((u, i) => (
              <li key={i}>
                {u.sentence} <span className="text-ink-3">(page {u.page})</span>: {u.reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {unverified.length > 0 ? (
        <details className="group mt-3 text-sm text-ink-3">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 [&::-webkit-details-marker]:hidden">
            <ChevronRight className="size-4 shrink-0 transition-transform group-open:rotate-90" aria-hidden />
            {unverified.length} statement{unverified.length === 1 ? "" : "s"} ignored: the quote was not found on the page
          </summary>
          <ul className="mt-1.5 list-disc space-y-0.5 pl-9">
            {unverified.map((u, i) => (
              <li key={i}>
                {u.sentence} (page {u.page})
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

// One uploaded document. While it waits for review it shows the targets as changes against the active plan, with the
// sentence and page each came from; everything shown is text from the document, so it is only ever rendered as text.
// `active` is set for a confirmed document: true when it is the plan in use, false when a newer one replaced it.
export function DocumentCard({ doc, currency, canDecide, active }: { doc: DocumentSummary | DocumentDetail; currency: string; canDecide: boolean; active?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const status = STATUS[doc.status];
  const detail = isDetail(doc) ? doc : null;

  async function act(action: "confirm" | "discard" | "read") {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/documents/${doc.id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) }).catch(() => null);
    if (res?.ok) {
      router.refresh();
    } else {
      const body = (await res?.json().catch(() => null)) as { message?: string } | null;
      setError(res?.status === 404 ? "That document was already decided." : (body?.message ?? "That didn't work. Try again."));
      if (res?.status === 404) router.refresh();
    }
    setBusy(false);
  }

  const KindIcon = doc.kind === "sow" ? FileText : FileSpreadsheet;
  const badge = doc.status === "confirmed" && active === true ? { text: "Active", tone: "badge-ahead" } : doc.status === "confirmed" && active === false ? { text: "Confirmed", tone: "" } : status;
  const showActions = canDecide && (doc.status === "read" || doc.status === "uploaded");

  return (
    <article className="card overflow-hidden">
      <div className="card-pad">
        <header className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
          <div className="flex min-w-0 items-start gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-brand-tint text-brand-strong">
              <KindIcon className="size-[18px]" aria-hidden />
            </span>
            <div className="min-w-0">
              <h3 className="break-words font-display text-[1.0625rem] font-semibold leading-snug text-ink">{doc.label}</h3>
              <p className="faint mt-0.5 text-sm">
                <span className="num">
                  {doc.pageCount} page{doc.pageCount === 1 ? "" : "s"}
                </span>
                , uploaded <span className="num">{day(doc.createdAt)}</span>
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="badge">{doc.kind === "sow" ? "SOW" : "Plan sheet"}</span>
            <span className={`badge ${badge.tone}`}>{badge.text}</span>
          </div>
        </header>

        {detail && (detail.status === "read" || detail.status === "confirmed") ? <Proposal doc={detail} currency={currency} /> : null}
        {doc.status === "confirmed" && active !== false ? (
          <p className="mt-4 flex items-start gap-2 text-sm text-ahead">
            <Check className="mt-0.5 size-4 shrink-0" aria-hidden />
            This is now the active plan. The earlier plan is kept, inactive.
          </p>
        ) : null}
        {doc.status === "confirmed" && active === false ? <p className="muted mt-4 text-sm">A newer plan has replaced this one. It is kept for the record.</p> : null}
        {!detail && doc.status === "confirmed" && doc.targetCount !== null ? <p className="muted mt-2 text-sm">{doc.targetCount} targets were applied.</p> : null}
      </div>

      {showActions ? (
        <footer className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line bg-paper/70 px-5 py-3">
          {doc.status === "read" ? (
            <button type="button" disabled={busy || !detail || detail.changes.length === 0} onClick={() => act("confirm")} className="btn btn-primary btn-sm">
              {busy ? <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden /> : <Check className="size-4" aria-hidden />}
              Confirm as the active plan
            </button>
          ) : (
            <button type="button" disabled={busy} onClick={() => act("read")} className="btn btn-primary btn-sm">
              {busy ? <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden /> : null}
              {busy ? "Reading..." : "Read it again"}
            </button>
          )}
          <button type="button" disabled={busy} onClick={() => act("discard")} className="btn btn-ghost btn-sm">
            Discard
          </button>
          {doc.status === "read" ? <span className="faint min-w-[12rem] flex-1 text-sm">Confirming replaces the plan that Pace and the agent use. The current plan is kept.</span> : null}
        </footer>
      ) : null}
      {error ? (
        <p role="alert" className="flex items-start gap-2 border-t border-line px-5 py-3 text-sm text-behind">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          {error}
        </p>
      ) : null}
    </article>
  );
}
