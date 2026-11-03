"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

// How long the button says "Copied" before it goes back to "Copy".
const COPIED_MS = 1800;

// Every copy gets its own number, so the timer of an earlier copy can never switch off the "Copied" of a later one (two quick clicks).
// A number in state, not a timer in a ref, keeps the component to the one hook.
let copies = 0;

// A small button that puts one piece of text on the clipboard, for the hook lines and the angle of a creative brief. The clipboard is
// only there on a secure page and in a browser that allows it, so a missing clipboard or a refusal does nothing and never throws.
// `label` is the name a screen reader hears ("Copy hook line: ..."), because "Copy" alone would be the same on every line.
export function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState<number | null>(null);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      return;
    }
    const mine = ++copies;
    setCopied(mine);
    setTimeout(() => setCopied((now) => (now === mine ? null : now)), COPIED_MS);
  }

  const done = copied !== null;
  return (
    <span className="relative inline-flex shrink-0">
      <button type="button" onClick={copy} aria-label={label} className={`btn btn-secondary btn-sm motion-reduce:transition-none ${done ? "text-ahead" : ""}`}>
        {done ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
        {done ? "Copied" : "Copy"}
      </button>
      {/* Outside the button, because a button's name is its aria-label and a change inside it would not be announced. */}
      <span aria-live="polite" className="sr-only">
        {done ? "Copied to the clipboard" : ""}
      </span>
    </span>
  );
}
