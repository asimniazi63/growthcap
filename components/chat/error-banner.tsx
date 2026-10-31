"use client";

import { CircleAlert, TriangleAlert } from "lucide-react";
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

// Problems the person can wait out or retry read as a warning; the rest read as an error.
const SOFT: ReadonlySet<ChatErrorCode> = new Set(["SHOPIFY_THROTTLED", "SHOPIFY_UNAVAILABLE", "DATA_STALE", "NO_DATA", "INVALID_INPUT", "MODEL_TIMEOUT", "BUDGET_EXCEEDED"]);

export function ErrorBanner({ code, role, onRetry }: { code: ChatErrorCode; role: Role; onRetry?: () => void }) {
  const copy = ERROR_COPY[code] ?? ERROR_COPY.INTERNAL_ERROR;
  const soft = SOFT.has(code);
  const Icon = soft ? TriangleAlert : CircleAlert;
  return (
    <div role="alert" className={`flex gap-3 rounded-xl border px-4 py-3.5 text-sm ${soft ? "border-warn/30 bg-warn-tint" : "border-behind/30 bg-behind-tint"}`}>
      <Icon className={`mt-0.5 size-4.5 shrink-0 ${soft ? "text-warn" : "text-behind"}`} aria-hidden />
      <div className="min-w-0">
        <p className="font-semibold text-ink">{copy.title}</p>
        <p className="mt-0.5 text-ink-2">{copy.body}</p>
        {code === "STORE_DISCONNECTED" ? (
          role === "gc_admin" ? (
            <Link href="/connect" className="btn btn-primary btn-sm mt-3">
              Reconnect the store
            </Link>
          ) : (
            <p className="mt-2 text-ink">Ask your GC admin to reconnect the store.</p>
          )
        ) : null}
        {copy.retry && onRetry ? (
          <button type="button" onClick={onRetry} className="btn btn-secondary btn-sm mt-3">
            Try again
          </button>
        ) : null}
      </div>
    </div>
  );
}
