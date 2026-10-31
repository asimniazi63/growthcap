import { Lock } from "lucide-react";
import { ActionsList } from "@/components/actions/actions-list";
import { ErrorBanner } from "@/components/chat/error-banner";
import { PageHeader } from "@/components/ui/page-header";
import { listActions, type LedgerView } from "@/lib/actions/ledger";
import { getDb } from "@/lib/db/client";
import { AppError, type ErrorCode } from "@/lib/errors";
import { getTenantContext, type TenantContext } from "@/lib/tenancy/context";

async function loadTenant(): Promise<TenantContext | null> {
  try {
    return await getTenantContext();
  } catch {
    return null;
  }
}

export default async function ActionsPage() {
  const ctx = await loadTenant();
  const heading = <PageHeader title="Actions" description="Changes the agent proposed for this brand. Nothing reaches the store until a Growth Capital admin or partner approves it here." />;
  if (!ctx) {
    return (
      <section>
        {heading}
        <ErrorBanner code="FORBIDDEN" role="client_viewer" />
      </section>
    );
  }

  if (ctx.role === "client_viewer") {
    return (
      <section>
        {heading}
        <div className="card card-pad flex items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-paper-2 text-ink-2">
            <Lock className="size-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="font-medium">Growth Capital roles only</p>
            <p className="muted mt-0.5 text-sm">Changes to the store are proposed and approved by the Growth Capital team.</p>
          </div>
        </div>
      </section>
    );
  }

  let actions: LedgerView[] = [];
  let failure: ErrorCode | null = null;
  try {
    actions = await listActions(getDb(), ctx);
  } catch (e) {
    failure = e instanceof AppError ? e.code : "INTERNAL_ERROR";
  }

  return (
    <section>
      {heading}
      {failure ? <ErrorBanner code={failure} role={ctx.role} /> : <ActionsList actions={actions} canDecide={ctx.role === "gc_admin" || ctx.role === "gc_partner"} me={ctx.userId} timezone={ctx.shop?.timezone ?? "UTC"} />}
    </section>
  );
}
