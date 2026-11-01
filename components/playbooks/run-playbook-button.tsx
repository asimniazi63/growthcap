"use client";

import { Loader2, Play } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useToast } from "@/components/ui/toast";
import type { PlaybookId } from "@/lib/playbooks/definitions";
import type { MonthOption } from "./format";

// Runs one playbook for the signed-in brand: a paid call, so it only runs on a click and the server allows one run of each
// playbook per brand every 10 minutes. The server checks the role and the month again. The month list comes from the page,
// worked out on the server, so the options can't differ between the server render and the browser.
export function RunPlaybookButton({ playbook, title, hasRun, disabled, months }: { playbook: PlaybookId; title: string; hasRun: boolean; disabled?: boolean; months?: MonthOption[] }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [month, setMonth] = useState("");

  async function run() {
    setBusy(true);
    const res = await fetch("/api/playbooks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(month ? { playbook, month } : { playbook }),
    }).catch(() => null);
    setBusy(false);
    if (res?.ok) {
      const body = (await res.json().catch(() => null)) as { status?: string } | null;
      toast.show(body?.status === "blocked" ? `${title} written, but some figures could not be matched to the data. It is marked blocked.` : `${title} ready.`);
      router.refresh();
    } else if (res?.status === 429) toast.show(`The ${title.toLowerCase()} ran for this brand a few minutes ago. Try again in 10 minutes.`, "error");
    else if (res?.status === 403) toast.show("Only a Growth Capital admin or partner can run playbooks.", "error");
    else toast.show(`Couldn't run the ${title.toLowerCase()}. Try again.`, "error");
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {months ? (
        <label className="flex items-center gap-2 text-sm text-ink-2">
          Month
          <select value={month} disabled={busy || disabled} onChange={(e) => setMonth(e.target.value)} className="field w-auto py-1.5 text-sm disabled:opacity-60">
            {months.map((o) => (
              <option key={o.value || "last"} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <button type="button" onClick={run} disabled={busy || disabled} className="btn btn-primary" aria-busy={busy}>
        {busy ? <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden /> : <Play className="size-4" aria-hidden />}
        {busy ? "Running…" : hasRun ? "Run again" : "Run"}
        <span className="sr-only"> the {title.toLowerCase()}</span>
      </button>
    </div>
  );
}
