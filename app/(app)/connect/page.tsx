import { AlertTriangle, CheckCircle2, ChevronRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { ChecksCard } from "@/components/connect/checks-card";
import { ConnectedBanner, SetupCard } from "@/components/connect/connection-card";
import { CoverageCard } from "@/components/connect/coverage-card";
import { FreshnessCard } from "@/components/connect/freshness-card";
import { PermissionsCard } from "@/components/connect/permissions-card";
import { PageHeader } from "@/components/ui/page-header";
import { getDb } from "@/lib/db/client";
import { loadStoreHealth } from "@/lib/health/load";
import { canResync } from "@/lib/sync/run";
import { getSyncStatus } from "@/lib/sync/status";
import { getTenantContext, type TenantContext } from "@/lib/tenancy/context";

const MESSAGES: Record<string, string> = {
  no_tenant: "This brand isn't set up yet. Ask an admin to run the tenant setup for it.",
  forbidden: "Only a Growth Capital admin can connect a store.",
  invalid_shop: "That doesn't look like a myshopify.com store address.",
  oauth_failed: "Shopify's response couldn't be verified. Start the connection again.",
  oauth_expired: "Shopify's permission screen was open too long, so the approval could not be matched to this browser. Start again and approve within a few minutes.",
  shop_unreachable: "Connected to Shopify, but couldn't read the store's settings. Try again.",
  missing_scopes: "The app wasn't granted every permission it needs. Reinstall it and accept all of them.",
  shop_taken: "That store is already connected to another brand.",
  tenant_has_shop: "This brand already has a connected store.",
  sync_running: "A sync is already running. Check back in a minute.",
  sync_forbidden: "Only a Growth Capital admin or partner can resync a store.",
  not_connected: "Connect the store before syncing it.",
};

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
  // The health cards read the same tenant and shop as the status above: both come from the session, never from the request.
  const health =
    ctx && shop && isConnected && status
      ? await loadStoreHealth(getDb(), { tenantId: ctx.tenantId, shopDomain: shop.domain, currency: shop.currency, asOfIso: status.asOf }).catch(() => null)
      : null;
  const isAdmin = ctx?.role === "gc_admin";

  return (
    <section>
      <PageHeader
        title="Store connection"
        description="The Shopify store this brand's questions are answered from."
        actions={
          isConnected ? (
            <Link href="/chat" className="btn btn-primary">
              Ask a question
              <ChevronRight className="size-4" aria-hidden />
            </Link>
          ) : null
        }
      />

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
      ) : isConnected && shop ? (
        <div className="space-y-4">
          <ConnectedBanner shop={shop} status={status} canSync={canResync(ctx.role)} />
          {status && health ? (
            <>
              <div className="grid gap-4 md:grid-cols-2">
                <FreshnessCard freshness={health.freshness} timezone={shop.timezone} />
                <ChecksCard checks={health.checks} />
              </div>
              <CoverageCard status={status} months={health.months} />
              <PermissionsCard groups={health.permissions} shopDomain={shop.domain} isAdmin={isAdmin} />
            </>
          ) : (
            <PermissionsCard groups={null} shopDomain={shop.domain} isAdmin={isAdmin} />
          )}
        </div>
      ) : (
        <SetupCard shop={shop} isAdmin={isAdmin} />
      )}
    </section>
  );
}
