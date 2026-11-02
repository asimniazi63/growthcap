import { FlaskConical } from "lucide-react";
import { OpenItems } from "@/components/action-items/open-items";
import { ErrorBanner } from "@/components/chat/error-banner";
import { PacePanel } from "@/components/pace/pace-panel";
import { PinnedViews } from "@/components/pace/pinned-views";
import { PageHeader } from "@/components/ui/page-header";
import { getDb } from "@/lib/db/client";
import { AppError, type ErrorCode } from "@/lib/errors";
import { loadPaceAnnotations, type PaceAnnotation } from "@/lib/pace/annotations";
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
  const heading = <PageHeader title="Pace" description="This month against the plan, where it is likely to land, and how last month finished." />;
  if (!ctx) {
    return (
      <section>
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

  // The markers on the chart are a garnish: if they can't be read, the chart is drawn without them. A client viewer is not offered the
  // calendar or the call notes anywhere else (the agent's tools leave them out), so they get the markers drawn from orders only.
  let annotations: PaceAnnotation[] = [];
  if (view?.series) {
    try {
      annotations = await loadPaceAnnotations(getDb(), ctx.tenantId, view.month, { through: view.through, internal: ctx.role !== "client_viewer" });
    } catch {
      annotations = [];
    }
  }

  return (
    <section>
      {heading}
      <div className="space-y-10">
        {failure ? <ErrorBanner code={failure} role={ctx.role} /> : null}
        {view?.demoClock ? (
          <p role="status" className="flex items-start gap-2.5 rounded-2xl border border-dashed border-estimate bg-surface px-4 py-3 text-sm">
            <FlaskConical className="mt-0.5 size-4 shrink-0 text-estimate" aria-hidden />
            <span>Demo data: &quot;today&quot; is counted as the day after the newest order, so {view.through} is the last complete day.</span>
          </p>
        ) : null}
        {view && ctx.shop ? <PacePanel view={view} currency={ctx.shop.currency} annotations={annotations} /> : null}
        <OpenItems ctx={ctx} />
        {ctx.shop?.status === "connected" ? <PinnedViews ctx={ctx} /> : null}
      </div>
    </section>
  );
}
