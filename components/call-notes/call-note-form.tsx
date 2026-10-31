"use client";

import { AlertTriangle, Loader2, NotebookPen } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useToast } from "@/components/ui/toast";

const MAX_CHARS = 8000;

// Pastes in a call note. The server checks it again and reads it for plan changes and action items to review; nothing changes
// until the person confirms them.
export function CallNoteForm() {
  const router = useRouter();
  const toast = useToast();
  const [title, setTitle] = useState("");
  const [heldOn, setHeldOn] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return setError("Give the call note a title.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(heldOn)) return setError("Choose the day the call was held.");
    if (text.trim().length < 20) return setError("Paste the call note's text.");
    if (text.length > MAX_CHARS) return setError(`A call note can be at most ${MAX_CHARS.toLocaleString("en-US")} characters.`);
    setBusy(true);
    setError(null);
    const res = await fetch("/api/call-notes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title, heldOn, text }) }).catch(() => null);
    setBusy(false);
    if (res?.ok) {
      setTitle("");
      setHeldOn("");
      setText("");
      toast.show("Call note read. Review the proposed changes below.");
      router.refresh();
    } else {
      const detail = (await res?.json().catch(() => null)) as { message?: string } | null;
      setError(detail?.message ?? (res?.status === 403 ? "Only a Growth Capital admin or partner can add a call note." : "Reading the call note failed. Try again."));
    }
  }

  return (
    <form onSubmit={submit} className="card card-pad">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-brand-tint text-brand-strong">
          <NotebookPen className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="section-title">Add a call note</h3>
          <p className="muted mt-0.5 text-sm">Paste the note. Plan changes and action items are read from it for you to review; nothing changes until you confirm.</p>
        </div>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-[1fr_12rem]">
        <div>
          <label htmlFor="call-note-title" className="mb-1 block text-sm font-medium text-ink">
            Title
          </label>
          <input id="call-note-title" className="field w-full" value={title} maxLength={120} disabled={busy} onChange={(e) => setTitle(e.target.value)} placeholder="Q4 budget and planning" />
        </div>
        <div>
          <label htmlFor="call-note-date" className="mb-1 block text-sm font-medium text-ink">
            Call held on
          </label>
          <input id="call-note-date" type="date" className="field w-full" value={heldOn} disabled={busy} onChange={(e) => setHeldOn(e.target.value)} />
        </div>
      </div>
      <div className="mt-4">
        <label htmlFor="call-note-text" className="mb-1 block text-sm font-medium text-ink">
          Note
        </label>
        <textarea id="call-note-text" className="field min-h-44 w-full resize-y" value={text} disabled={busy} onChange={(e) => setText(e.target.value)} placeholder="Paste the call note here" />
        <p className={`mt-1 text-right text-xs ${text.length > MAX_CHARS ? "text-behind" : "text-ink-3"}`}>
          <span className="num">{text.length.toLocaleString("en-US")}</span> of <span className="num">{MAX_CHARS.toLocaleString("en-US")}</span> characters
        </p>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="submit" disabled={busy} className="btn btn-primary">
          {busy ? <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden /> : null}
          {busy ? "Reading, this can take a minute..." : "Read the note"}
        </button>
      </div>
      {error ? (
        <p role="alert" className="mt-3 flex items-start gap-2 text-sm text-behind">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          {error}
        </p>
      ) : null}
    </form>
  );
}
