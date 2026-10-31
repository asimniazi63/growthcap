"use client";

import { AlertTriangle, CalendarClock, Check, ChevronRight, Loader2, NotebookText, Quote, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useToast } from "@/components/ui/toast";
import { METRICS } from "@/lib/metrics/registry";
import { formatValue, monthName } from "@/lib/pace/format";
import type { CallNoteReview } from "@/lib/call-notes/store";

const dayLabel = (ymd: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${ymd}T00:00:00Z`));

// One call note waiting for a decision. It lists what the note would change in the plan (from what to what, with the sentence it
// came from) and the action items it would add, each with a checkbox. Nothing is applied until Confirm. Every string shown came
// from the note, so it is only ever rendered as text.
export function CallNoteReviewCard({ note, currency }: { note: CallNoteReview; currency: string }) {
  const router = useRouter();
  const toast = useToast();
  const [changes, setChanges] = useState<Set<number>>(() => new Set(note.planChanges.map((c) => c.index)));
  const [items, setItems] = useState<Set<number>>(() => new Set(note.actionItems.map((a) => a.index)));
  const [busy, setBusy] = useState<"confirm" | "discard" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const toggle = (set: Set<number>, put: (s: Set<number>) => void, i: number) => {
    const next = new Set(set);
    if (next.has(i)) next.delete(i);
    else next.add(i);
    put(next);
  };
  const chosen = changes.size + items.size;

  async function decide(action: "confirm" | "discard") {
    setBusy(action);
    setError(null);
    const body = action === "confirm" ? { action, planChanges: [...changes], actionItems: [...items] } : { action };
    const res = await fetch(`/api/call-notes/${note.id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    if (res?.ok) {
      const done = (await res.json().catch(() => null)) as { planChanges?: number; actionItems?: number } | null;
      toast.show(
        action === "discard"
          ? "Call note discarded. Nothing was changed."
          : `Confirmed: ${done?.planChanges ?? 0} plan change${done?.planChanges === 1 ? "" : "s"}, ${done?.actionItems ?? 0} action item${done?.actionItems === 1 ? "" : "s"}.`,
      );
      router.refresh();
    } else {
      const detail = (await res?.json().catch(() => null)) as { message?: string } | null;
      setError(res?.status === 404 ? "That call note was already decided." : (detail?.message ?? "That didn't work. Try again."));
      if (res?.status === 404) router.refresh();
    }
    setBusy(null);
  }

  return (
    <article className="card overflow-hidden">
      <div className="card-pad">
        <header className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
          <div className="flex min-w-0 items-start gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-brand-tint text-brand-strong">
              <NotebookText className="size-[18px]" aria-hidden />
            </span>
            <div className="min-w-0">
              <h3 className="break-words font-display text-[1.0625rem] font-semibold leading-snug text-ink">{note.title}</h3>
              <p className="faint mt-0.5 text-sm">
                Call held <span className="num">{dayLabel(note.heldOn)}</span>
              </p>
            </div>
          </div>
          <span className="badge badge-brand">Waiting for review</span>
        </header>

        <section className="mt-4" aria-label="Plan changes">
          <h4 className="text-sm font-medium text-ink">Plan changes</h4>
          {note.planChanges.length === 0 ? (
            <p className="muted mt-1 text-sm">No plan targets were found in this note.</p>
          ) : (
            <ul className="mt-2 divide-y divide-line rounded-xl border border-line">
              {note.planChanges.map((c) => {
                const id = `${note.id}-change-${c.index}`;
                return (
                  <li key={c.index} className="flex items-start gap-3 px-3.5 py-3">
                    <input id={id} type="checkbox" className="mt-1 size-4 shrink-0 accent-brand" checked={changes.has(c.index)} disabled={busy !== null} onChange={() => toggle(changes, setChanges, c.index)} />
                    <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer">
                      <span className="block text-sm font-medium text-ink">
                        {METRICS[c.metric].label}, {monthName(c.month)}
                      </span>
                      <span className="num mt-0.5 block text-sm text-ink-2">
                        {c.current === null ? "no target now" : formatValue(c.metric, c.current, currency)} to <span className="font-medium text-ink">{formatValue(c.metric, c.proposed, currency)}</span>
                        {c.current === c.proposed ? <span className="ml-1 font-sans text-ink-3">(no change)</span> : null}
                      </span>
                      <span className="mt-1 flex items-start gap-1.5 text-sm text-ink-3">
                        <Quote className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                        <span className="min-w-0">{c.quote}</span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="mt-5" aria-label="Action items">
          <h4 className="text-sm font-medium text-ink">Action items</h4>
          {note.actionItems.length === 0 ? (
            <p className="muted mt-1 text-sm">No action items were found in this note.</p>
          ) : (
            <ul className="mt-2 divide-y divide-line rounded-xl border border-line">
              {note.actionItems.map((a) => {
                const id = `${note.id}-item-${a.index}`;
                return (
                  <li key={a.index} className="flex items-start gap-3 px-3.5 py-3">
                    <input id={id} type="checkbox" className="mt-1 size-4 shrink-0 accent-brand" checked={items.has(a.index)} disabled={busy !== null} onChange={() => toggle(items, setItems, a.index)} />
                    <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer">
                      <span className="block break-words text-sm font-medium text-ink">{a.title}</span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-x-4 gap-y-0.5 text-sm text-ink-2">
                        <span className="inline-flex items-center gap-1.5">
                          <UserRound className="size-3.5 text-ink-3" aria-hidden />
                          {a.owner}
                        </span>
                        <span className="inline-flex items-center gap-1.5">
                          <CalendarClock className="size-3.5 text-ink-3" aria-hidden />
                          {a.dueOn ? <span className="num">Due {dayLabel(a.dueOn)}</span> : "No due date"}
                        </span>
                      </span>
                      <span className="mt-1 flex items-start gap-1.5 text-sm text-ink-3">
                        <Quote className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                        <span className="min-w-0">{a.quote}</span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {note.unapplied.length > 0 ? (
          <div className="mt-4 rounded-xl border border-warn/25 bg-warn-tint/60 px-3.5 py-3">
            <h4 className="flex items-center gap-2 text-sm font-medium text-warn">
              <AlertTriangle className="size-4 shrink-0" aria-hidden />
              Found, but not applied
            </h4>
            <ul className="mt-1.5 space-y-1.5 text-sm text-ink-2">
              {note.unapplied.map((u, i) => (
                <li key={i}>
                  {u.sentence}: {u.reason}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {note.unverified.length > 0 ? (
          <details className="group mt-3 text-sm text-ink-3">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 [&::-webkit-details-marker]:hidden">
              <ChevronRight className="size-4 shrink-0 transition-transform group-open:rotate-90" aria-hidden />
              {note.unverified.length} statement{note.unverified.length === 1 ? "" : "s"} ignored: the quote was not found in the note
            </summary>
            <ul className="mt-1.5 list-disc space-y-0.5 pl-9">
              {note.unverified.map((u, i) => (
                <li key={i}>{u.sentence}</li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>

      <footer className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line bg-paper/70 px-5 py-3">
        <button type="button" disabled={busy !== null} onClick={() => decide("confirm")} className="btn btn-primary btn-sm">
          {busy === "confirm" ? <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden /> : <Check className="size-4" aria-hidden />}
          {chosen === 0 ? "Save the note only" : "Confirm selected"}
        </button>
        <button type="button" disabled={busy !== null} onClick={() => decide("discard")} className="btn btn-ghost btn-sm">
          Discard
        </button>
        <span className="faint min-w-[12rem] flex-1 text-sm">
          Confirming saves the note, adds the ticked action items and replaces the plan that Pace and the agent use with a new version. The current plan is kept.
        </span>
      </footer>
      {error ? (
        <p role="alert" className="flex items-start gap-2 border-t border-line px-5 py-3 text-sm text-behind">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          {error}
        </p>
      ) : null}
    </article>
  );
}
