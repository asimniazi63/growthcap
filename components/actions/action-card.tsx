"use client";

import { AlertTriangle, ArrowRight, Check, ChevronRight, Clock, Coins, FileCode, LayoutTemplate, Loader2, type LucideIcon, ShieldCheck, StickyNote, Target, TicketX, X } from "lucide-react";
import { type ReactNode, useState } from "react";
import { RefreshNow } from "@/components/overview/refresh-now";
import { useToast } from "@/components/ui/toast";
import type { LedgerView } from "@/lib/actions/ledger";
import type { ActionKind } from "@/lib/actions/types";
import { decisionFailure, decisionToast } from "@/lib/overview/messages";

type Status = LedgerView["status"];
type Mutation = { name: string; query: string; variables: unknown };

export const KIND_LABEL: Record<ActionKind, string> = {
  metric_target: "Plan target",
  annotation: "Calendar note",
  discount_deactivate: "Turn off a discount",
  landing_page: "Landing page",
  unit_cost_update: "Unit costs",
};

export const KIND_ICON: Record<ActionKind, LucideIcon> = {
  metric_target: Target,
  annotation: StickyNote,
  discount_deactivate: TicketX,
  landing_page: LayoutTemplate,
  unit_cost_update: Coins,
};

export const STATUS_LABEL: Record<Status, string> = {
  proposed: "Waiting for approval",
  approved: "Approved",
  running: "Running",
  done: "Done",
  failed: "Failed",
  rejected: "Rejected",
};

const STATUS_STYLE: Record<Status, string> = {
  proposed: "badge-warn",
  approved: "badge-brand",
  running: "badge-brand",
  done: "badge-ahead",
  failed: "badge-behind",
  rejected: "badge-behind",
};

const STATUS_ICON: Record<Status, LucideIcon> = {
  proposed: Clock,
  approved: Check,
  running: Loader2,
  done: Check,
  failed: AlertTriangle,
  rejected: X,
};

// Owners are Clerk user ids. Say "you" for the signed-in person and keep the end of anyone else's id.
export function personLabel(id: string | null | undefined, me?: string): string {
  if (!id) return "—";
  if (me && id === me) return "you";
  return id.length > 12 ? `user …${id.slice(-6)}` : id;
}

export function StatusBadge({ status, dryRun }: { status: Status; dryRun?: boolean }) {
  const Icon = STATUS_ICON[status];
  return (
    <span className={`badge ${STATUS_STYLE[status]} shrink-0 whitespace-nowrap`}>
      <Icon className={`size-3 ${status === "running" ? "motion-safe:animate-spin" : ""}`} aria-hidden />
      {STATUS_LABEL[status]}
      {dryRun && status === "done" ? " (dry run)" : ""}
    </span>
  );
}

const isMutation = (m: unknown): m is Mutation => Boolean(m) && typeof m === "object" && typeof (m as Mutation).name === "string" && typeof (m as Mutation).query === "string";

// The exact GraphQL a dry run recorded (or, failing that, what the diff says would run).
function mutationsOf(a: LedgerView): Mutation[] {
  const recorded = (a.result as { mutations?: unknown } | null | undefined)?.mutations;
  const list: unknown[] = Array.isArray(recorded) ? recorded : (a.diff.mutations ?? []);
  return list.filter(isMutation);
}

function pretty(value: unknown, max = 4000): string {
  let text: string;
  try {
    text = JSON.stringify(value, null, 2) ?? "null";
  } catch {
    text = "(not shown)";
  }
  return text.length > max ? `${text.slice(0, max)}\n…` : text;
}

// What a finished action did, in words. The raw result is for developers and is never shown: each kind says what changed.
function doneSummary(view: LedgerView): { headline: string; lines: string[] } {
  const result = (view.result ?? {}) as Record<string, unknown>;
  switch (view.kind) {
    case "unit_cost_update": {
      const updated = Array.isArray(result.updated) ? (result.updated as { sku?: unknown }[]) : [];
      const skus = new Set(updated.map((u) => String(u.sku ?? "")));
      const lines = (view.diff.rows ?? []).filter((r) => skus.has(r.label.split(":")[0] ?? "")).map((r) => `${r.label}: now ${r.after}`);
      return { headline: updated.length > 0 ? `Updated ${updated.length} unit cost${updated.length === 1 ? "" : "s"} in Shopify.` : "The unit costs were updated in Shopify.", lines };
    }
    case "metric_target":
      return { headline: "The target was created in Shopify.", lines: [] };
    case "annotation":
      return { headline: "The note was added to the store's charts in Shopify.", lines: [] };
    case "discount_deactivate": {
      const code = typeof result.code === "string" ? result.code : null;
      return { headline: code ? `The discount code ${code} is now off in Shopify.` : "The discount code is now off in Shopify.", lines: [] };
    }
    default:
      return { headline: "The change was made in Shopify.", lines: [] };
  }
}

