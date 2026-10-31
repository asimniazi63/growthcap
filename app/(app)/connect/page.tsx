import { AlertTriangle, CheckCircle2, Plug, RefreshCw, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { getDb } from "@/lib/db/client";
import { canResync } from "@/lib/sync/run";
import { getSyncStatus, type SyncStatus } from "@/lib/sync/status";
import { getTenantContext, type TenantContext } from "@/lib/tenancy/context";

const MESSAGES: Record<string, string> = {
  no_tenant: "This brand isn't set up yet. Ask an admin to run the tenant setup for it.",
  forbidden: "Only a Growth Capital admin can connect a store.",
  invalid_shop: "That doesn't look like a myshopify.com store address.",
  oauth_failed: "Shopify's response couldn't be verified. Start the connection again.",
  shop_unreachable: "Connected to Shopify, but couldn't read the store's settings. Try again.",
  missing_scopes: "The app wasn't granted every permission it needs. Reinstall it and accept all of them.",
  shop_taken: "That store is already connected to another brand.",
  tenant_has_shop: "This brand already has a connected store.",
  sync_running: "A sync is already running. Check back in a minute.",
  sync_forbidden: "Only a Growth Capital admin or partner can resync a store.",
  not_connected: "Connect the store before syncing it.",
};

const number = new Intl.NumberFormat("en-US");

function asOfText(iso: string | null, timezone: string): string {
  if (!iso) return "not synced yet";
  return new Intl.DateTimeFormat("en-US", { timeZone: timezone, dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
}

// A message above the status card: an error says what went wrong, a success says what happened.
function Callout({ tone, role, children }: { tone: "error" | "success"; role: "alert" | "status"; children: ReactNode }) {
  const Icon = tone === "error" ? AlertTriangle : CheckCircle2;
  const style = tone === "error" ? "bg-behind-tint text-behind" : "bg-ahead-tint text-ahead";
  return (
    <p role={role} className={`mb-5 flex items-start gap-3 rounded-xl px-4 py-3 text-sm font-medium ${style}`}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  );
}

function StatusDot({ tone }: { tone: "ahead" | "warn" | "muted" }) {
  const colour = tone === "ahead" ? "bg-ahead" : tone === "warn" ? "bg-warn" : "bg-ink-3";
  return (
    <span className="relative grid size-5 place-items-center" aria-hidden>
      <span className={`absolute size-5 rounded-full opacity-20 ${colour}`} />
      <span className={`size-2.5 rounded-full ${colour}`} />
    </span>
  );
}

function SyncPanel({ status, timezone, canSync }: { status: SyncStatus; timezone: string; canSync: boolean }) {
  const { counts } = status;
  const stats: [string, number][] = [
    ["Orders", counts.orders],
    ["Customers", counts.customers],
    ["Products", counts.products],
    ["Variants", counts.variants],
    ["Refunds", counts.refunds],
  ];
  const run = status.lastRun;
  return (
    <div className="mt-5 border-t border-line pt-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="section-title">Synced data</h2>
          <p className="muted mt-0.5 text-sm">
            Data as of {asOfText(status.asOf, timezone)}
            {status.firstOrderDate && status.lastOrderDate ? ` · orders from ${status.firstOrderDate} to ${status.lastOrderDate}` : ""}
          </p>
        </div>
        {canSync ? (
          <form action="/api/sync" method="post">
            <button type="submit" disabled={status.running} className="btn btn-secondary">
              <RefreshCw className={`size-4 ${status.running ? "motion-safe:animate-spin" : ""}`} aria-hidden />
              {status.running ? "Syncing…" : "Resync"}
            </button>
          </form>
        ) : null}
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {stats.map(([label, value]) => (
          <div key={label} className="inset px-3.5 py-3">
            <dt className="faint text-xs">{label}</dt>
            <dd className="stat num mt-1 text-xl">{number.format(value)}</dd>
          </div>
        ))}
      </dl>
      {status.running ? (
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

async function loadTenant(): Promise<TenantContext | null> {
  try {
    return await getTenantContext();
  } catch {
    return null;
  }
}

export default async function ConnectPage({ searchParams }: { searchParams: Promise<{ error?: string; connected?: string; sync?: string }> }) {
  const { error, connected, sync } = await searchParams;
  const ctx = await loadTenant();
  const shop = ctx?.shop ?? null;
  const isConnected = shop?.status === "connected";
  const status = ctx && shop ? await getSyncStatus(getDb(), ctx.tenantId).catch(() => null) : null;

  return (
    <section>
      <PageHeader title="Store connection" description="The Shopify store this brand's questions are answered from." />

      {error ? (
        <Callout tone="error" role="alert">
          {MESSAGES[error] ?? "Something went wrong. Try again."}
        </Callout>
      ) : null}
      {status?.running ? <meta httpEquiv="refresh" content="10" /> : null}
      {sync === "started" ? (
        <Callout tone="success" role="status">
          Sync started.
        </Callout>
      ) : null}
      {connected ? (
        <Callout tone="success" role="status">
          Store connected.
        </Callout>
      ) : null}

      {!ctx ? (
        <div className="card card-pad text-sm">
          <p className="muted">{MESSAGES.no_tenant}</p>
        </div>
      ) : (
        <div className="card card-pad">
          <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
            <div>
              <p className="faint text-sm">Status</p>
              <p className="section-title mt-0.5 flex items-center gap-2.5">
                <StatusDot tone={isConnected ? "ahead" : shop ? "warn" : "muted"} />
                {isConnected ? "Connected" : shop ? "Disconnected" : "Not connected"}
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

          {isConnected && status && shop ? <SyncPanel status={status} timezone={shop.timezone} canSync={canResync(ctx.role)} /> : null}

          {ctx.role === "gc_admin" && !isConnected ? (
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
          ) : null}
          {ctx.role === "gc_admin" && isConnected && shop ? (
            <form action="/api/shopify/install" method="get" className="mt-5 flex flex-col gap-2 border-t border-line pt-5">
              <input type="hidden" name="shop" value={shop.domain} />
              <div>
                <button type="submit" className="btn btn-secondary">
                  <ShieldCheck className="size-4" aria-hidden />
                  Update permissions
                </button>
              </div>
              <p className="muted text-sm">Use this after a new version of the app asks for more access. Shopify shows what is new, and the store stays connected.</p>
            </form>
          ) : null}
          {ctx.role !== "gc_admin" && !isConnected ? <p className="muted mt-4 text-sm">An admin needs to connect the store.</p> : null}
        </div>
      )}
    </section>
  );
}
