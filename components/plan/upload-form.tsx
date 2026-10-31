"use client";

import { AlertTriangle, Loader2, UploadCloud } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

const MAX_MB = 4;

// Uploads a SOW (PDF) or a plan sheet (CSV). The server checks the file again; this only saves a round trip.
export function UploadForm() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const file = input.current?.files?.[0];
    if (!file) return setError("Choose a PDF or a CSV file first.");
    const kind = /\.pdf$/i.test(file.name) ? "sow" : /\.csv$/i.test(file.name) ? "plan_sheet" : null;
    if (!kind) return setError("Only a PDF (a SOW) or a CSV (a plan sheet) can be uploaded.");
    if (file.size > MAX_MB * 1024 * 1024) return setError(`A file can be at most ${MAX_MB} MB.`);
    setBusy(true);
    setError(null);
    const body = new FormData();
    body.set("kind", kind);
    body.set("file", file);
    const res = await fetch("/api/documents", { method: "POST", body }).catch(() => null);
    setBusy(false);
    if (res?.ok) {
      if (input.current) input.current.value = "";
    } else {
      const detail = (await res?.json().catch(() => null)) as { message?: string; error?: string } | null;
      setError(detail?.message ?? (res?.status === 403 ? "Only a Growth Capital admin or partner can upload." : "The upload failed. Try again."));
    }
    router.refresh(); // a failed read still leaves the document in the list
  }

  return (
    <form onSubmit={submit} className="card card-pad">
      <div className="flex flex-col gap-4 rounded-xl border border-dashed border-line-strong bg-paper/60 p-4 sm:flex-row sm:items-center sm:p-5">
        <span className="grid size-11 shrink-0 place-items-center rounded-full bg-brand-tint text-brand-strong">
          <UploadCloud className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <label htmlFor="plan-file" className="block font-display font-semibold text-ink">
            Upload a SOW (PDF) or a plan sheet (CSV)
          </label>
          <p className="muted mt-0.5 text-sm">PDF or CSV, up to {MAX_MB} MB. The targets are read for you to review; nothing changes until you confirm.</p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <input
              id="plan-file"
              ref={input}
              type="file"
              accept=".pdf,.csv,application/pdf,text/csv"
              disabled={busy}
              className="min-w-0 max-w-full text-sm text-ink-2 file:mr-3 file:cursor-pointer file:rounded-[10px] file:border file:border-line-strong file:bg-surface file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-ink hover:file:border-ink-3 disabled:opacity-60"
            />
            <button type="submit" disabled={busy} className="btn btn-primary">
              {busy ? <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden /> : null}
              {busy ? "Reading, this can take a minute..." : "Upload and read"}
            </button>
          </div>
        </div>
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
