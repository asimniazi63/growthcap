import { Pin, TriangleAlert } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { ViewRenderer } from "@/components/views/view-renderer";
import { UnpinButton } from "@/components/views/unpin-button";
import { getDb } from "@/lib/db/client";
import type { TenantContext } from "@/lib/tenancy/context";
import { listViews, rebuild } from "@/lib/views/saved";

// The views this person pinned from the chat. Each one re-runs its queries when the page loads, so it shows today's
// numbers; one that can no longer be drawn says so and can still be removed.
export async function PinnedViews({ ctx }: { ctx: TenantContext }) {
  const db = getDb();
  const views = await listViews(ctx, { db }).catch(() => []);
  if (views.length === 0) {
    return (
      <section aria-labelledby="pinned">
        <h2 id="pinned" className="section-title mb-4">Pinned views</h2>
        <EmptyState icon={Pin} title="Nothing pinned yet">
          Ask the chat for a chart, then choose &ldquo;Pin to Pace&rdquo; under it.
        </EmptyState>
      </section>
    );
  }
  const drawn = await Promise.allSettled(views.map((v) => rebuild(ctx, v, { db })));
  return (
    <section aria-labelledby="pinned">
      <h2 id="pinned" className="section-title">Pinned views</h2>
      <p className="muted mt-1 text-sm">Each one re-runs its queries when this page opens, so the numbers are current.</p>
      <div className="mt-4 grid gap-5 lg:grid-cols-2">
        {views.map((v, i) => {
          const result = drawn[i]!;
          return (
            <div key={v.id} className="flex min-w-0 flex-col gap-2">
              {result.status === "fulfilled" ? (
                <ViewRenderer data={result.value} title={v.title} currency={ctx.shop?.currency ?? "USD"} />
              ) : (
                <p role="status" className="flex items-start gap-2.5 rounded-2xl border border-warn/30 bg-warn-tint px-4 py-3 text-sm text-warn">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                  <span>{`Couldn't refresh “${v.title}” just now. Reload the page to try again, or unpin it.`}</span>
                </p>
              )}
              <div>
                <UnpinButton id={v.id} />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
