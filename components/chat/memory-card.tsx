"use client";

import { NotebookPen } from "lucide-react";
import { useState } from "react";

export type MemoryCardState = "proposed" | "confirmed" | "dismissed";
type Shown = MemoryCardState | "gone";

// A note the agent proposed. It is used in answers only after a Growth Capital admin or partner confirms it, so the
// buttons are shown to them alone; anyone else sees that it is waiting.
export function MemoryCard({ id, text, status, canDecide }: { id: string; text: string; status: MemoryCardState; canDecide: boolean }) {
  const [state, setState] = useState<Shown>(status);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function decide(action: "confirm" | "dismiss") {
    setBusy(true);
    setFailed(false);
    const res = await fetch(`/api/memories/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) }).catch(() => null);
    setBusy(false);
    if (res?.ok) setState(action === "confirm" ? "confirmed" : "dismissed");
    else if (res?.status === 404) setState("gone"); // decided or removed since this conversation was saved
    else setFailed(true);
  }

  const badge =
    state === "proposed" ? (
      <span className="badge badge-warn">Waiting for confirmation</span>
    ) : state === "confirmed" ? (
      <span className="badge badge-ahead">Confirmed</span>
    ) : state === "gone" ? (
      <span className="badge">Already decided</span>
    ) : (
      <span className="badge">Dismissed</span>
    );

  return (
    <div className={`rounded-xl border bg-surface p-4 text-sm ${state === "proposed" ? "border-warn/30" : "border-line"}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 font-semibold">
          <NotebookPen className="size-4 text-brand-strong" aria-hidden />
          Note for this brand
        </p>
        {badge}
      </div>
      <p className="mt-2 leading-6">{text}</p>
      {state === "proposed" ? (
        canDecide ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="button" disabled={busy} onClick={() => decide("confirm")} className="btn btn-primary btn-sm">
              Confirm
            </button>
            <button type="button" disabled={busy} onClick={() => decide("dismiss")} className="btn btn-secondary btn-sm">
              Dismiss
            </button>
            {failed ? <span role="alert" className="text-xs text-behind">Couldn&apos;t save that. Try again.</span> : null}
          </div>
        ) : (
          <p className="muted mt-2 text-xs">Waiting for a Growth Capital admin or partner to confirm it.</p>
        )
      ) : state === "confirmed" ? (
        <p className="muted mt-2 text-xs">It will be used in answers for this brand.</p>
      ) : state === "gone" ? (
        <p className="muted mt-2 text-xs">This note has already been decided or removed. The notes list shows what is in use.</p>
      ) : null}
    </div>
  );
}
