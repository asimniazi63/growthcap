import { ErrorBanner } from "@/components/chat/error-banner";
import { PacePanel } from "@/components/pace/pace-panel";
import { PinnedViews } from "@/components/pace/pinned-views";
import { getDb } from "@/lib/db/client";
import { AppError, type ErrorCode } from "@/lib/errors";
import { getPaceView, type PaceView } from "@/lib/pace/view";
import { getTenantContext, type TenantContext } from "@/lib/tenancy/context";

async function loadTenant(): Promise<TenantContext | null> {
  try {
    return await getTenantContext();
  } catch {
    return null;
  }
}

export default async function PacePage() {
  const ctx = await loadTenant();
  const heading = (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Pace</h1>
      <p className="mt-1 text-sm text-neutral-600">This month against the plan, where it is likely to land, and how last month finished.</p>
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

  let view: PaceView | null = null;
  let failure: ErrorCode | null = null;
  if (ctx.shop?.status !== "connected") {
    failure = "STORE_DISCONNECTED";
  } else {
    try {
      view = await getPaceView(ctx, { db: getDb() });
    } catch (e) {
      failure = e instanceof AppError ? e.code : "INTERNAL_ERROR";
    }
  }

  return (
    <section className="space-y-5">
      {heading}
      {failure ? <ErrorBanner code={failure} role={ctx.role} /> : null}
      {view?.demoClock ? (
        <p role="status" className="rounded-md border border-sky-200 bg-sky-50 px-4 py-2 text-sm text-sky-900">
          Demo data: &quot;today&quot; is counted as the day after the newest order, so {view.through} is the last complete day.
        </p>
      ) : null}
      {view && ctx.shop ? <PacePanel view={view} currency={ctx.shop.currency} /> : null}
      {ctx.shop?.status === "connected" ? <PinnedViews ctx={ctx} /> : null}
    </section>
  );
}
