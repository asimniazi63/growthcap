"use client";

import { LoaderCircle, PinOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function UnpinButton({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        const res = await fetch(`/api/views/${id}`, { method: "DELETE" }).catch(() => null);
        if (res?.ok) router.refresh();
        else setBusy(false);
      }}
      className="btn btn-ghost btn-sm"
    >
      {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <PinOff className="size-4" aria-hidden />}
      {busy ? "Removing…" : "Unpin"}
    </button>
  );
}
