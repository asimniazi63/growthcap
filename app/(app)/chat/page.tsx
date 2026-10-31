import { ChatClient } from "@/components/chat/chat-client";
import { ErrorBanner } from "@/components/chat/error-banner";
import { SUGGESTED_QUESTIONS } from "@/components/chat/suggestions";
import { budgetStatus } from "@/lib/agent/budget";
import { availableModels, defaultModelId } from "@/lib/agent/models";
import { isDemoClock } from "@/lib/clock";
import { getDb } from "@/lib/db/client";
import { CORE_METRIC_IDS, METRICS } from "@/lib/metrics/registry";
import { getTenantContext, type TenantContext } from "@/lib/tenancy/context";
import { loadWindow } from "@/lib/tools/common";

async function loadTenant(): Promise<TenantContext | null> {
  try {
    return await getTenantContext();
  } catch {
    return null;
  }
}

export default async function ChatPage() {
  const ctx = await loadTenant();
  if (!ctx) {
    return (
      <section className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">Chat</h1>
        <ErrorBanner code="FORBIDDEN" role="client_viewer" />
      </section>
    );
  }

  const connected = ctx.shop?.status === "connected";
  const db = getDb();
  const [win, budget] = await Promise.all([loadWindow(db, ctx.tenantId).catch(() => null), budgetStatus(ctx.tenantId, { db }).catch(() => null)]);
  const demoThrough = connected && ctx.shop && win?.last && isDemoClock(ctx.shop.timezone, win.newest) ? win.last : null;
  const models = availableModels().map((m) => ({ id: m.id, label: m.label }));

  return (
    <section className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Chat</h1>
        <p className="mt-1 text-sm text-neutral-600">Ask questions about this brand&apos;s Shopify data. Every number is checked against the store before you see it.</p>
      </div>

      {demoThrough ? (
        <p role="status" className="rounded-md border border-sky-200 bg-sky-50 px-4 py-2 text-sm text-sky-900">
          Demo data through {demoThrough}. &quot;Today&quot; and &quot;last month&quot; are counted as if it were the day after.
        </p>
      ) : null}
      {budget?.warn && !budget.exceeded ? (
        <p role="status" className="rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          This brand has used {Math.round((budget.spentUsd / budget.capUsd) * 100)}% of today&apos;s AI budget.
        </p>
      ) : null}
      {!connected ? <ErrorBanner code="STORE_DISCONNECTED" role={ctx.role} /> : null}

      <ChatClient role={ctx.role} models={models} defaultModelId={defaultModelId("chat")} suggestions={SUGGESTED_QUESTIONS} />

      <details className="rounded-lg border border-neutral-200 bg-white px-4 py-3 text-sm">
        <summary className="cursor-pointer font-medium">What the metrics mean</summary>
        <dl className="mt-3 space-y-3">
          {CORE_METRIC_IDS.map((id) => (
            <div key={id}>
              <dt className="font-medium">
                {METRICS[id].label} <span className="font-mono text-xs text-neutral-500">{id}</span>
              </dt>
              <dd className="text-neutral-600">{METRICS[id].definition}</dd>
            </div>
          ))}
        </dl>
      </details>
    </section>
  );
}
