import { Lock, ScanSearch } from "lucide-react";
import { AuditView } from "@/components/audit/audit-view";
import { RunAuditButton } from "@/components/audit/run-audit-button";
import { ErrorBanner } from "@/components/chat/error-banner";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { canAudit, latestAudit, type AuditItemView } from "@/lib/audit/store";
import { getDb } from "@/lib/db/client";
import { getTenantContext, type TenantContext } from "@/lib/tenancy/context";

async function loadTenant(): Promise<TenantContext | null> {
  try {
    return await getTenantContext();
  } catch {
    return null;
  }
}

export default async function AuditPage() {
  const ctx = await loadTenant();
  const description = "Fixed checks over this brand's synced data find the top three opportunities, and the agent writes them up. Every figure in the write-up is checked against the data.";
  if (!ctx) {
    return (
      <section>
        <PageHeader title="Growth audit" description={description} />
        <ErrorBanner code="FORBIDDEN" role="client_viewer" />
      </section>
    );
  }
  if (!canAudit(ctx)) {
    return (
      <section>
        <PageHeader title="Growth audit" description={description} />
        <div className="card card-pad flex items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-paper-2 text-ink-2">
            <Lock className="size-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="font-medium">Growth Capital roles only</p>
            <p className="muted mt-0.5 text-sm">Ask your Growth Capital contact for an audit of this store.</p>
          </div>
        </div>
      </section>
    );
  }

  let audit: AuditItemView | null = null;
  let failed = false;
  try {
    audit = await latestAudit(getDb(), ctx);
  } catch {
    failed = true;
  }
  const connected = ctx.shop?.status === "connected";
  return (
    <section>
      <PageHeader title="Growth audit" description={description} actions={failed ? undefined : <RunAuditButton hasAudit={!!audit} disabled={!connected} />} />
      {failed ? (
        <ErrorBanner code="INTERNAL_ERROR" role={ctx.role} />
      ) : audit ? (
        <AuditView audit={audit} currency={ctx.shop?.currency ?? "USD"} />
      ) : (
        <EmptyState icon={ScanSearch} title="No audit yet">
          {connected ? "Run the audit to see data health, the last 30 days and the top three opportunities for this store. It makes one AI call, so it runs only when you ask." : "Connect the store first, then run the audit."}
        </EmptyState>
      )}
    </section>
  );
}
