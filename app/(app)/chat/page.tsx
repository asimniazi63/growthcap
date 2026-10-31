import { ChevronDown, Info, TriangleAlert } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { ChatClient } from "@/components/chat/chat-client";
import { ErrorBanner } from "@/components/chat/error-banner";
import { NotesPanel } from "@/components/chat/notes-panel";
import { SUGGESTED_QUESTIONS } from "@/components/chat/suggestions";
import { budgetStatus } from "@/lib/agent/budget";
import { availableModels, defaultModelId } from "@/lib/agent/models";
import { isDemoClock } from "@/lib/clock";
import { getDb } from "@/lib/db/client";
import { listMemories } from "@/lib/memory/store";
import { METRIC_IDS, METRICS } from "@/lib/metrics/registry";
import { getTenantContext, type TenantContext } from "@/lib/tenancy/context";
import { loadWindow } from "@/lib/tools/common";

async function loadTenant(): Promise<TenantContext | null> {
  try {
    return await getTenantContext();
  } catch {
    return null;
  }
}

export default async function ChatPage({ searchParams }: { searchParams: Promise<{ q?: string | string[] }> }) {
  // /chat?q=... asks that question when the page opens (the command palette and the Overview links use it). The text is only ever a user question.
  const { q } = await searchParams;
  const initialQuestion = Array.isArray(q) ? q[0] : q;
  const ctx = await loadTenant();
  if (!ctx) {
    return (
      <section>
        <PageHeader title="Chat" />
        <ErrorBanner code="FORBIDDEN" role="client_viewer" />
      </section>
    );
  }

  const connected = ctx.shop?.status === "connected";
  const db = getDb();
  const [win, budget, notes] = await Promise.all([
    loadWindow(db, ctx.tenantId).catch(() => null),
    budgetStatus(ctx.tenantId, { db }).catch(() => null),
    listMemories(db, ctx.tenantId).catch(() => []),
  ]);
  const demoThrough = connected && ctx.shop && win?.last && isDemoClock(ctx.shop.timezone, win.newest) ? win.last : null;
  const models = availableModels().map((m) => ({ id: m.id, label: m.label }));

  return (
    <div className="space-y-8">
      {/* On large screens the chat fills the screen height inside the page padding; the notes and metric definitions sit below it. */}
      <section className="flex min-h-0 flex-col gap-4 lg:h-[calc(100dvh-5rem)]">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h1 className="page-title text-2xl">Chat</h1>
          <p className="muted text-sm">Ask questions about this brand&apos;s Shopify data. Every number is checked against the store before you see it.</p>
        </div>

        {demoThrough ? (
          <p role="status" className="flex items-start gap-2.5 rounded-xl border border-brand/20 bg-brand-tint px-4 py-2.5 text-sm text-brand-strong">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>Demo data through {demoThrough}. &quot;Today&quot; and &quot;last month&quot; are counted as if it were the day after.</span>
          </p>
        ) : null}
        {budget?.warn && !budget.exceeded ? (
          <p role="status" className="flex items-start gap-2.5 rounded-xl border border-warn/30 bg-warn-tint px-4 py-2.5 text-sm text-ink">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden />
            <span>This brand has used {Math.round((budget.spentUsd / budget.capUsd) * 100)}% of today&apos;s AI budget.</span>
          </p>
        ) : null}
        {!connected ? <ErrorBanner code="STORE_DISCONNECTED" role={ctx.role} /> : null}

        <ChatClient role={ctx.role} models={models} defaultModelId={defaultModelId("chat")} suggestions={SUGGESTED_QUESTIONS} currency={ctx.shop?.currency ?? "USD"} userId={ctx.userId} initialQuestion={initialQuestion} />
      </section>

      <NotesPanel notes={notes.filter((n) => n.status !== "dismissed").map((n) => ({ id: n.id, text: n.text, status: n.status === "confirmed" ? ("confirmed" as const) : ("proposed" as const) }))} role={ctx.role} />

      <details className="card group text-sm">
        <summary className="flex cursor-pointer list-none items-center gap-2.5 rounded-2xl px-5 py-4 font-medium [&::-webkit-details-marker]:hidden">
          What the metrics mean
          <ChevronDown className="ml-auto size-4 text-ink-3 transition-transform group-open:rotate-180" aria-hidden />
        </summary>
        <dl className="divide-y divide-line border-t border-line px-5">
          {METRIC_IDS.map((id) => (
            <div key={id} className="py-3">
              <dt className="flex flex-wrap items-center gap-2 font-medium">
                {METRICS[id].label} <span className="badge font-mono text-[0.6875rem] font-medium">{id}</span>
              </dt>
              <dd className="muted mt-1 max-w-[70ch]">{METRICS[id].definition}</dd>
            </div>
          ))}
        </dl>
      </details>
    </div>
  );
}
