"use client";

import { Check, LoaderCircle, Pin } from "lucide-react";
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

  if (state === "pinned") {
    return (
      <p className="flex items-center gap-1.5 text-[13px] font-medium text-ahead">
        <Check className="size-4 shrink-0" aria-hidden />
        Pinned. It is on the Pace page and refreshes each time you open it.
      </p>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" onClick={pin} disabled={state === "saving"} className="btn btn-ghost btn-sm">
        {state === "saving" ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Pin className="size-4" aria-hidden />}
        {state === "saving" ? "Pinning…" : "Pin to Pace"}
      </button>
      {state === "error" ? <span role="alert" className="text-[13px] font-medium text-behind">{message}</span> : null}
    </div>
  );
}
