"use client";

import { ChevronDown, NotebookPen } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Role } from "@/lib/tenancy/context";
import { MemoryCard } from "./memory-card";

export interface NoteItem {
  id: string;
  text: string;
  status: "proposed" | "confirmed";
}

// The notes the agent uses for this brand. A Growth Capital admin or partner confirms, dismisses and removes them; a
// client viewer can read the confirmed ones, so nothing shapes their answers out of sight.
export function NotesPanel({ notes, role }: { notes: NoteItem[]; role: Role }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const canManage = role === "gc_admin" || role === "gc_partner";
  const visible = canManage ? notes : notes.filter((n) => n.status === "confirmed");
  if (visible.length === 0) return null;

  async function remove(id: string) {
    setBusy(id);
    const res = await fetch(`/api/memories/${id}`, { method: "DELETE" }).catch(() => null);
    setBusy(null);
    if (res?.ok) router.refresh();
  }

  return (
    <details className="card group text-sm" open={visible.some((n) => n.status === "proposed")}>
      <summary className="flex cursor-pointer list-none items-center gap-2.5 rounded-2xl px-5 py-4 font-medium [&::-webkit-details-marker]:hidden">
        <NotebookPen className="size-4 text-brand-strong" aria-hidden />
        Notes for this brand
        <span className="badge num">{visible.length}</span>
        <ChevronDown className="ml-auto size-4 text-ink-3 transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <div className="border-t border-line px-5 py-4">
        <p className="muted max-w-[70ch] text-xs">Confirmed notes are given to the assistant with every question. It can propose a note, but it is used only after a Growth Capital admin or partner confirms it.</p>
        <ul className="mt-3 space-y-3">
          {visible.map((n) =>
            n.status === "proposed" ? (
              <li key={n.id}>
                <MemoryCard id={n.id} text={n.text} status="proposed" canDecide={canManage} />
              </li>
            ) : (
              <li key={n.id} className="flex items-start justify-between gap-3 rounded-xl bg-paper px-4 py-3">
                <span className="min-w-0 leading-6">{n.text}</span>
                {canManage ? (
                  <button type="button" disabled={busy === n.id} onClick={() => remove(n.id)} className="btn btn-ghost btn-sm shrink-0">
                    {busy === n.id ? "Removing…" : "Remove"}
                  </button>
                ) : null}
              </li>
            ),
          )}
        </ul>
      </div>
    </details>
  );
}
