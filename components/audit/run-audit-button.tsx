"use client";

import { Loader2, ScanSearch } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useToast } from "@/components/ui/toast";

// Runs the growth audit for the signed-in brand: a paid call, so it only runs on a click and the server allows one run per
// brand every 10 minutes. The server checks the role again.
export function RunAuditButton({ hasAudit, disabled }: { hasAudit: boolean; disabled?: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    const res = await fetch("/api/audit", { method: "POST" }).catch(() => null);
    setBusy(false);
    if (res?.ok) {
      const body = (await res.json().catch(() => null)) as { status?: string } | null;
      toast.show(body?.status === "blocked" ? "Audit written, but some figures could not be checked. It is marked blocked." : "Audit ready.");
      router.refresh();
    } else if (res?.status === 429) toast.show("This brand's audit ran a few minutes ago. Try again in 10 minutes.", "error");
    else if (res?.status === 403) toast.show("Only a Growth Capital admin or partner can run the audit.", "error");
    else toast.show("Couldn't run the audit. Try again.", "error");
  }

  return (
    <button type="button" onClick={run} disabled={busy || disabled} className="btn btn-primary" aria-busy={busy}>
      {busy ? <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden /> : <ScanSearch className="size-4" aria-hidden />}
      {busy ? "Running the audit…" : hasAudit ? "Run the audit again" : "Run the audit"}
    </button>
  );
}
