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
    <div className="mt-5 border-t border-neutral-200 pt-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-neutral-500">Synced data</p>
          <p className="mt-0.5 text-sm text-neutral-700">
            Data as of {asOfText(status.asOf, timezone)}
            {status.firstOrderDate && status.lastOrderDate ? ` · orders from ${status.firstOrderDate} to ${status.lastOrderDate}` : ""}
          </p>
        </div>
        {canSync ? (
          <form action="/api/sync" method="post">
            <button
              type="submit"
              disabled={status.running}
              className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {status.running ? "Syncing…" : "Resync"}
            </button>
          </form>
        ) : null}
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {stats.map(([label, value]) => (
          <div key={label} className="rounded-md bg-neutral-50 px-3 py-2">
            <dt className="text-xs text-neutral-500">{label}</dt>
            <dd className="text-lg font-semibold tabular-nums">{number.format(value)}</dd>
          </div>
        ))}
      </dl>
      {status.running ? (
        <p role="status" className="mt-3 text-sm text-neutral-600">
          A sync is running. This page refreshes on its own.
        </p>
      ) : run?.status === "failed" ? (
        <p role="alert" className="mt-3 text-sm text-red-700">
          The last sync failed: {(run.error ?? "unknown error").slice(0, 200)}
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
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Store connection</h1>
        <p className="mt-1 text-sm text-neutral-600">The Shopify store this brand&apos;s questions are answered from.</p>
      </div>

      {error ? (
        <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {MESSAGES[error] ?? "Something went wrong. Try again."}
        </p>
      ) : null}
      {status?.running ? <meta httpEquiv="refresh" content="10" /> : null}
      {sync === "started" ? (
        <p role="status" className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          Sync started.
        </p>
      ) : null}
      {connected ? (
        <p role="status" className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          Store connected.
        </p>
      ) : null}

      {!ctx ? (
        <p className="rounded-md border border-neutral-200 bg-white px-4 py-3 text-sm text-neutral-700">{MESSAGES.no_tenant}</p>
      ) : (
        <div className="rounded-lg border border-neutral-200 bg-white p-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm text-neutral-500">Status</p>
              <p className="mt-0.5 flex items-center gap-2 font-medium">
                <span className={`inline-block size-2 rounded-full ${isConnected ? "bg-emerald-500" : "bg-neutral-400"}`} aria-hidden />
                {isConnected ? "Connected" : shop ? "Disconnected" : "Not connected"}
              </p>
            </div>
            {shop ? (
              <dl className="text-right text-sm text-neutral-600">
                <dt className="sr-only">Store</dt>
                <dd className="font-mono">{shop.domain}</dd>
                <dd>
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
              <input
                id="shop"
                name="shop"
                required
                defaultValue={shop?.domain ?? ""}
                placeholder="your-store.myshopify.com"
                className="min-w-0 flex-1 rounded-md border border-neutral-300 px-3 py-2 text-sm"
              />
              <button type="submit" className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700">
                {shop ? "Reconnect store" : "Connect store"}
              </button>
            </form>
          ) : null}
          {ctx.role === "gc_admin" && isConnected && shop ? (
            <form action="/api/shopify/install" method="get" className="mt-5 flex flex-col gap-2">
              <input type="hidden" name="shop" value={shop.domain} />
              <div>
                <button type="submit" className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium hover:bg-neutral-50">
                  Update permissions
                </button>
              </div>
              <p className="text-sm text-neutral-500">Use this after a new version of the app asks for more access. Shopify shows what is new, and the store stays connected.</p>
            </form>
          ) : null}
          {ctx.role !== "gc_admin" && !isConnected ? <p className="mt-4 text-sm text-neutral-500">An admin needs to connect the store.</p> : null}
        </div>
      )}
    </section>
  );
}
