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
        <h2 id="pinned" className="text-lg font-semibold tracking-tight">Pinned views</h2>
        <p className="mt-2 text-sm text-neutral-600">Nothing pinned yet. Ask the chat for a chart, then choose &ldquo;Pin to Pace&rdquo; under it.</p>
      </section>
    );
  }
  const drawn = await Promise.allSettled(views.map((v) => rebuild(ctx, v, { db })));
  return (
    <section aria-labelledby="pinned" className="space-y-4">
      <h2 id="pinned" className="text-lg font-semibold tracking-tight">Pinned views</h2>
      {views.map((v, i) => {
        const result = drawn[i]!;
        return (
          <div key={v.id} className="space-y-2">
            {result.status === "fulfilled" ? (
              <ViewRenderer data={result.value} title={v.title} currency={ctx.shop?.currency ?? "USD"} />
            ) : (
              <p role="status" className="rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">{`Couldn't refresh “${v.title}” just now.`}</p>
            )}
            <UnpinButton id={v.id} />
          </div>
        );
      })}
    </section>
  );
}
