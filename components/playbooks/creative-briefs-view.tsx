import { Ban, CalendarDays, History, ShieldCheck, Target, TriangleAlert, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { CopyButton } from "./copy-button";
import type { CreativeBrief, CreativeBriefsParsed } from "./creative-briefs-types";
import { segments } from "./format";

// The Creative briefs write-up (T23) drawn as three cards side by side instead of a wall of text. It draws the parts the parser told
// apart and nothing else: every word on the page is the model's own, and what the parser did not recognise is shown too (as extra rows
// or as the paragraphs under the cards). No markup comes from the text, so there is no raw HTML here.

const EYEBROW = "text-xs font-semibold uppercase tracking-wider";

// A number worth the eye: money ($331.43), a percentage (76.4%), a count or a decimal (53, 613.3). Not part of a word or a code
// ("Q4", "50ml", "SKU-123"). The lookbehind and lookahead are what keep those out.
const FIGURE = /(?<![\w.-])\$?\d[\d,]*(?:\.\d+)?%?(?![\w-])/g;

export interface FigureSegment {
  text: string;
  figure: boolean;
}

// The text cut into plain stretches and figures, in order, so joining the pieces gives back exactly the text.
export function figureSegments(text: string): FigureSegment[] {
  const out: FigureSegment[] = [];
  let last = 0;
  for (const m of text.matchAll(FIGURE)) {
    // The pattern lets a comma into a number ("1,234"), so a comma that only ends a list item ("2026, November") rides along. It
    // belongs to the sentence, so it goes back into the plain text.
    const figure = m[0].replace(/,+$/, "");
    if (m.index > last) out.push({ text: text.slice(last, m.index), figure: false });
    out.push({ text: figure, figure: true });
    last = m.index + figure.length;
  }
  if (last < text.length) out.push({ text: text.slice(last), figure: false });
  return out;
}

// A sentence end: full stop, exclamation or question mark, then a space. Not after "vs." or "e.g.", which sit in the middle of a sentence.
const SENTENCE_END = /(?<=[.!?])(?<!\b(?:vs|e\.g|i\.e|approx)\.)\s+/;
const MENTIONS_PROFIT = /margin|profit/i;

// An offer holds the deal and, often, the limit that keeps the deal profitable ("Taking 10% off would take the profit margin to
// 13.8%"). The sentences that talk about margin or profit are pulled out to be shown as a callout; the rest stays as the offer.
export function splitOffer(offer: string): { text: string; profitLimit: string | null } {
  const sentences = offer.trim().split(SENTENCE_END).filter((s) => s !== "");
  const limit = sentences.filter((s) => MENTIONS_PROFIT.test(s));
  if (limit.length === 0) return { text: offer.trim(), profitLimit: null };
  return { text: sentences.filter((s) => !MENTIONS_PROFIT.test(s)).join(" "), profitLimit: limit.join(" ") };
}

// Proof as bullets, but only when it cuts cleanly: at "; " first, then at sentence ends. One sentence with commas stays a paragraph.
function proofItems(proof: string): string[] | null {
  for (const parts of [proof.split(/;\s+/), proof.split(SENTENCE_END)]) {
    const items = parts.map((p) => p.trim().replace(/\.$/, "").replace(/^[a-z](?=[a-z\s])/, (c) => c.toUpperCase())).filter((p) => p !== "");
    if (items.length >= 2) return items;
  }
  return null;
}

const present = (s: string | null): s is string => s !== null && s.trim() !== "";

// The text with its figures on a faint highlight. `onTint` is for text that already sits on a coloured box, where a brand-tinted chip
// would clash, so the chip is a lighter patch of the surface colour instead.
function Figures({ text, onTint = false }: { text: string; onTint?: boolean }) {
  return (
    <>
      {figureSegments(text).map((s, i) =>
        s.figure ? (
          <span key={i} className={`-mx-0.5 rounded px-0.5 font-semibold tabular-nums text-ink ${onTint ? "bg-surface/70" : "bg-brand-tint/60"}`}>
            {s.text}
          </span>
        ) : (
          s.text
        ),
      )}
    </>
  );
}

// "Last year" (neutral) and "Not pushing" (a caution). The label names the box, so the colour is never the only signal.
function Callout({ icon: Icon, label, text, warn = false }: { icon: LucideIcon; label: string; text: string; warn?: boolean }) {
  return (
    <div role="note" className={`flex items-start gap-3 rounded-2xl border px-4 py-3.5 ${warn ? "border-warn/30 bg-warn-tint" : "border-line bg-paper-2"}`}>
      <Icon className={`mt-0.5 size-4.5 shrink-0 ${warn ? "text-warn" : "text-ink-3"}`} aria-hidden />
      <div className="min-w-0">
        <p className={`${EYEBROW} ${warn ? "text-warn" : "text-ink-3"}`}>{label}</p>
        <p className={`mt-1 text-sm leading-6 ${warn ? "text-warn" : "text-ink-2"}`}>
          <Figures text={text} onTint={warn} />
        </p>
      </div>
    </div>
  );
}

// One labelled part of a card. A description list is what this is: a name and its value, over and over.
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="px-5 py-4 sm:px-6">
      <dt className={`${EYEBROW} text-ink-3`}>{label}</dt>
      <dd className="mt-2 text-sm leading-6 text-ink">{children}</dd>
    </div>
  );
}

