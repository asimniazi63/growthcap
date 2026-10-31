"use client";

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
      className="rounded-md border border-neutral-300 bg-white px-2.5 py-1 text-xs hover:border-neutral-500 disabled:opacity-50"
    >
      {busy ? "Removing…" : "Unpin"}
    </button>
  );
}
