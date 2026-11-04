import { FlaskConical } from "lucide-react";
import { OpenItems } from "@/components/action-items/open-items";
import { ErrorBanner } from "@/components/chat/error-banner";
import { MonthStrip } from "@/components/pace/month-strip";
import { PacePanel } from "@/components/pace/pace-panel";
import { PinnedViews } from "@/components/pace/pinned-views";
import { PageHeader } from "@/components/ui/page-header";
import { getDb } from "@/lib/db/client";
import { AppError, type ErrorCode } from "@/lib/errors";
import { loadPaceAnnotations, type PaceAnnotation } from "@/lib/pace/annotations";
import { getPaceView, listPaceMonths, monthParam, type PaceMonth, type PaceView } from "@/lib/pace/view";
import { getTenantContext, type TenantContext } from "@/lib/tenancy/context";

async function loadTenant(): Promise<TenantContext | null> {
  try {
    return await getTenantContext();
  } catch {
    return null;
  }
}

// ?month=YYYY-MM shows a finished month whole. getPaceView checks the value, and anything that isn't a past month in the data
// (malformed, repeated, this month or later, or before the first order) shows this month.
export default async function PacePage({ searchParams }: { searchParams: Promise<{ month?: string | string[] }> }) {
  const month = monthParam((await searchParams).month);
  const ctx = await loadTenant();
  const heading = <PageHeader title="Pace" description="This month against the plan, where it is likely to land, and how earlier months finished." />;
  if (!ctx) {
    return (
      <section>
        {heading}
        <ErrorBanner code="FORBIDDEN" role="client_viewer" />
      </section>
    );
  }

  let view: PaceView | null = null;
  let months: PaceMonth[] = [];
  let failure: ErrorCode | null = null;
  if (ctx.shop?.status !== "connected") {
    failure = "STORE_DISCONNECTED";
  } else {
    try {
      // The strip of months is only a way around the page: if it can't be read, the page is drawn without it.
      [view, months] = await Promise.all([getPaceView(ctx, { db: getDb(), month }), listPaceMonths(ctx, { db: getDb() }).catch((): PaceMonth[] => [])]);
    } catch (e) {
      failure = e instanceof AppError ? e.code : "INTERNAL_ERROR";
    }
  }

  // The markers on the chart are a garnish: if they can't be read, the chart is drawn without them. A client viewer is not offered the
  // calendar or the call notes anywhere else (the agent's tools leave them out), so they get the markers drawn from orders only. For a
  // finished month, view.through is its last day, so the markers cover the whole month.
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
        {view ? <MonthStrip months={months} selected={view.month} /> : null}
        {/* The demo clock only sets this month's last complete day; a finished month is shown whole either way. */}
        {view?.demoClock && !view.closed ? (
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