// A dark, scrollable block for code the reviewer should read before approving: a Liquid file or the GraphQL that would run.
function CodeBlock({ title, children }: { title: string; children: string }) {
  return (
    <div className="overflow-hidden rounded-xl bg-inverse text-on-inverse">
      <p className="break-all border-b border-on-inverse/10 px-3 py-2 font-mono text-xs text-on-inverse/70">{title}</p>
      <pre className="max-h-72 overflow-auto px-3 py-3 font-mono text-xs leading-relaxed text-on-inverse">
        <code>{children}</code>
      </pre>
    </div>
  );
}

function Mutations({ list }: { list: Mutation[] }) {
  return (
    <div className="space-y-3">
      {list.map((m, i) => (
        <div key={i} className="overflow-hidden rounded-xl bg-inverse text-on-inverse">
          <p className="break-all border-b border-on-inverse/10 px-3 py-2 font-mono text-xs text-on-inverse/70">{m.name}</p>
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words px-3 py-3 font-mono text-xs leading-relaxed text-on-inverse">{m.query}</pre>
          <p className="border-t border-on-inverse/10 px-3 pt-2 text-xs text-on-inverse/60">Variables</p>
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words px-3 pb-3 pt-1 font-mono text-xs leading-relaxed text-on-inverse">{pretty(m.variables)}</pre>
        </div>
      ))}
    </div>
  );
}

