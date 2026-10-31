import { ActionsList } from "@/components/actions/actions-list";
import { ErrorBanner } from "@/components/chat/error-banner";
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
  const heading = (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Actions</h1>
      <p className="mt-1 text-sm text-neutral-600">Changes the agent proposed for this brand. Nothing reaches the store until a Growth Capital admin or partner approves it here.</p>
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

  if (ctx.role === "client_viewer") {
    return (
      <section className="space-y-4">
        {heading}
        <p className="rounded-lg border border-neutral-200 bg-white px-4 py-3 text-sm text-neutral-600">Growth Capital roles only. Changes to the store are proposed and approved by the Growth Capital team.</p>
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
    <section className="space-y-5">
      {heading}
      {failure ? <ErrorBanner code={failure} role={ctx.role} /> : <ActionsList actions={actions} canDecide={ctx.role === "gc_admin" || ctx.role === "gc_partner"} me={ctx.userId} timezone={ctx.shop?.timezone ?? "UTC"} />}
    </section>
  );
}
