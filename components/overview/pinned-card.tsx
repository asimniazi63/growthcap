"use client";

import { Check, ChevronDown, Pin, PinOff, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useId, useState } from "react";
import { askAgainHref, checkLine, formatAsked, isLongAnswer, type PinnedAnswer } from "@/lib/overview/pinned-answers";
import { SafeMarkdown } from "../chat/safe-markdown";

// One answer pinned from the search window. The question is the title and the answer is the text as it was streamed; both came from
// a person and a model, so they are drawn as text (the answer through the same safe renderer as Chat). It is a snapshot, so the
// card says when it was asked, and "Ask again" opens Chat with today's figures. `fresh` plays a short settle when the card has just landed.
export function PinnedCard({ pin, fresh, onUnpin }: { pin: PinnedAnswer; fresh: boolean; onUnpin: () => void }) {
  const uid = useId();
  const [open, setOpen] = useState(false);
  const long = isLongAnswer(pin.answer);
  const cut = long && !open;
  const line = checkLine(pin.check);

  return (
    <article aria-labelledby={`${uid}-q`} className={`card flex min-w-0 flex-1 flex-col p-4 ${fresh ? "motion-safe:animate-[toast-in_0.32s_ease-out]" : ""}`}>
      <header className="flex items-start gap-2">
        <h3 id={`${uid}-q`} className="line-clamp-3 min-w-0 flex-1 break-words font-display text-[0.9375rem] font-semibold leading-snug">
          {pin.question}
        </h3>
        <button type="button" onClick={onUnpin} aria-label={`Unpin: ${pin.question}`} title="Unpin" className="btn btn-ghost -mr-1.5 -mt-1.5 shrink-0 p-1.5">
          <PinOff className="size-4" aria-hidden />
        </button>
      </header>
      <p className="mt-1 flex items-center gap-1.5 text-xs text-ink-3">
        <Pin className="size-3 shrink-0" aria-hidden />
        <span>
          Asked <time dateTime={pin.askedAt}>{formatAsked(pin.askedAt)}</time>
        </span>
      </p>

      <div id={`${uid}-a`} className={`mt-3 min-h-0 flex-1 ${cut ? "max-h-40 overflow-hidden [mask-image:linear-gradient(to_bottom,black_62%,transparent)]" : long ? "max-h-[60vh] overflow-y-auto overscroll-contain" : ""}`}>
        <SafeMarkdown text={pin.answer} />
      </div>
      {long ? (
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-controls={`${uid}-a`} className="mt-1.5 flex items-center gap-1 self-start rounded-md text-xs font-medium text-ink-2 hover:text-ink">
          <ChevronDown className={`size-3.5 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
          {open ? "Show less" : "Show all"}
        </button>
      ) : null}

      <footer className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-line pt-3 text-xs text-ink-3">
        {line ? (
          <span className="flex items-start gap-1.5">
            {line.ok ? <Check className="mt-px size-3.5 shrink-0 text-ahead" strokeWidth={3} aria-hidden /> : <TriangleAlert className="mt-px size-3.5 shrink-0 text-warn" aria-hidden />}
            {line.text}
          </span>
        ) : null}
        <Link href={askAgainHref(pin.question)} className="ml-auto shrink-0 font-medium text-brand-strong underline decoration-brand/40 underline-offset-2 hover:decoration-brand">
          Ask again
        </Link>
      </footer>
    </article>
  );
}
