import { CheckCircle2, PenLine, ShieldAlert } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import type { PlaybookRunView } from "@/lib/playbooks/store";
import { parseCreativeBriefs } from "./creative-briefs";
import { CreativeBriefsView } from "./creative-briefs-view";
import { monthLabel, paragraphs, segments } from "./format";
import { parseReport } from "./report";
import { ReportView } from "./report-view";

const when = (d: Date) => new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(d) + " UTC";

// The link under a finished Creative briefs run (T23): it opens the chat with a fixed question, and the chat's draft_landing_page tool
// and its approval card take over from there. The chat cannot see the briefs, so the question names the campaign by the calendar and
// not by the write-up. The question is fixed text, so encoding it is all the escaping the address needs.
const DRAFT_LANDING_PAGE = `/chat?q=${encodeURIComponent("Draft a landing page for the next planned campaign.")}`;

// `numbers` is a slot for the live numbers drawn from the store data (layer B); the page fills it for the latest run only. This component
// just places them, under the Ready line and above the write-up, so it does no data loading of its own.
// One saved run of a playbook. The write-up is model text, shown as text paragraphs: the only markup is a bold lead-in, no HTML.
// A blocked run lists the figures the number checker could not find in the data, and offers no link: its write-up is unchecked.
// A finished Creative briefs write-up is drawn as three brief cards instead; a finished write-up of any other playbook is drawn as a short
// report (a numbered card per paragraph, the lead-in as its heading). A blocked one stays plain text, and so does any write-up the parser
// cannot read (it then returns null), so the layouts never hide or lose what the model wrote.
export function PlaybookRun({ run, title, numbers }: { run: PlaybookRunView; title: string; numbers?: ReactNode }) {
  const blocked = run.status === "blocked";
  const text = paragraphs(run.body);
  const cards = run.playbook === "creative-briefs" && !blocked ? parseCreativeBriefs(run.body) : null;
  const report = run.playbook !== "creative-briefs" && !blocked ? parseReport(run.body) : null;
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
      {numbers}
      {cards ? (
        <div className="mt-5">
          <CreativeBriefsView parsed={cards} />
        </div>
      ) : report ? (
        <div className="mt-5">
          <ReportView parsed={report} />
        </div>
      ) : (
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
      )}
      {run.playbook === "creative-briefs" && !blocked ? (
        <p className="mt-5">
          <Link href={DRAFT_LANDING_PAGE} className="btn btn-secondary btn-sm">
            <PenLine className="size-3.5" aria-hidden />
            Draft the campaign&apos;s landing page in chat
          </Link>
        </p>
      ) : null}
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
