"use client";

import { useState } from "react";
import type { LedgerView } from "@/lib/actions/ledger";
import type { ActionKind } from "@/lib/actions/types";

type Status = LedgerView["status"];
type Mutation = { name: string; query: string; variables: unknown };

export const KIND_LABEL: Record<ActionKind, string> = {
  metric_target: "Plan target",
  annotation: "Calendar note",
  discount_deactivate: "Turn off a discount",
  landing_page: "Landing page",
};

export const STATUS_LABEL: Record<Status, string> = {
  proposed: "Waiting for approval",
  approved: "Approved",
  running: "Running",
  done: "Done",
  failed: "Failed",
  rejected: "Rejected",
};

const STATUS_STYLE: Record<Status, string> = {
  proposed: "bg-amber-100 text-amber-900",
  approved: "bg-sky-100 text-sky-900",
  running: "bg-sky-100 text-sky-900",
  done: "bg-emerald-100 text-emerald-900",
  failed: "bg-red-100 text-red-900",
  rejected: "bg-neutral-200 text-neutral-700",
};

// Owners are Clerk user ids. Say "you" for the signed-in person and keep the end of anyone else's id.
export function personLabel(id: string | null | undefined, me?: string): string {
  if (!id) return "—";
  if (me && id === me) return "you";
  return id.length > 12 ? `user …${id.slice(-6)}` : id;
}

