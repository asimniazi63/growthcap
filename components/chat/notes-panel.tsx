"use client";

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
    <details className="rounded-lg border border-neutral-200 bg-white px-4 py-3 text-sm" open={visible.some((n) => n.status === "proposed")}>
      <summary className="cursor-pointer font-medium">Notes for this brand</summary>
      <p className="mt-2 text-xs text-neutral-500">Confirmed notes are given to the assistant with every question. It can propose a note, but it is used only after a Growth Capital admin or partner confirms it.</p>
      <ul className="mt-3 space-y-2">
        {visible.map((n) =>
          n.status === "proposed" ? (
            <li key={n.id}>
              <MemoryCard id={n.id} text={n.text} status="proposed" canDecide={canManage} />
            </li>
          ) : (
            <li key={n.id} className="flex items-start justify-between gap-3 border-t border-neutral-100 pt-2">
              <span>{n.text}</span>
              {canManage ? (
                <button type="button" disabled={busy === n.id} onClick={() => remove(n.id)} className="shrink-0 rounded-md border border-neutral-300 px-2 py-0.5 text-xs hover:border-neutral-500 disabled:opacity-50">
                  {busy === n.id ? "Removing…" : "Remove"}
                </button>
              ) : null}
            </li>
          ),
        )}
      </ul>
    </details>
  );
}