// A part that is empty or missing is left out, so a card never shows a label with nothing under it.
function rowsOf(brief: CreativeBrief): ReactNode[] {
  const rows: ReactNode[] = [];
  if (present(brief.product)) {
    rows.push(
      <Row key="product" label="Product">
        <p>
          <Figures text={brief.product} />
        </p>
      </Row>,
    );
  }
  if (present(brief.angle)) {
    rows.push(
      <Row key="angle" label="Angle">
        <p className="text-base font-medium leading-7">{`“${brief.angle}”`}</p>
        <div className="mt-2.5">
          <CopyButton text={brief.angle} label={`Copy angle: ${brief.angle}`} />
        </div>
      </Row>,
    );
  }
  const hooks = brief.hooks.filter((h) => h.trim() !== "");
  if (hooks.length > 0) {
    rows.push(
      <Row key="hooks" label="Hook lines">
        <ul className="space-y-2">
          {hooks.map((hook, i) => (
            <li key={`${i}-${hook}`} className="flex items-start justify-between gap-3 rounded-xl bg-paper-2 py-2 pl-3.5 pr-2.5">
              <span className="min-w-0 flex-1 py-0.5">{hook}</span>
              <CopyButton text={hook} label={`Copy hook line: ${hook}`} />
            </li>
          ))}
        </ul>
      </Row>,
    );
  }
  if (present(brief.offer)) {
    const offer = splitOffer(brief.offer);
    rows.push(
      <Row key="offer" label="Offer">
        {offer.text !== "" ? (
          <p>
            <Figures text={offer.text} />
          </p>
        ) : null}
        {offer.profitLimit ? (
          <div role="note" className={`flex items-start gap-2.5 rounded-xl border border-ahead/30 bg-ahead-tint px-3 py-2.5 ${offer.text !== "" ? "mt-3" : ""}`}>
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-ahead" aria-hidden />
            <div className="min-w-0">
              <p className={`${EYEBROW} text-ahead`}>Profit limit</p>
              <p className="mt-0.5">
                <Figures text={offer.profitLimit} onTint />
              </p>
            </div>
          </div>
        ) : null}
      </Row>,
    );
  }
  if (present(brief.proof)) {
    const items = proofItems(brief.proof);
    rows.push(
      <Row key="proof" label="Proof">
        {items ? (
          <ul className="list-disc space-y-1.5 pl-4 marker:text-ink-3">
            {items.map((item, i) => (
              <li key={`${i}-${item}`}>
                <Figures text={item} />
              </li>
            ))}
          </ul>
        ) : (
          <p>
            <Figures text={brief.proof} />
          </p>
        )}
      </Row>,
    );
  }
  if (present(brief.doNot)) {
    rows.push(
      <Row key="do-not" label="Do not">
        <div className="flex items-start gap-2.5 rounded-xl bg-behind-tint px-3 py-2.5 text-behind">
          <Ban className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p className="min-w-0">{brief.doNot}</p>
        </div>
      </Row>,
    );
  }
  if (present(brief.measure)) {
    rows.push(
      <Row key="measure" label="Measure">
        <p className="muted flex items-start gap-2">
          <Target className="mt-0.5 size-4 shrink-0 text-ink-3" aria-hidden />
          <span className="min-w-0">{brief.measure}</span>
        </p>
      </Row>,
    );
  }
  // Item lines the parser did not know by name, in the order written.
  brief.other.forEach((o, i) => {
    if (present(o.text)) {
      rows.push(
        <Row key={`other-${i}-${o.label}`} label={o.label}>
          <p>{o.text}</p>
        </Row>,
      );
    }
  });
  return rows;
}

