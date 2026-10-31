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
};

async function loadTenant(): Promise<TenantContext | null> {
  try {
    return await getTenantContext();
  } catch {
    return null;
  }
}

export default async function ConnectPage({ searchParams }: { searchParams: Promise<{ error?: string; connected?: string }> }) {
  const { error, connected } = await searchParams;
  const ctx = await loadTenant();
  const shop = ctx?.shop ?? null;
  const isConnected = shop?.status === "connected";

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
          {ctx.role !== "gc_admin" && !isConnected ? <p className="mt-4 text-sm text-neutral-500">An admin needs to connect the store.</p> : null}
        </div>
      )}
    </section>
  );
}
