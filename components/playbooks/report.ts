// Turns the saved write-up of the Black Friday review, the Retention check or the Monthly business review into sections for the page.
// Each of those questions asks for a few short paragraphs that each start with a bold lead-in, so the write-up is read paragraph by
// paragraph: a bold line first, on its own, is the title (the period the review covers); a paragraph that starts with a bold lead-in
// is a section, its lead-in the heading; a paragraph with no lead-in belongs to the section above it.
// It never invents or drops a word: the lead-in becomes the heading, the stop or dash after it is taken off, and everything else is kept
// as written (a bold phrase inside a paragraph keeps its ** markers, which the page turns into bold). A write-up that does not look like
// a report returns null, and the page shows it as plain text.
import { paragraphs } from "./format";

export interface ReportSection {
  heading: string | null; // null only for an opening paragraph with no lead-in
  paragraphs: string[];
  takeaway: boolean; // the closing "what to watch / do next" section, drawn as a callout
}

export interface ReportParsed {
  title: string | null;
  sections: ReportSection[];
}

const MAX_HEADING = 90; // longer than this, a bold start is part of the sentence, not a lead-in
const MIN_HEADED = 2; // fewer headed sections than this and the page shows plain text
const TAKEAWAY = /\b(?:watch|next|to do|to check|action)/i;

const TITLE = /^\*\*([^*\n]+)\*\*$/; // a paragraph that is one bold line
const LEAD = /^\*\*([^*]+?)\*\*([\s\S]*)$/; // **Lead-in.** text, **Lead-in** — text, **Lead-in**: text
const AFTER_LEAD = /^\s*(?:[:.]|[–—-](?=\s|$))?\s*/; // the stop, colon or dash that follows a lead-in, and the space after it

function lead(paragraph: string): { heading: string; text: string } | null {
  const m = LEAD.exec(paragraph);
  if (!m) return null;
  const heading = m[1]!.trim().replace(/[\s.:]+$/, "");
  if (heading === "" || heading.length > MAX_HEADING) return null;
  return { heading, text: m[2]!.replace(AFTER_LEAD, "").trim() };
}

export function parseReport(body: string): ReportParsed | null {
  let title: string | null = null;
  const sections: ReportSection[] = [];
  let pending: string | null = null; // a bold line on its own, waiting for the paragraph below it

  const flushPending = () => {
    if (pending !== null) sections.push({ heading: pending, paragraphs: [], takeaway: false });
    pending = null;
  };

  for (const paragraph of paragraphs(body)) {
    const alone = TITLE.exec(paragraph);
    if (alone) {
      const text = alone[1]!.trim();
      if (title === null && sections.length === 0 && pending === null) {
        title = text;
      } else {
        flushPending();
        pending = text.replace(/[\s.:]+$/, "");
      }
      continue;
    }
    const found = lead(paragraph);
    if (found) {
      flushPending();
      sections.push({ heading: found.heading, paragraphs: found.text === "" ? [] : [found.text], takeaway: false });
    } else if (pending !== null) {
      sections.push({ heading: pending, paragraphs: [paragraph], takeaway: false });
      pending = null;
    } else if (sections.length > 0) {
      sections[sections.length - 1]!.paragraphs.push(paragraph);
    } else {
      sections.push({ heading: null, paragraphs: [paragraph], takeaway: false });
    }
  }
  flushPending();

  if (sections.filter((s) => s.heading !== null).length < MIN_HEADED) return null;
  const last = sections[sections.length - 1]!;
  if (last.heading !== null && TAKEAWAY.test(last.heading)) last.takeaway = true;
  return { title, sections };
}
