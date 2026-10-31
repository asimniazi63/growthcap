"use client";

import { Check, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useToast } from "@/components/ui/toast";

export function MarkDoneButton({ id }: { id: string }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function done() {
    setBusy(true);
    const res = await fetch(`/api/action-items/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "done" }) }).catch(() => null);
    setBusy(false);
    if (res?.ok) {
      toast.show("Marked done.");
      router.refresh();
    } else if (res?.status === 404) {
      toast.show("That item was already done.", "error");
      router.refresh();
    } else {
      toast.show("That didn't work. Try again.", "error");
    }
  }

  return (
    <button type="button" disabled={busy} onClick={done} className="btn btn-secondary btn-sm shrink-0">
      {busy ? <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden /> : <Check className="size-4" aria-hidden />}
      Mark done
    </button>
  );
}
