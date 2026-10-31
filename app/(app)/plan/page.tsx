import { ErrorBanner } from "@/components/chat/error-banner";
import { DocumentCard } from "@/components/plan/document-card";
import { UploadForm } from "@/components/plan/upload-form";
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
  const heading = (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Plan</h1>
      <p className="mt-1 text-sm text-neutral-600">Upload a SOW or a plan sheet, check the targets read from it, and confirm them as the plan that Pace and the agent use.</p>
    </div>
  );
  if (!ctx) {
    return (
      <section className="space-y-4">
        {heading}
        <ErrorBanner code="FORBIDDEN" role="client_viewer" />
      </section>
    );
  }
  if (!canManagePlan(ctx)) {
    return (
      <section className="space-y-4">
        {heading}
        <p className="rounded-md border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-700">Growth Capital roles only. Ask your Growth Capital contact to change the plan.</p>
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

  return (
    <section className="space-y-6">
      {heading}
      <UploadForm />
      {all.length === 0 ? (
        <p className="text-sm text-neutral-600">No documents yet.</p>
      ) : (
        <div className="space-y-4">
          {[...shown.values()].map((d) => (
            <DocumentCard key={d.id} doc={d} currency={currency} canDecide />
          ))}
        </div>
      )}
    </section>
  );
}