function BriefCard({ brief, number }: { brief: CreativeBrief; number: number }) {
  const rows = rowsOf(brief);
  return (
    <li data-brief={number} className="card relative flex min-w-0 flex-col overflow-hidden break-words">
      <span aria-hidden className="absolute inset-x-0 top-0 h-1 bg-brand" />
      <div className="px-5 pb-4 pt-6 sm:px-6">
        <p className={`${EYEBROW} text-brand-strong`}>{`Brief ${number}`}</p>
        <h3 className="mt-1 text-lg font-semibold leading-snug text-ink">{brief.title}</h3>
        {present(brief.who) ? (
          <p className="muted mt-2 text-sm leading-6">
            <Figures text={brief.who} />
          </p>
        ) : null}
      </div>
      {rows.length > 0 ? <dl className="divide-y divide-line border-t border-line">{rows}</dl> : null}
    </li>
  );
}

// `parsed` comes from the parser. Server-compatible: the only client piece is the copy button inside the cards.
export function CreativeBriefsView({ parsed }: { parsed: CreativeBriefsParsed }) {
  const { campaign, lastYear, notPushing, briefs, rest } = parsed;
  return (
    <div className="space-y-5">
      {present(campaign) ? (
        <div className="flex items-start gap-3">
          <span aria-hidden className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-brand-tint text-brand-strong">
            <CalendarDays className="size-4" />
          </span>
          <div className="min-w-0">
            <p className={`${EYEBROW} text-ink-3`}>Campaign</p>
            <p className="mt-0.5 text-base font-medium leading-7 text-ink">{campaign}</p>
          </div>
        </div>
      ) : null}
      {present(lastYear) || present(notPushing) ? (
        <div className="grid gap-3 md:grid-cols-2">
          {present(lastYear) ? <Callout icon={History} label="Last year" text={lastYear} /> : null}
          {present(notPushing) ? <Callout icon={TriangleAlert} label="Not pushing" text={notPushing} warn /> : null}
        </div>
      ) : null}
      {briefs.length > 0 ? (
        <ol aria-label="Creative briefs" className="grid gap-4 lg:grid-cols-3">
          {briefs.map((brief, i) => (
            <BriefCard key={`${i}-${brief.title}`} brief={brief} number={i + 1} />
          ))}
        </ol>
      ) : null}
      {rest.length > 0 ? (
        <div className="max-w-[68ch] space-y-3 text-[0.9375rem] leading-7">
          {rest.map((p, i) => (
            <p key={i} className="whitespace-pre-line">
              {segments(p).map((s, j) => (s.bold ? <strong key={j}>{s.text}</strong> : s.text))}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}