export function StatusBadge({ status, dryRun }: { status: Status; dryRun?: boolean }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[status]}`}>
      {STATUS_LABEL[status]}
      {dryRun && status === "done" ? " (dry run)" : ""}
    </span>
  );
}

const isMutation = (m: unknown): m is Mutation => Boolean(m) && typeof m === "object" && typeof (m as Mutation).name === "string" && typeof (m as Mutation).query === "string";

// The exact GraphQL a dry run recorded (or, failing that, what the diff says would run).
function mutationsOf(a: LedgerView): Mutation[] {
  const recorded = (a.result as { mutations?: unknown } | null | undefined)?.mutations;
  const list: unknown[] = Array.isArray(recorded) ? recorded : (a.diff.mutations ?? []);
  return list.filter(isMutation);
}

function pretty(value: unknown, max = 4000): string {
  let text: string;
  try {
    text = JSON.stringify(value, null, 2) ?? "null";
  } catch {
    text = "(not shown)";
  }
  return text.length > max ? `${text.slice(0, max)}\n…` : text;
}

function Mutations({ list }: { list: Mutation[] }) {
  return (
    <div className="mt-2 space-y-2">
      {list.map((m, i) => (
        <div key={i} className="rounded border border-neutral-200 bg-white p-2">
          <p className="font-mono text-xs font-medium">{m.name}</p>
          <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-words font-mono text-xs text-neutral-700">{m.query}</pre>
          <p className="mt-1 text-xs text-neutral-500">Variables</p>
          <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-xs text-neutral-700">{pretty(m.variables)}</pre>
        </div>
      ))}
    </div>
  );
}

// A change the agent proposed. Nothing is sent to the store until a Growth Capital admin or partner approves it here, so the
// buttons are shown to them alone; anyone else sees that it is waiting. Everything on the card is text, never HTML.
export function ActionCard({ action, canDecide, me, onChange }: { action: LedgerView; canDecide: boolean; me?: string; onChange?: (next: LedgerView) => void }) {
  const [view, setView] = useState<LedgerView>(action);
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [problem, setProblem] = useState("");

  async function decide(decision: "approve" | "reject") {
    setBusy(decision);
    setProblem("");
    const res = await fetch(`/api/actions/${view.id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ decision }) }).catch(() => null);
    setBusy(null);
    if (res?.ok) {
      const body = (await res.json().catch(() => null)) as { action?: LedgerView } | null;
      if (body?.action) {
        setView(body.action);
        onChange?.(body.action);
        return;
      }
    }
    if (res?.status === 404) return setProblem("This action no longer exists.");
    if (res?.status === 403) return setProblem("Only a Growth Capital admin or partner can decide this.");
    const body = (await res?.json().catch(() => null)) as { message?: unknown } | null | undefined;
    setProblem(typeof body?.message === "string" ? body.message : "Couldn't save that. Try again.");
  }

  const { diff } = view;
  const dryRun = view.dryRun && view.status === "done";
  const preview = !dryRun && diff.mutations && diff.mutations.length > 0 ? diff.mutations : null;

  return (
    <div className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-950">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-sky-800">Proposed change: {KIND_LABEL[view.kind] ?? view.kind}</p>
        <StatusBadge status={view.status} dryRun={view.dryRun} />
      </div>
      <p className="mt-1 font-medium">{view.title}</p>
      <p className="mt-1">{diff.summary}</p>

      {diff.rows && diff.rows.length > 0 ? (
        <table className="mt-2 w-full text-left text-xs">
          <thead className="text-sky-800">
            <tr>
              <th className="py-1 pr-2 font-normal">What</th>
              <th className="py-1 pr-2 font-normal">Now</th>
              <th className="py-1 font-normal">After</th>
            </tr>
          </thead>
          <tbody>
            {diff.rows.map((r, i) => (
              <tr key={i} className="border-t border-sky-100 align-top">
                <td className="py-1 pr-2">{r.label}</td>
                <td className="py-1 pr-2 text-neutral-600">{r.before ?? "—"}</td>
                <td className="py-1 font-medium">{r.after}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      {diff.files && diff.files.length > 0 ? (
        <details className="mt-2 rounded border border-sky-100 bg-white px-2 py-1">
          <summary className="cursor-pointer text-xs font-medium">
            {diff.files.length === 1 ? "1 file" : `${diff.files.length} files`} that would be written
          </summary>
          <div className="mt-1 space-y-2">
            {diff.files.map((f, i) => (
              <div key={i}>
                <p className="font-mono text-xs font-medium">{f.path}</p>
                <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-neutral-50 p-2 font-mono text-xs text-neutral-800">
                  <code>{f.content}</code>
                </pre>
              </div>
            ))}
          </div>
        </details>
      ) : null}

      {diff.notes && diff.notes.length > 0 ? (
        <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-sky-900">
          {diff.notes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      ) : null}

      {preview ? (
        <details className="mt-2 rounded border border-sky-100 bg-white px-2 py-1">
          <summary className="cursor-pointer text-xs font-medium">The GraphQL that would run</summary>
          <Mutations list={preview} />
        </details>
      ) : null}

      <dl className="mt-3 grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
        <div>
          <dt className="inline text-sky-800">Why: </dt>
          <dd className="inline">{view.hypothesis}</dd>
        </div>
        <div>
          <dt className="inline text-sky-800">Metric: </dt>
          <dd className="inline">{view.metric}</dd>
        </div>
        <div>
          <dt className="inline text-sky-800">Check on: </dt>
          <dd className="inline">{view.checkOn}</dd>
        </div>
        <div>
          <dt className="inline text-sky-800">Owner: </dt>
          <dd className="inline">{personLabel(view.owner, me)}</dd>
        </div>
      </dl>

      {view.status === "proposed" ? (
        canDecide ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="button" disabled={busy !== null} onClick={() => decide("approve")} className="rounded-md bg-sky-800 px-2.5 py-1 text-xs font-medium text-white hover:bg-sky-700 disabled:opacity-50">
              {busy === "approve" ? "Approving…" : "Approve"}
            </button>
            <button type="button" disabled={busy !== null} onClick={() => decide("reject")} className="rounded-md border border-sky-300 bg-white px-2.5 py-1 text-xs hover:border-sky-500 disabled:opacity-50">
              {busy === "reject" ? "Rejecting…" : "Reject"}
            </button>
          </div>
        ) : (
          <p className="mt-3 text-xs text-sky-800">Waiting for a Growth Capital admin or partner to approve it.</p>
        )
      ) : null}
      {problem ? (
        <p role="alert" className="mt-2 text-xs text-red-700">
          {problem}
        </p>
      ) : null}

      {view.status === "running" || view.status === "approved" ? <p className="mt-3 text-xs text-sky-800">Approved by {personLabel(view.decidedBy, me)}. Running now.</p> : null}
      {view.status === "rejected" ? <p className="mt-3 text-xs text-neutral-600">Rejected by {personLabel(view.decidedBy, me)}. Nothing was changed.</p> : null}
      {view.status === "failed" ? (
        <p role="alert" className="mt-3 text-xs text-red-700">
          Failed: {view.error ?? "The change did not go through."}
        </p>
      ) : null}
      {view.status === "done" && !dryRun ? (
        <div className="mt-3 text-xs">
          {(view.result as { written?: boolean } | null | undefined)?.written === false ? (
            <div role="status" className="rounded border border-amber-300 bg-amber-50 p-2 text-amber-900">
              <p>Approved by {personLabel(view.decidedBy, me)}, but not written to the theme.</p>
              <p className="mt-1">{String((view.result as { reason?: string }).reason ?? "")}</p>
              <p className="mt-1 break-words font-mono">{String((view.result as { finishByHand?: string }).finishByHand ?? "")}</p>
            </div>
          ) : (
            <p className="text-emerald-700">Done. Approved by {personLabel(view.decidedBy, me)}.</p>
          )}
          {view.result != null ? (
            <details className="mt-1">
              <summary className="cursor-pointer text-sky-800">Result</summary>
              <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded bg-white p-2 font-mono text-neutral-700">{pretty(view.result)}</pre>
            </details>
          ) : null}
        </div>
      ) : null}
      {dryRun ? (
        <div className="mt-3 text-xs">
          <p className="font-medium text-amber-900">Dry run: nothing was sent to Shopify</p>
          <p className="mt-1 text-neutral-600">Approved by {personLabel(view.decidedBy, me)} on a reviewer login. This is the exact change that would have been sent.</p>
          <Mutations list={mutationsOf(view)} />
        </div>
      ) : null}
    </div>
  );
}
