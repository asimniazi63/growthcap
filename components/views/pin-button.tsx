"use client";

import { useState } from "react";
import type { ViewComponent, ViewSourceRef } from "@/lib/views/types";

// Pins a view the chat drew. What is sent is the component and the queries behind it, never the numbers: the server runs
// the queries again for the signed-in brand and keeps only those.
export function PinButton({ title, component, sources }: { title: string; component: ViewComponent; sources: ViewSourceRef[] }) {
  const [state, setState] = useState<"idle" | "saving" | "pinned" | "error">("idle");
  const [message, setMessage] = useState("");

  async function pin() {
    setState("saving");
    try {
      const res = await fetch("/api/views", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title, component, sources }) });
      if (res.ok) return setState("pinned");
      const body = (await res.json().catch(() => null)) as { message?: string } | null;
      setMessage(body?.message ?? "Couldn't pin this view.");
      setState("error");
    } catch {
      setMessage("Couldn't reach the server.");
      setState("error");
    }
  }

  if (state === "pinned") return <p className="text-xs text-emerald-700">Pinned. It is on the Pace page and refreshes each time you open it.</p>;
  return (
    <div className="flex items-center gap-2">
      <button type="button" onClick={pin} disabled={state === "saving"} className="rounded-md border border-neutral-300 bg-white px-2.5 py-1 text-xs hover:border-neutral-500 disabled:opacity-50">
        {state === "saving" ? "Pinning…" : "Pin to Pace"}
      </button>
      {state === "error" ? <span role="alert" className="text-xs text-red-700">{message}</span> : null}
    </div>
  );
}
