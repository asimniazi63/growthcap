import { Plug } from "lucide-react";
import Link from "next/link";
import { AskBox } from "@/components/overview/ask-box";
import { AttentionCard } from "@/components/overview/attention-card";
import { BriefCard } from "@/components/overview/brief-card";
import { SalesCard } from "@/components/overview/sales-card";
import { WaitingCard } from "@/components/overview/waiting-card";
import { ErrorBanner } from "@/components/chat/error-banner";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { getDb } from "@/lib/db/client";
import type { ErrorCode } from "@/lib/errors";
import { buildAttention } from "@/lib/overview/attention";
import { isGc, loadOverview } from "@/lib/overview/data";
import { formatAsOf, longDate } from "@/lib/overview/format";
import { getTenantContext, type TenantContext } from "@/lib/tenancy/context";

async function loadTenant(): Promise<TenantContext | null> {
  try {
    return await getTenantContext();
  } catch {
    return null;
  }
}

// A card whose query failed says so and leaves the rest of the page alone.
function CardError({ title, code, role }: { title: string; code: ErrorCode; role: TenantContext["role"] }) {
  return (
    <section className="card card-pad">
      <h2 className="section-title mb-3">{title}</h2>
      <ErrorBanner code={code} role={role} />
    </section>
  );
}

export default async function OverviewPage() {
  const ctx = await loadTenant();
  if (!ctx) {
    return (
      <section>
        <PageHeader title="Overview" />
        <ErrorBanner code="FORBIDDEN" role="client_viewer" />
      </section>
    );
  }

  const data = await loadOverview(ctx, getDb());
  const gc = isGc(ctx);
  const connected = ctx.shop?.status === "connected";
  const currency = ctx.shop?.currency ?? "USD";
  const brand = data.brand ?? "Your brand";

  const view = data.pace?.ok ? data.pace.value : null;
  const asOf = view ? formatAsOf(view.asOf, view.today) : null;
  const lede = view ? `${brand}, ${longDate(view.today)}.${asOf ? ` Data as of ${asOf}.` : ""}` : connected ? brand : `${brand}. Connect a store to see how the month is going.`;

  // Needs attention: the stock check and this month's plan gaps. If one of them failed, the other still shows.
  const stock = data.stock?.ok ? data.stock.value : null;
  const gaps = view?.thisMonth?.gaps;
  const attention = connected ? buildAttention({ gaps, currency, stock }) : [];
  const paceError = data.pace && !data.pace.ok ? data.pace.code : null;

  return (
    <section>
      <PageHeader title="Overview" description={lede} />
      <div className="space-y-4">
        {connected ? <AskBox /> : null}
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
          <div className="flex min-w-0 flex-col gap-4">
            {!connected ? (
              <EmptyState
                icon={Plug}
                title={ctx.shop ? "The store needs reconnecting" : "No store connected yet"}
                action={
                  <Link href="/connect" className="btn btn-primary">
                    {ctx.role === "gc_admin" ? (ctx.shop ? "Reconnect the store" : "Connect a store") : "Open Connect"}
                  </Link>
                }
              >
                {ctx.shop ? "Shopify stopped sharing this store's data, so there is nothing to show yet." : "Once a Shopify store is connected, this page shows how the month is going against the plan."}
              </EmptyState>
            ) : paceError ? (
              <CardError title="Net sales this month" code={paceError} role={ctx.role} />
            ) : view ? (
              <SalesCard view={view} currency={currency} canPlan={gc} scope={ctx.tenantId} />
            ) : null}

            {connected ? (
              paceError && !stock ? (
                <CardError title="Needs attention" code={paceError} role={ctx.role} />
              ) : (
                <AttentionCard items={attention} note={data.stock && !data.stock.ok ? "Stock cover couldn't be checked just now." : paceError ? "Plan figures couldn't be read just now." : undefined} />
              )
            ) : null}
          </div>

          <div className="flex min-w-0 flex-col gap-4">
            {gc ? (
              data.pending?.ok ? (
                <WaitingCard rows={data.pending.value.rows} total={data.pending.value.total} />
              ) : data.pending ? (
                <CardError title="Waiting for you" code={data.pending.code} role={ctx.role} />
              ) : null
            ) : null}
            {data.brief.ok ? <BriefCard brief={data.brief.value} canApprove={gc} /> : <CardError title="Latest brief" code={data.brief.code} role={ctx.role} />}
          </div>
        </div>
      </div>
    </section>
  );
}
