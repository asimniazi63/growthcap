"use client";

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
    <form onSubmit={submit} className="rounded-lg border border-neutral-200 bg-white p-4">
      <label htmlFor="plan-file" className="block text-sm font-medium">
        Upload a SOW (PDF) or a plan sheet (CSV)
      </label>
      <p className="mt-1 text-xs text-neutral-500">Up to {MAX_MB} MB. The targets are read for you to review; nothing changes until you confirm.</p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <input id="plan-file" ref={input} type="file" accept=".pdf,.csv,application/pdf,text/csv" disabled={busy} className="text-sm" />
        <button type="submit" disabled={busy} className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50">
          {busy ? "Reading, this can take a minute..." : "Upload and read"}
        </button>
      </div>
      {error ? (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}
    </form>
  );
}
