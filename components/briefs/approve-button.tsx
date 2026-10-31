"use client";

import { Check, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

// Shown only for a draft, and only to a Growth Capital admin or partner (the server checks the role again).
export function ApproveButton({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  async function approve() {
    setBusy(true);
    setFailed(null);
    const res = await fetch(`/api/briefs/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ decision: "approve" }) }).catch(() => null);
    setBusy(false);
    if (res?.ok) router.refresh();
    else setFailed(res?.status === 403 ? "Only a Growth Capital admin or partner can approve." : res?.status === 400 ? "This brief can't be approved." : "Couldn't approve that. Try again.");
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" disabled={busy} onClick={approve} className="btn btn-primary">
        {busy ? <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden /> : <Check className="size-4" aria-hidden />}
        {busy ? "Approving…" : "Approve"}
      </button>
      {failed ? (
        <span role="alert" className="text-sm text-behind">
          {failed}
        </span>
      ) : null}
    </div>
  );
}
