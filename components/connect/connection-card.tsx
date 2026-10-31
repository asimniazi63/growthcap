import { AlertTriangle, Check, Plug, RefreshCw } from "lucide-react";
import type { SyncStatus } from "@/lib/sync/status";
import type { TenantContext } from "@/lib/tenancy/context";

type Shop = NonNullable<TenantContext["shop"]>;

function StatusDot({ tone }: { tone: "warn" | "muted" }) {
  const colour = tone === "warn" ? "bg-warn" : "bg-ink-3";
  return (
    <span className="relative grid size-5 place-items-center" aria-hidden>
      <span className={`absolute size-5 rounded-full opacity-20 ${colour}`} />
      <span className={`size-2.5 rounded-full ${colour}`} />
    </span>
  );
}

// The top of a connected store: status, store address, time zone and currency, and Resync.
export function ConnectedBanner({ shop, status, canSync }: { shop: Shop; status: SyncStatus | null; canSync: boolean }) {
  const run = status?.lastRun;
  return (
    <div className="card px-5 py-5 sm:px-6">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <span className="grid size-[42px] shrink-0 place-items-center rounded-full bg-ahead-tint text-ahead">
          <Check className="size-[22px]" aria-hidden />
        </span>
        <div className="min-w-0 flex-1 basis-56">
          <p className="section-title">Connected</p>
          <p className="muted mt-0.5 text-sm">
            <span className="break-all font-mono text-ink">{shop.domain}</span>
            <span className="faint">
              {" "}
              · {shop.timezone} · {shop.currency}
            </span>
          </p>
        </div>
        {status && canSync ? (
          <form action="/api/sync" method="post">
            <button type="submit" disabled={status.running} className="btn btn-secondary">
              <RefreshCw className={`size-4 ${status.running ? "motion-safe:animate-spin" : ""}`} aria-hidden />
              {status.running ? "Syncing…" : "Resync"}
            </button>
          </form>
        ) : null}
      </div>
      {status?.running ? (
        <p role="status" className="muted mt-4 text-sm">
          A sync is running. This page refreshes on its own.
        </p>
      ) : run?.status === "failed" ? (
        <p role="alert" className="mt-4 flex items-start gap-3 rounded-xl bg-behind-tint px-4 py-3 text-sm text-behind">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>The last sync failed: {(run.error ?? "unknown error").slice(0, 200)}</span>
        </p>
      ) : null}
    </div>
  );
}

// A store that is not connected: its status, and the form that connects it (admins only), exactly as before.
export function SetupCard({ shop, isAdmin }: { shop: Shop | null; isAdmin: boolean }) {
  return (
    <div className="card card-pad">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div>
          <p className="faint text-sm">Status</p>
          <p className="section-title mt-0.5 flex items-center gap-2.5">
            <StatusDot tone={shop ? "warn" : "muted"} />
            {shop ? "Disconnected" : "Not connected"}
          </p>
        </div>
        {shop ? (
          <dl className="min-w-0 text-sm sm:text-right">
            <dt className="sr-only">Store</dt>
            <dd className="break-all font-mono text-ink">{shop.domain}</dd>
            <dd className="muted mt-0.5">
              {shop.timezone} · {shop.currency}
            </dd>
          </dl>
        ) : null}
      </div>

      {isAdmin ? (
        <form action="/api/shopify/install" method="get" className="mt-5 flex flex-col gap-3 sm:flex-row">
          <label className="sr-only" htmlFor="shop">
            Store address
          </label>
          <input id="shop" name="shop" required defaultValue={shop?.domain ?? ""} placeholder="your-store.myshopify.com" className="field min-w-0 flex-1" />
          <button type="submit" className="btn btn-primary">
            <Plug className="size-4" aria-hidden />
            {shop ? "Reconnect store" : "Connect store"}
          </button>
        </form>
      ) : (
        <p className="muted mt-4 text-sm">An admin needs to connect the store.</p>
      )}
    </div>
  );
}
