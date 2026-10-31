"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { METRICS } from "@/lib/metrics/registry";
import { formatValue, monthName } from "@/lib/pace/format";
import type { DocumentDetail, DocumentSummary } from "@/lib/plan-in/store";

const STATUS: Record<DocumentSummary["status"], { text: string; tone: string }> = {
  uploaded: { text: "Not read yet", tone: "bg-amber-50 text-amber-800" },
  read: { text: "Waiting for review", tone: "bg-sky-50 text-sky-800" },
  confirmed: { text: "Confirmed", tone: "bg-emerald-50 text-emerald-800" },
  discarded: { text: "Discarded", tone: "bg-neutral-100 text-neutral-600" },
};

const isDetail = (d: DocumentSummary | DocumentDetail): d is DocumentDetail => "changes" in d;
const day = (iso: string) => iso.slice(0, 10);

function ChangesTable({ doc, currency }: { doc: DocumentDetail; currency: string }) {
  const open = doc.status === "read";
  return (
    <div className="overflow-x-auto">
      <table className="mt-3 w-full text-sm">
        <thead className="text-left text-neutral-500">
          <tr>
            <th className="py-1 pr-3 font-normal">Month</th>
            <th className="py-1 pr-3 font-normal">Metric</th>
            {open ? <th className="py-1 pr-3 font-normal">Now</th> : null}
            <th className="py-1 pr-3 font-normal">{open ? "Proposed" : "Target"}</th>
            <th className="py-1 font-normal">From the document</th>
          </tr>
        </thead>
        <tbody>
          {doc.changes.map((c) => (
            <tr key={`${c.month}|${c.metric}`} className="border-t border-neutral-100 align-top">
              <td className="py-1.5 pr-3 whitespace-nowrap">{monthName(c.month)}</td>
              <td className="py-1.5 pr-3">{METRICS[c.metric].label}</td>
              {open ? <td className="py-1.5 pr-3 whitespace-nowrap text-neutral-600">{c.current === null ? "no target" : formatValue(c.metric, c.current, currency)}</td> : null}
              <td className="py-1.5 pr-3 whitespace-nowrap font-medium">
                {formatValue(c.metric, c.proposed, currency)}
                {open && c.current === c.proposed ? <span className="ml-1 font-normal text-neutral-500">(no change)</span> : null}
              </td>
              <td className="py-1.5 text-neutral-600">
                {c.sentence} <span className="whitespace-nowrap text-neutral-500">(page {c.page})</span>
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
    <div className="mt-3">
      {doc.changes.length > 0 ? <ChangesTable doc={doc} currency={currency} /> : <p className="text-sm text-neutral-600">No targets that the plan can hold were found in this document.</p>}
      {unapplied.length > 0 ? (
        <div className="mt-4">
          <h4 className="text-sm font-medium">Found, but not applied</h4>
          <ul className="mt-1 space-y-1 text-sm text-neutral-700">
            {unapplied.map((u, i) => (
              <li key={i}>
                {u.sentence} <span className="text-neutral-500">(page {u.page})</span>: {u.reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {unverified.length > 0 ? (
        <details className="mt-3 text-xs text-neutral-500">
          <summary className="cursor-pointer">
            {unverified.length} statement{unverified.length === 1 ? "" : "s"} ignored: the quote was not found on the page
          </summary>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
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
export function DocumentCard({ doc, currency, canDecide }: { doc: DocumentSummary | DocumentDetail; currency: string; canDecide: boolean }) {
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

  return (
    <article className="rounded-lg border border-neutral-200 bg-white p-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-medium">{doc.label}</h3>
          <p className="text-xs text-neutral-500">
            {doc.kind === "sow" ? "SOW" : "Plan sheet"}, {doc.pageCount} page{doc.pageCount === 1 ? "" : "s"}, uploaded {day(doc.createdAt)}
          </p>
        </div>
        <span className={`rounded-full px-2.5 py-0.5 text-xs ${status.tone}`}>{status.text}</span>
      </header>

      {detail && (detail.status === "read" || detail.status === "confirmed") ? <Proposal doc={detail} currency={currency} /> : null}
      {doc.status === "confirmed" ? <p className="mt-3 text-xs text-emerald-700">This is now the active plan. The earlier plan is kept, inactive.</p> : null}
      {!detail && doc.status === "confirmed" && doc.targetCount !== null ? <p className="mt-2 text-sm text-neutral-600">{doc.targetCount} targets were applied.</p> : null}

      {canDecide && (doc.status === "read" || doc.status === "uploaded") ? (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {doc.status === "read" ? (
            <button type="button" disabled={busy || !detail || detail.changes.length === 0} onClick={() => act("confirm")} className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50">
              Confirm as the active plan
            </button>
          ) : (
            <button type="button" disabled={busy} onClick={() => act("read")} className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50">
              {busy ? "Reading..." : "Read it again"}
            </button>
          )}
          <button type="button" disabled={busy} onClick={() => act("discard")} className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm hover:border-neutral-500 disabled:opacity-50">
            Discard
          </button>
          {doc.status === "read" ? <span className="text-xs text-neutral-500">Confirming replaces the plan that Pace and the agent use. The current plan is kept.</span> : null}
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="mt-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}
    </article>
  );
}
