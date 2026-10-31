"use client";

import { Check, Loader2 } from "lucide-react";
import { useState } from "react";
import { useToast } from "@/components/ui/toast";
import type { LedgerView } from "@/lib/actions/ledger";
import { decisionFailure, decisionToast } from "@/lib/overview/messages";
import { RefreshNow } from "./refresh-now";

// Approves one proposed change from the Overview page. It calls the same endpoint as the Approve button on the Actions page;
// the server checks the role and the tenant again.
export function ApproveInline({ id, title, onApproved }: { id: string; title: string; onApproved: (action: LedgerView) => void }) {
  const toast = useToast();
  const [refreshes, setRefreshes] = useState(0);
  const [busy, setBusy] = useState(false);

  async function approve() {
    setBusy(true);
    const res = await fetch(`/api/actions/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ decision: "approve" }) }).catch(() => null);
    const body = (await res?.json().catch(() => null)) as { action?: LedgerView; message?: unknown } | null | undefined;
    setBusy(false);
    if (res?.ok && body?.action) {
      const { message, tone } = decisionToast("approve", body.action);
      toast.show(message, tone);
      onApproved(body.action);
      setRefreshes((n) => n + 1);
      return;
    }
    toast.show(decisionFailure(res?.status, body), "error");
  }

  return (
    <>
      {refreshes > 0 ? <RefreshNow key={refreshes} /> : null}
      <button type="button" onClick={approve} disabled={busy} aria-label={`Approve: ${title}`} className="btn btn-primary btn-sm shrink-0">
      {busy ? <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden /> : <Check className="size-4" aria-hidden />}
      {busy ? "Approving…" : "Approve"}
      </button>
    </>
  );
}
