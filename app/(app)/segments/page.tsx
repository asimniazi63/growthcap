import { Info, Lock, UsersRound } from "lucide-react";
import { ErrorBanner } from "@/components/chat/error-banner";
import { count, parseSegment, sharePct, TOP_N } from "@/components/segments/format";
import { RfmGrid } from "@/components/segments/rfm-grid";
import { DownloadCsvLink } from "@/components/segments/segment-actions";
import { SegmentCards } from "@/components/segments/segment-cards";
import { SegmentPicker, TopCustomers } from "@/components/segments/top-customers";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { getDb } from "@/lib/db/client";
import { loadSegmentCustomers, summarizeSegments } from "@/lib/metrics/segments";
import { canViewSegments } from "@/lib/segments/access";
import type { SegmentCustomer } from "@/lib/segments/definitions";
import { getTenantContext, type TenantContext } from "@/lib/tenancy/context";

async function loadTenant(): Promise<TenantContext | null> {
  try {
    return await getTenantContext();
  } catch {
    return null;
  }
}

export default async function SegmentsPage({ searchParams }: { searchParams: Promise<{ segment?: string | string[] }> }) {
  const selected = parseSegment((await searchParams).segment);
  const ctx = await loadTenant();
  const description = "Who is worth keeping, who is slipping and who is due to reorder, worked out from this brand's synced orders. Customers are pseudonymous ids.";
  if (!ctx) {
    return (
      <section>
        <PageHeader title="Segments" description={description} />
        <ErrorBanner code="FORBIDDEN" role="client_viewer" />
      </section>
    );
  }
  if (!canViewSegments(ctx)) {
    return (
      <section>
        <PageHeader title="Segments" description={description} />
        <div className="card card-pad flex items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-paper-2 text-ink-2">
            <Lock className="size-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="font-medium">Growth Capital roles only</p>
            <p className="muted mt-0.5 text-sm">Ask your Growth Capital contact for the customer segments of this store.</p>
          </div>
        </div>
      </section>
    );
  }

  let data: { asOf: string; customers: SegmentCustomer[] } | null = null;
  try {
    data = await loadSegmentCustomers(getDb(), ctx.tenantId);
  } catch {
    data = null;
  }
  if (!data) {
    return (
      <section>
        <PageHeader title="Segments" description={description} />
        <ErrorBanner code="INTERNAL_ERROR" role={ctx.role} />
      </section>
    );
  }

  const { asOf, customers } = data;
  const connected = ctx.shop?.status === "connected";
  const currency = ctx.shop?.currency ?? "USD";
  if (customers.length === 0) {
    return (
      <section>
        <PageHeader title="Segments" description={description} />
        {ctx.shop && !connected ? <ErrorBanner code="STORE_DISCONNECTED" role={ctx.role} /> : null}
        <EmptyState icon={UsersRound} title="No customers to segment yet">
          Segments are built from orders placed by customers who are identified. Connect the store and let it finish syncing, then come back.
        </EmptyState>
      </section>
    );
  }

  const summaries = summarizeSegments(customers);
  const active = summaries.find((s) => s.segment === "active");

  return (
    <section>
      <PageHeader title="Segments" description={description} actions={<DownloadCsvLink label="Download CSV for Klaviyo" hidden="(all four segments)" connected={connected} primary />} />
      {ctx.shop && !connected ? (
        <div className="mb-6">
          <ErrorBanner code="STORE_DISCONNECTED" role={ctx.role} />
        </div>
      ) : null}
      <p className="muted mb-4 text-sm">
        {count(customers.length)} customers with at least one order, as of {asOf}, the last day of synced orders. A customer is in the first segment they qualify for.
      </p>

      <h2 className="sr-only">The four segments</h2>
      <SegmentCards summaries={summaries} currency={currency} connected={connected} selected={selected} />
      {active ? (
        <p className="faint mt-3 text-sm">
          Active customers: {count(active.customers)} ({sharePct(active.shareOfCustomers)}). They ordered recently but are neither champions nor due to reorder, and they are not in the file.
        </p>
      ) : null}

      <section aria-labelledby="rfm-heading" className="mt-10">
        <h2 id="rfm-heading" className="section-title">
          Recency and frequency
        </h2>
        <p className="muted mt-1 max-w-[62ch] text-sm">Every customer in the brand, scored 1 to 5 on how recently they ordered and how often. The top right is the best customers.</p>
        <div className="card card-pad mt-4">
          <RfmGrid customers={customers} />
        </div>
      </section>

      <section id="top-customers" aria-labelledby="top-heading" className="mt-10 scroll-mt-24">
        <h2 id="top-heading" className="section-title">
          Top customers
        </h2>
        <p className="muted mb-4 mt-1 max-w-[62ch] text-sm">The {TOP_N} highest lifetime value customers of the segment you pick. Churn risk is a simple rule-based score, not a prediction model.</p>
        <SegmentPicker selected={selected} />
        <div className="mt-4">
          <TopCustomers customers={customers} segment={selected} currency={currency} />
        </div>
      </section>

      <aside aria-labelledby="note-heading" className="inset mt-10 flex items-start gap-3 px-4 py-4">
        <Info className="mt-0.5 size-4 shrink-0 text-ink-3" aria-hidden />
        <div className="min-w-0 space-y-2 text-sm">
          <h2 id="note-heading" className="font-medium">
            About the file and Shopify
          </h2>
          <p className="muted">
            Customers here are pseudonymous ids, so the CSV has no emails or names. Matching these ids to Klaviyo profiles needs customer data access that this app does not have in this demo, so the file shows the shape of the export rather than a ready import.
          </p>
          <p className="muted">
            Create in Shopify opens the chat and asks the agent to propose the segment. A Growth Capital admin or partner approves the card before anything is created. Shopify cannot compare a customer with their own usual gap between orders, so Due to reorder is only approximated there with a fixed window and its members will not match this page exactly.
          </p>
        </div>
      </aside>
    </section>
  );
}
