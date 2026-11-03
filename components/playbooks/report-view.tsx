import { CalendarDays, Lightbulb } from "lucide-react";
import { Fragment } from "react";
import { segments } from "./format";
import type { ReportParsed } from "./report";

// The write-up of the Black Friday review, the Retention check or the Monthly business review (layer A of the Playbooks page) drawn as a
// short report: the period on top, then one numbered card per paragraph with its lead-in as the heading, and the closing "what to watch"
// paragraph set apart as a note. Every word on the page is the model's own: the parser took out nothing but the bold markers and the
// stop or dash after a lead-in. No markup comes from the text, so there is no raw HTML here.

// Money and percentages are worth the eye ($2,083.00, 275.2%). Counts, dates and years are left plain, so a paragraph stays calm. Not
// part of a word or a code ("Q4", "SKU-123"): the lookbehind and lookahead keep those out.
const KEY_FIGURE = /(?<![\w.-])(?:\$\d[\d,]*(?:\.\d+)?%?|\d[\d,]*(?:\.\d+)?%)(?![\w-])/g;

export interface KeyFigureSegment {
  text: string;
  figure: boolean;
}

// The text cut into plain stretches and key figures, in order, so joining the pieces gives back exactly the text.
export function keyFigureSegments(text: string): KeyFigureSegment[] {
  const out: KeyFigureSegment[] = [];
  let last = 0;
  for (const m of text.matchAll(KEY_FIGURE)) {
    // The pattern lets a comma into a number ("$2,083"), so a comma that only ends a list item rides along; it goes back to the text.
    const figure = m[0].replace(/,+$/, "");
    if (m.index > last) out.push({ text: text.slice(last, m.index), figure: false });
    out.push({ text: figure, figure: true });
    last = m.index + figure.length;
  }
  if (last < text.length) out.push({ text: text.slice(last), figure: false });
  return out;
}

// `onTint` is for text on a coloured box, where a brand-tinted chip would clash.
function Figures({ text, onTint = false }: { text: string; onTint?: boolean }) {
  return (
    <>
      {keyFigureSegments(text).map((s, i) =>
        s.figure ? (
          <span key={i} className={`-mx-0.5 rounded px-0.5 font-semibold tabular-nums text-ink ${onTint ? "bg-surface/70" : "bg-brand-tint/60"}`}>
            {s.text}
          </span>
        ) : (
          <Fragment key={i}>{s.text}</Fragment>
        ),
      )}
    </>
  );
}

// A paragraph: its bold phrases drawn bold (the one piece of markup a write-up has), its key figures highlighted.
function Paragraph({ text, onTint = false }: { text: string; onTint?: boolean }) {
  return (
    <p className="mt-1.5 max-w-[68ch] whitespace-pre-line text-[0.9375rem] leading-7 text-ink-2">
      {segments(text).map((s, i) => (s.bold ? <strong key={i}><Figures text={s.text} onTint={onTint} /></strong> : <Figures key={i} text={s.text} onTint={onTint} />))}
    </p>
  );
}

// `parsed` comes from parseReport. Server-compatible: there is no state and no client component here.
export function ReportView({ parsed }: { parsed: ReportParsed }) {
  const { title, sections } = parsed;
  const intro = sections.filter((s) => s.heading === null);
  const headed = sections.filter((s) => s.heading !== null);
  return (
    <div className="max-w-3xl space-y-4">
      {title ? (
        <div className="flex items-start gap-3">
          <span aria-hidden className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-brand-tint text-brand-strong">
            <CalendarDays className="size-4" />
          </span>
          <p className="min-w-0 text-base font-medium leading-8 text-ink">{title}</p>
        </div>
      ) : null}
      {intro.flatMap((s) => s.paragraphs).map((p, i) => (
        <p key={i} className="max-w-[68ch] whitespace-pre-line text-[0.9375rem] leading-7 text-ink-2">
          {segments(p).map((s, j) => (s.bold ? <strong key={j}>{s.text}</strong> : s.text))}
        </p>
      ))}
      <ol aria-label="Report sections" className="space-y-3">
        {headed.map((section, i) =>
          section.takeaway ? (
            <li key={`${i}-${section.heading}`}>
              <div role="note" className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-x-4 rounded-2xl border border-brand/25 bg-brand-tint px-5 py-4 sm:px-6">
                <Lightbulb className="mt-1 size-5 shrink-0 text-brand-strong" aria-hidden />
                <h3 className="text-base font-semibold leading-7 text-brand-strong">{section.heading}</h3>
                <div className="col-span-2 min-w-0 sm:col-span-1 sm:col-start-2">
                  {section.paragraphs.map((p, j) => (
                    <Paragraph key={j} text={p} onTint />
                  ))}
                </div>
              </div>
            </li>
          ) : (
            <li key={`${i}-${section.heading}`} className="card px-5 py-4 sm:px-6">
              <div className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-x-4">
                <span aria-hidden className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-brand-tint text-xs font-semibold text-brand-strong">
                  {i + 1}
                </span>
                <h3 className="text-base font-semibold leading-7 text-ink">{section.heading}</h3>
                <div className="col-span-2 min-w-0 sm:col-span-1 sm:col-start-2">
                  {section.paragraphs.map((p, j) => (
                    <Paragraph key={j} text={p} />
                  ))}
                </div>
              </div>
            </li>
          ),
        )}
      </ol>
    </div>
  );
}
