"use client";

import { ArrowUp, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

// A question typed here is opened in Chat, which asks it once on load.
export function AskBox() {
  const router = useRouter();
  const [text, setText] = useState("");

  function submit(e: FormEvent) {
    e.preventDefault();
    const q = text.trim();
    if (q) router.push(`/chat?q=${encodeURIComponent(q)}`);
  }

  return (
    <form onSubmit={submit} role="search" className="card flex items-center gap-2.5 py-2 pl-[18px] pr-2 transition-shadow focus-within:border-brand focus-within:shadow-[0_0_0_3px_color-mix(in_oklab,var(--color-brand)_22%,transparent)]">
      <Search className="size-[18px] shrink-0 text-ink-3" aria-hidden />
      <label htmlFor="overview-ask" className="sr-only">
        Ask about this store
      </label>
      <input
        id="overview-ask"
        name="ask"
        type="text"
        autoComplete="off"
        maxLength={1000}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Ask about sales, orders, stock or customers"
        className="min-w-0 flex-1 bg-transparent py-2.5 text-[0.9375rem] text-ink outline-none placeholder:text-ink-3"
      />
      <button type="submit" aria-label="Ask" disabled={text.trim() === ""} className="grid size-[38px] shrink-0 place-items-center rounded-full bg-brand text-on-brand transition-colors hover:bg-brand-strong disabled:cursor-not-allowed disabled:opacity-45">
        <ArrowUp className="size-[18px]" aria-hidden />
      </button>
    </form>
  );
}
