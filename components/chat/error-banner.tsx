"use client";

import Link from "next/link";
import type { ErrorCode } from "@/lib/errors";
import type { Role } from "@/lib/tenancy/context";

export type ChatErrorCode = ErrorCode | "FORBIDDEN";

// What the user sees for each typed error. The provider's own message never reaches here: only the code does.
export const ERROR_COPY: Record<ChatErrorCode, { title: string; body: string; retry?: boolean }> = {
  STORE_DISCONNECTED: { title: "The store needs reconnecting", body: "Shopify stopped sharing this store's data, so there is nothing to answer from." },
  SHOPIFY_THROTTLED: { title: "Shopify is busy", body: "Shopify asked us to slow down. Wait a moment and try again.", retry: true },
  SHOPIFY_UNAVAILABLE: { title: "Shopify can't be reached right now", body: "Try again in a minute.", retry: true },
  DATA_STALE: { title: "This data may be out of date", body: "The latest sync is old, so recent orders may be missing." },
  NO_DATA: { title: "No data for that period", body: "The store has no orders in the dates asked about." },
  INVALID_INPUT: { title: "I couldn't use that request", body: "Try asking again with a metric and a period, for example net sales last month." },
  MODEL_TIMEOUT: { title: "The assistant took too long", body: "It didn't answer in time.", retry: true },
  BUDGET_EXCEEDED: { title: "This brand's AI budget is used up", body: "Questions work again after midnight UTC." },
  INTERNAL_ERROR: { title: "Something went wrong on our side", body: "Nothing was changed. Try again.", retry: true },
  FORBIDDEN: { title: "You don't have access to this brand's chat", body: "Switch to a brand you belong to, or ask your GC admin." },
};

export function ErrorBanner({ code, role, onRetry }: { code: ChatErrorCode; role: Role; onRetry?: () => void }) {
  const copy = ERROR_COPY[code] ?? ERROR_COPY.INTERNAL_ERROR;
  return (
    <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
      <p className="font-medium">{copy.title}</p>
      <p className="mt-0.5 text-red-800">{copy.body}</p>
      {code === "STORE_DISCONNECTED" ? (
        role === "gc_admin" ? (
          <Link href="/connect" className="mt-2 inline-block rounded-md bg-red-900 px-3 py-1.5 text-white hover:bg-red-800">
            Reconnect the store
          </Link>
        ) : (
          <p className="mt-2">Ask your GC admin to reconnect the store.</p>
        )
      ) : null}
      {copy.retry && onRetry ? (
        <button type="button" onClick={onRetry} className="mt-2 rounded-md border border-red-300 bg-white px-3 py-1.5 text-red-900 hover:bg-red-100">
          Try again
        </button>
      ) : null}
    </div>
  );
}
