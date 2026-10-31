"use client";

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

  return (
    <div className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-950">
      <p className="text-xs font-medium uppercase tracking-wide text-sky-800">Note for this brand</p>
      <p className="mt-1">{text}</p>
      {state === "proposed" ? (
        canDecide ? (
          <div className="mt-2 flex items-center gap-2">
            <button type="button" disabled={busy} onClick={() => decide("confirm")} className="rounded-md bg-sky-800 px-2.5 py-1 text-xs font-medium text-white hover:bg-sky-700 disabled:opacity-50">
              Confirm
            </button>
            <button type="button" disabled={busy} onClick={() => decide("dismiss")} className="rounded-md border border-sky-300 bg-white px-2.5 py-1 text-xs hover:border-sky-500 disabled:opacity-50">
              Dismiss
            </button>
            {failed ? <span role="alert" className="text-xs text-red-700">Couldn&apos;t save that. Try again.</span> : null}
          </div>
        ) : (
          <p className="mt-1 text-xs text-sky-800">Waiting for a Growth Capital admin or partner to confirm it.</p>
        )
      ) : state === "confirmed" ? (
        <p className="mt-1 text-xs text-emerald-700">Confirmed. It will be used in answers for this brand.</p>
      ) : state === "gone" ? (
        <p className="mt-1 text-xs text-neutral-600">This note has already been decided or removed. The notes list shows what is in use.</p>
      ) : (
        <p className="mt-1 text-xs text-neutral-600">Dismissed.</p>
      )}
    </div>
  );
}
