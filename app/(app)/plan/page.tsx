import { FileText, Lock } from "lucide-react";
import { ErrorBanner } from "@/components/chat/error-banner";
import { DocumentCard } from "@/components/plan/document-card";
import { UploadForm } from "@/components/plan/upload-form";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { getDb } from "@/lib/db/client";
import { getDocument, listDocuments, canManagePlan, type DocumentDetail, type DocumentSummary } from "@/lib/plan-in/store";
import { getTenantContext, type TenantContext } from "@/lib/tenancy/context";

async function loadTenant(): Promise<TenantContext | null> {
  try {
    return await getTenantContext();
  } catch {
    return null;
  }
}

const OPEN_SHOWN = 5; // documents waiting for review that are shown in full

export default async function PlanPage() {
  const ctx = await loadTenant();
  const heading = <PageHeader title="Plan" description="Upload a SOW or a plan sheet, check the targets read from it, and confirm them as the plan that Pace and the agent use." />;
  if (!ctx) {
    return (
      <section>
        {heading}
        <ErrorBanner code="FORBIDDEN" role="client_viewer" />
      </section>
    );
  }
  if (!canManagePlan(ctx)) {
    return (
      <section>
        {heading}
        <div className="card card-pad flex items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-paper-2 text-ink-2">
            <Lock className="size-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="font-medium">Growth Capital roles only</p>
            <p className="muted mt-0.5 text-sm">Ask your Growth Capital contact to change the plan.</p>
          </div>
        </div>
      </section>
    );
  }

  const db = getDb();
  const all = await listDocuments(db, ctx);
  const waiting = all.filter((d) => d.status === "read").slice(0, OPEN_SHOWN);
  const details = (await Promise.all(waiting.map((d) => getDocument(db, ctx, d.id)))).filter((d): d is DocumentDetail => d !== null);
  const shown = new Map<string, DocumentSummary | DocumentDetail>(all.map((d) => [d.id, d]));
  for (const d of details) shown.set(d.id, d);
  const currency = ctx.shop?.currency ?? "USD";
  // The newest confirmed document is the plan in use: confirming one replaces the one before it.
  const activeId = all
    .filter((d) => d.status === "confirmed")
    .sort((x, y) => (y.decidedAt ?? y.createdAt).localeCompare(x.decidedAt ?? x.createdAt))[0]?.id;

  return (
    <section>
      {heading}
      <div className="space-y-10">
        <UploadForm />
        <div className="space-y-4">
          <h2 className="section-title">Documents</h2>
          {all.length === 0 ? (
            <EmptyState icon={FileText} title="No documents yet">
              Upload a SOW or a plan sheet above. Its targets are read for you to review, and nothing changes until you confirm.
            </EmptyState>
          ) : (
            <div className="space-y-4">
              {[...shown.values()].map((d) => (
                <DocumentCard key={d.id} doc={d} currency={currency} canDecide active={d.status === "confirmed" ? d.id === activeId : undefined} />
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
