import { CheckCircle2, ShieldAlert } from "lucide-react";
import type { PlaybookRunView } from "@/lib/playbooks/store";
import { monthLabel, paragraphs, segments } from "./format";

const when = (d: Date) => new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(d) + " UTC";

// One saved run of a playbook. The write-up is model text, shown as text paragraphs: the only markup is a bold lead-in, no HTML.
// A blocked run lists the figures the number checker could not find in the data.
export function PlaybookRun({ run, title }: { run: PlaybookRunView; title: string }) {
  const blocked = run.status === "blocked";
  const text = paragraphs(run.body);
  return (
    <article aria-label={`${title}, run ${when(run.createdAt)}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
        <span className={`badge ${blocked ? "badge-behind" : "badge-ahead"}`}>
          {blocked ? <ShieldAlert className="size-3.5" aria-hidden /> : <CheckCircle2 className="size-3.5" aria-hidden />}
          {blocked ? "Blocked" : "Ready"}
        </span>
        <span className="muted">Ran {when(run.createdAt)}</span>
        {run.params.month ? <span className="muted">Month: {monthLabel(run.params.month)}</span> : null}
      </div>
      <div className="mt-4 max-w-[68ch] space-y-3 text-[0.9375rem] leading-7">
        {text.length > 0 ? (
          text.map((p, i) => (
            <p key={i} className="whitespace-pre-line">
              {segments(p).map((s, j) => (s.bold ? <strong key={j}>{s.text}</strong> : s.text))}
            </p>
          ))
        ) : (
          <p className="muted">This run has no write-up.</p>
        )}
      </div>
      {blocked ? (
        <div role="note" className="mt-5 flex items-start gap-3 rounded-xl bg-behind-tint px-4 py-3.5 text-sm text-behind">
          <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <div>
            <p className="font-semibold">Some figures could not be matched to the data, so treat this write-up as unchecked:</p>
            {run.unmatched.length > 0 ? (
              <ul className="mt-1.5 list-disc space-y-0.5 pl-5">
                {run.unmatched.map((u, i) => (
                  <li key={`${i}-${u}`}>{u}</li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
      ) : null}
    </article>
  );
}
