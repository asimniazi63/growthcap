"use client";

import { RefreshCw } from "lucide-react";
import { BrandMark } from "@/components/shell/brand";

// The last-resort screen when a page throws. The error text is never shown, only the digest Next.js gives so a failure can be found in the logs.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="grid min-h-screen place-items-center bg-paper px-4 py-10">
      <div role="alert" className="flex max-w-sm flex-col items-center text-center">
        <BrandMark className="size-10" />
        <h1 className="page-title mt-6">Something went wrong</h1>
        <p className="muted mt-2">Nothing was changed. Try again, and if it keeps happening, reload the page.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button type="button" onClick={() => reset()} className="btn btn-primary">
            <RefreshCw className="size-4" aria-hidden />
            Try again
          </button>
          <button type="button" onClick={() => window.location.reload()} className="btn btn-secondary">
            Reload page
          </button>
        </div>
        {error.digest ? <p className="faint num mt-5 text-xs">Reference {error.digest}</p> : null}
      </div>
    </main>
  );
}
