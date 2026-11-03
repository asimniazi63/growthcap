import { BookOpenCheck, Lock } from "lucide-react";
import { Suspense } from "react";
import { ErrorBanner } from "@/components/chat/error-banner";
import { monthOptions } from "@/components/playbooks/format";
import { NumbersSkeleton } from "@/components/playbooks/numbers-panel";
import { PlaybookNumbers } from "@/components/playbooks/playbook-numbers";
import { PlaybookRun } from "@/components/playbooks/playbook-run";
import { RunPlaybookButton } from "@/components/playbooks/run-playbook-button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { getDb } from "@/lib/db/client";
import { PLAYBOOKS, type PlaybookId } from "@/lib/playbooks/definitions";
import { canRunPlaybooks, listRuns, type PlaybookRunView } from "@/lib/playbooks/store";
import { getTenantContext, type TenantContext } from "@/lib/tenancy/context";

const EARLIER = 5; // older runs listed under each playbook
// Runs fetched for the page, newest first across all playbooks: enough that a playbook run many times doesn't push another
// playbook's latest run off the list (listRuns caps it at 100).
const FETCH = 60;

async function loadTenant(): Promise<TenantContext | null> {
  try {
    return await getTenantContext();
  } catch {
    return null;
  }
}

export default async function PlaybooksPage() {
  const ctx = await loadTenant();
  const description = "Saved reviews the agent runs on this brand's synced data. Every figure in a write-up is checked against the data, and a run with a figure that can't be matched is marked blocked.";
  if (!ctx) {
    return (
      <section>
        <PageHeader title="Playbooks" description={description} />
        <ErrorBanner code="FORBIDDEN" role="client_viewer" />
      </section>
    );
  }
  if (!canRunPlaybooks(ctx)) {
    return (
      <section>
        <PageHeader title="Playbooks" description={description} />
        <div className="card card-pad flex items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-paper-2 text-ink-2">
            <Lock className="size-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="font-medium">Growth Capital roles only</p>
            <p className="muted mt-0.5 text-sm">Ask your Growth Capital contact for a review of this store.</p>
          </div>
        </div>
      </section>
    );
  }

  let runs: PlaybookRunView[] = [];
  let failed = false;
  try {
    runs = await listRuns(getDb(), ctx, FETCH);
  } catch {
    failed = true;
  }
  if (failed) {
    return (
      <section>
        <PageHeader title="Playbooks" description={description} />
        <ErrorBanner code="INTERNAL_ERROR" role={ctx.role} />
      </section>
    );
  }

  // listRuns is newest first, so each playbook's first entry is its latest run.
  const byPlaybook = new Map<PlaybookId, PlaybookRunView[]>();
  for (const r of runs) byPlaybook.set(r.playbook, [...(byPlaybook.get(r.playbook) ?? []), r]);
  const connected = ctx.shop?.status === "connected";
  const months = monthOptions(new Date());

  return (
    <section>
      <PageHeader title="Playbooks" description={description} />
      <ul className="space-y-6">
        {PLAYBOOKS.map((p) => {
          const [latest, ...older] = byPlaybook.get(p.id) ?? [];
          const headingId = `playbook-${p.id}`;
          return (
            <li key={p.id} className="card overflow-hidden" aria-labelledby={headingId}>
              <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line px-5 py-4 sm:px-6">
                <div className="min-w-0 max-w-[50ch]">
                  <h2 id={headingId} className="section-title">
                    {p.title}
                  </h2>
                  <p className="muted mt-1 text-sm">{p.description}</p>
                </div>
                <RunPlaybookButton playbook={p.id} title={p.title} hasRun={!!latest} disabled={!connected} months={p.takesMonth ? months : undefined} />
              </div>
              <div className="px-5 py-5 sm:px-6">
                {latest ? (
                  <PlaybookRun
                    run={latest}
                    title={p.title}
                    numbers={
                      connected ? (
                        <Suspense fallback={<NumbersSkeleton />}>
                          <PlaybookNumbers ctx={ctx} run={latest} />
                        </Suspense>
                      ) : undefined
                    }
                  />
                ) : (
                  <EmptyState icon={BookOpenCheck} title="Not run yet">
                    {connected ? "Run it to see the write-up here. It makes one AI call, so it runs only when you ask." : "Connect the store first, then run it."}
                  </EmptyState>
                )}
                {older.length > 0 ? (
                  <details className="mt-6 border-t border-line pt-4">
                    <summary className="muted cursor-pointer text-sm font-medium">Earlier runs ({Math.min(older.length, EARLIER)})</summary>
                    <div className="mt-4 space-y-6 divide-y divide-line">
                      {older.slice(0, EARLIER).map((r) => (
                        <div key={r.id} className="pt-6 first:pt-0">
                          <PlaybookRun run={r} title={p.title} />
                        </div>
                      ))}
                    </div>
                  </details>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