// A collapsed section of the card: a quiet row that opens to show code or a long result.
function Fold({ icon: Icon, summary, children }: { icon: LucideIcon; summary: string; children: ReactNode }) {
  return (
    <details className="group rounded-xl border border-line bg-surface">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium text-ink [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-4 shrink-0 text-ink-3 transition-transform group-open:rotate-90" aria-hidden />
        <Icon className="size-4 shrink-0 text-ink-3" aria-hidden />
        {summary}
      </summary>
      <div className="space-y-3 border-t border-line p-3">{children}</div>
    </details>
  );
}

// Checks that ran. A note that says something failed or was missing gets a warning mark; the rest get a tick.
const WARNING = /\b(fail(ed|s|ure)?|warning|couldn'?t|could not|unable|missing|not found)\b/i;

const day = (iso?: string | null) => (iso ? iso.slice(0, 10) : "");
const on = (iso?: string | null) => (iso ? ` on ${day(iso)}` : "");

// A change the agent proposed. Nothing is sent to the store until a Growth Capital admin or partner approves it here, so the
// buttons are shown to them alone; anyone else sees that it is waiting. Everything on the card is text, never HTML.
export function ActionCard({ action, canDecide, me, onChange }: { action: LedgerView; canDecide: boolean; me?: string; onChange?: (next: LedgerView) => void }) {
  const [view, setView] = useState<LedgerView>(action);
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [problem, setProblem] = useState("");
  const toast = useToast();
  const [refreshes, setRefreshes] = useState(0);

  async function decide(decision: "approve" | "reject") {
    setBusy(decision);
    setProblem("");
    const res = await fetch(`/api/actions/${view.id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ decision }) }).catch(() => null);
    setBusy(null);
    if (res?.ok) {
      const body = (await res.json().catch(() => null)) as { action?: LedgerView } | null;
      if (body?.action) {
        setView(body.action);
        onChange?.(body.action);
        const { message, tone } = decisionToast(decision, body.action);
        toast.show(message, tone);
        setRefreshes((n) => n + 1); // read the page again so the sidebar count of changes waiting for approval updates
        return;
      }
    }
    const body = (await res?.json().catch(() => null)) as { message?: unknown } | null | undefined;
    setProblem(decisionFailure(res?.status, body));
  }

  const { diff } = view;
  const dryRun = view.dryRun && view.status === "done";
  const preview = !dryRun && diff.mutations && diff.mutations.length > 0 ? diff.mutations : null;
  const KindIcon = KIND_ICON[view.kind] ?? FileCode;
  const rows = diff.rows ?? [];
  const hasBefore = rows.some((r) => r.before !== undefined);
  const afterLabel = view.status === "proposed" ? "After approval" : view.status === "rejected" ? "Proposed" : "After";
  const written = (view.result as { written?: boolean } | null | undefined)?.written;
  const decided = view.status === "approved" || view.status === "running" || view.status === "done" || view.status === "failed" || view.status === "rejected";

  return (
    <article className="card @container overflow-hidden">
      {refreshes > 0 ? <RefreshNow key={refreshes} /> : null}
      <div className="space-y-4 p-4 @md:p-5">
        <header className="flex items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-brand-tint text-brand-strong">
            <KindIcon className="size-[18px]" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
              <h3 className="min-w-0 break-words font-display text-[1.0625rem] font-semibold leading-snug text-ink">{view.title}</h3>
              <StatusBadge status={view.status} dryRun={view.dryRun} />
            </div>
            <p className="faint mt-0.5 text-sm">{KIND_LABEL[view.kind] ?? view.kind}</p>
          </div>
        </header>

        <p className="text-[0.9375rem] text-ink">{diff.summary}</p>

        {rows.length > 0 && hasBefore ? (
          <ul className="space-y-3">
            {rows.map((r, i) => (
              <li key={i}>
                <p className="text-sm font-medium text-ink">{r.label}</p>
                <div className="mt-1.5 grid gap-2 @md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] @md:items-stretch">
                  <div className="inset px-3 py-2">
                    <p className="faint text-xs">Now</p>
                    <p className="num mt-0.5 break-words text-sm text-ink-2">{r.before ?? "—"}</p>
                  </div>
                  <ArrowRight className="size-4 shrink-0 justify-self-center text-ink-3 @md:self-center rotate-90 @md:rotate-0" aria-hidden />
                  <div className="rounded-xl border border-l-[3px] border-brand/20 border-l-brand bg-brand-tint/60 px-3 py-2">
                    <p className="text-xs text-brand-strong">{afterLabel}</p>
                    <p className="num mt-0.5 break-words text-sm font-medium text-ink">{r.after}</p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
        {rows.length > 0 && !hasBefore ? (
          <dl className="inset divide-y divide-line px-3">
            {rows.map((r, i) => (
              <div key={i} className="flex flex-wrap justify-between gap-x-4 gap-y-0.5 py-2 text-sm">
                <dt className="text-ink-2">{r.label}</dt>
                <dd className="num min-w-0 break-words font-medium text-ink">{r.after}</dd>
              </div>
            ))}
          </dl>
        ) : null}

        {diff.files && diff.files.length > 0 ? (
          <Fold icon={FileCode} summary={`${diff.files.length === 1 ? "1 file" : `${diff.files.length} files`} that would be written`}>
            {diff.files.map((f, i) => (
              <CodeBlock key={i} title={f.path}>
                {f.content}
              </CodeBlock>
            ))}
          </Fold>
        ) : null}

        {diff.notes && diff.notes.length > 0 ? (
          <ul className="space-y-1.5 text-sm text-ink-2">
            {diff.notes.map((n, i) => {
              const warn = WARNING.test(n);
              const Icon = warn ? AlertTriangle : Check;
              return (
                <li key={i} className="flex items-start gap-2">
                  <Icon className={`mt-0.5 size-4 shrink-0 ${warn ? "text-warn" : "text-ahead"}`} aria-hidden />
                  <span className="min-w-0 break-words">{n}</span>
                </li>
              );
            })}
          </ul>
        ) : null}

        {preview ? (
          <Fold icon={FileCode} summary="The GraphQL that would run">
            <Mutations list={preview} />
          </Fold>
        ) : null}

        <dl className="grid grid-cols-[4.75rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 border-t border-line pt-4 text-sm">
          <dt className="faint">Why</dt>
          <dd className="muted break-words">{view.hypothesis}</dd>
          <dt className="faint">Metric</dt>
          <dd className="muted break-words">{view.metric}</dd>
          <dt className="faint">Check on</dt>
          <dd className="muted num">{view.checkOn}</dd>
        </dl>

        {view.status === "running" || view.status === "approved" ? (
          <p className="flex items-center gap-2 text-sm text-brand-strong">
            <Loader2 className="size-4 shrink-0 motion-safe:animate-spin" aria-hidden />
            Approved. Running now.
          </p>
        ) : null}
        {view.status === "rejected" ? (
          <p className="muted flex items-center gap-2 text-sm">
            <X className="size-4 shrink-0 text-ink-3" aria-hidden />
            Rejected. Nothing was changed.
          </p>
        ) : null}
        {view.status === "failed" ? (
          <p role="alert" className="flex items-start gap-2 rounded-xl bg-behind-tint px-3 py-2.5 text-sm text-behind">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span className="min-w-0 break-words">{`Failed: ${view.error ?? "The change did not go through."}`}</span>
          </p>
        ) : null}
        {view.status === "done" && !dryRun ? (
          <div className="space-y-3 text-sm">
            {written === false ? (
              <div role="status" className="flex items-start gap-2 rounded-xl border border-warn/25 bg-warn-tint px-3 py-2.5 text-warn">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                <div className="min-w-0 space-y-1">
                  <p className="font-medium">Approved by {personLabel(view.decidedBy, me)}, but not written to the theme.</p>
                  <p>{String((view.result as { reason?: string }).reason ?? "")}</p>
                  <p className="break-words font-mono text-xs">{String((view.result as { finishByHand?: string }).finishByHand ?? "")}</p>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="flex items-center gap-2 font-medium text-ahead">
                  <Check className="size-4 shrink-0" aria-hidden />
                  {`Done. ${doneSummary(view).headline}`}
                </p>
                {doneSummary(view).lines.length > 0 ? (
                  <ul className="inset divide-y divide-line text-sm">
                    {doneSummary(view).lines.map((line) => (
                      <li key={line} className="num break-words px-3 py-2 text-ink-2">
                        {line}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            )}
          </div>
        ) : null}
        {dryRun ? (
          <div className="space-y-3">
            <div className="flex items-start gap-2 rounded-xl border border-warn/25 bg-warn-tint px-3 py-2.5 text-sm text-warn">
              <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
              <div className="min-w-0">
                <p className="font-medium">Dry run: nothing was sent to Shopify</p>
                <p className="mt-0.5">Approved by {personLabel(view.decidedBy, me)} on a reviewer login. This is the exact change that would have been sent.</p>
              </div>
            </div>
            <Fold icon={FileCode} summary="The exact Shopify request">
              <Mutations list={mutationsOf(view)} />
            </Fold>
          </div>
        ) : null}
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-t border-line bg-paper/70 px-4 py-3 @md:px-5">
        <p className="faint flex min-w-[12rem] flex-1 items-start gap-2 text-xs leading-relaxed">
          <Clock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span className="min-w-0 break-words">
            {`Proposed by ${personLabel(view.owner, me)}${on(view.createdAt)}`}
            {decided && view.status !== "failed" ? ` · ${view.status === "rejected" ? "Rejected" : "Approved"} by ${personLabel(view.decidedBy, me)}${on(view.decidedAt)}` : ""}
          </span>
        </p>
        {view.status === "proposed" ? (
          canDecide ? (
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" disabled={busy !== null} onClick={() => decide("approve")} className="btn btn-primary btn-sm">
                {busy === "approve" ? <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden /> : <Check className="size-4" aria-hidden />}
                {busy === "approve" ? "Approving…" : "Approve"}
              </button>
              <button type="button" disabled={busy !== null} onClick={() => decide("reject")} className="btn btn-secondary btn-sm">
                {busy === "reject" ? <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden /> : <X className="size-4" aria-hidden />}
                {busy === "reject" ? "Rejecting…" : "Reject"}
              </button>
            </div>
          ) : (
            <p className="muted text-xs">Waiting for a Growth Capital admin or partner to approve it.</p>
          )
        ) : null}
        {problem ? (
          <p role="alert" className="flex basis-full items-start gap-2 text-sm text-behind">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            {problem}
          </p>
        ) : null}
      </footer>
    </article>
  );
}
