"use client";

import { ArrowLeft, Check, CircleAlert, LoaderCircle, MessagesSquare, Pin, RotateCw, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { checkLine } from "@/lib/overview/pinned-answers";
import type { AskState } from "@/lib/shell/palette-ask";
import { ERROR_COPY, type ChatErrorCode } from "../chat/error-banner";
import { SafeMarkdown } from "../chat/safe-markdown";
import { KBD } from "./kbd";

// The answer half of the search window: the text as it streams in, then what to do with it. It renders the answer with the same
// safe renderer as Chat (no raw HTML, no images, links only to this app and Shopify), and shows nothing but what the stream sent.

// The Chat page has no address for one saved conversation yet, so this opens the list, where the new conversation is the first one.
export const CHAT_HREF = "/chat";

const PHASE = { waiting: "Thinking…", reading: "Reading the store's data…", writing: "Writing the answer…" } as const;

interface Copy {
  title: string;
  body: string;
  retry?: boolean;
}
const OWN_COPY: Record<string, Copy> = {
  NETWORK: { title: "Can't reach the server", body: "Check your connection and try again.", retry: true },
  EMPTY: { title: "No answer came back", body: "Nothing was changed. Try asking again.", retry: true },
};

// The provider's own message never reaches here: only a code does, and anything unknown reads as "something went wrong".
export function copyFor(code: string): Copy {
  return OWN_COPY[code] ?? ERROR_COPY[code as ChatErrorCode] ?? ERROR_COPY.INTERNAL_ERROR;
}

export type AnswerState = Exclude<AskState, { status: "idle" }>;

interface Props {
  state: AnswerState;
  pinProblem: string | null;
  onPin: () => void;
  onStop: () => void;
  onBack: () => void;
  onRetry: () => void;
  onOpenChat: () => void;
}

function statusText(state: AnswerState): string {
  switch (state.status) {
    case "asking":
      return `Asking the assistant. ${PHASE[state.view.phase]}`;
    case "done":
      return "The answer is ready.";
    case "stopped":
      return "Stopped.";
    case "failed":
      return copyFor(state.code).title;
  }
}

export function PaletteAnswer({ state, pinProblem, onPin, onStop, onBack, onRetry, onOpenChat }: Props) {
  const region = useRef<HTMLDivElement>(null);
  const stick = useRef(true); // follow the new text unless the person has scrolled up to read
  const { view } = state;
  const asking = state.status === "asking";

  useEffect(() => {
    region.current?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    const el = region.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [view.text]);

  const line = state.status === "done" ? checkLine(view.check) : null;
  const copy = state.status === "failed" ? copyFor(state.code) : null;

  return (
    <>
      <div
        ref={region}
        role="region"
        aria-label="Answer"
        aria-busy={asking}
        tabIndex={0}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}
        className="max-h-[52vh] min-h-[7.5rem] overflow-y-auto overscroll-contain px-5 py-4 outline-none focus-visible:[outline-offset:-3px]"
      >
        {view.text ? (
          <SafeMarkdown text={view.text} />
        ) : asking ? (
          <div aria-hidden className="space-y-2.5 py-1">
            <div className="skeleton h-3.5 w-[92%]" />
            <div className="skeleton h-3.5 w-[78%]" />
            <div className="skeleton h-3.5 w-[55%]" />
          </div>
        ) : null}

        {state.status === "stopped" ? (
          <p className="mt-3 flex items-start gap-2 text-sm text-ink-2">
            <CircleAlert className="mt-0.5 size-4 shrink-0 text-ink-3" aria-hidden />
            <span>Stopped. The assistant may still finish, and a finished answer is saved in Chat.</span>
          </p>
        ) : null}
        {copy ? (
          <div role="alert" className={`mt-3 flex gap-2.5 rounded-xl border px-3.5 py-3 text-sm ${copy.retry ? "border-warn/30 bg-warn-tint" : "border-behind/30 bg-behind-tint"}`}>
            {copy.retry ? <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden /> : <CircleAlert className="mt-0.5 size-4 shrink-0 text-behind" aria-hidden />}
            <div className="min-w-0">
              <p className="font-semibold text-ink">{copy.title}</p>
              <p className="mt-0.5 text-ink-2">{copy.body}</p>
            </div>
          </div>
        ) : null}
      </div>

      <p role="status" className="sr-only">
        {statusText(state)}
      </p>

      <div className="border-t border-line bg-paper px-4 py-3">
        {asking ? (
          <>
            <div className="flex items-center gap-3 text-sm text-ink-2">
              <LoaderCircle className="size-4 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden />
              <span className="min-w-0 flex-1">{PHASE[view.phase]}</span>
              <span className="hidden shrink-0 text-xs text-ink-3 sm:inline">
                <kbd className={KBD}>Esc</kbd> to stop
              </span>
              <button type="button" onClick={onStop} className="btn btn-secondary btn-sm shrink-0">
                Stop
              </button>
            </div>
            <p className="mt-1.5 text-xs text-ink-3">This asks the assistant and uses this brand&apos;s AI budget. A finished answer is saved in Chat.</p>
          </>
        ) : (
          <div className="space-y-2.5">
            {line || (state.status === "done" && view.threadId) ? (
              <p className="flex flex-wrap items-start gap-x-4 gap-y-1 text-xs text-ink-2">
                {line ? (
                  <span className="flex items-start gap-1.5">
                    {line.ok ? <Check className="mt-px size-3.5 shrink-0 text-ahead" strokeWidth={3} aria-hidden /> : <TriangleAlert className="mt-px size-3.5 shrink-0 text-warn" aria-hidden />}
                    {line.text}
                  </span>
                ) : null}
                {state.status === "done" && view.threadId ? <span className="text-ink-3">Saved in Chat</span> : null}
              </p>
            ) : null}
            {pinProblem ? (
              <p role="alert" className="text-xs text-behind">
                {pinProblem}
              </p>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              {state.status === "done" ? (
                <>
                  <button type="button" onClick={onPin} className="btn btn-primary btn-sm">
                    <Pin className="size-4" aria-hidden />
                    Pin to Overview
                  </button>
                  <Link href={CHAT_HREF} onClick={onOpenChat} className="btn btn-secondary btn-sm">
                    <MessagesSquare className="size-4" aria-hidden />
                    Open in Chat
                  </Link>
                </>
              ) : null}
              {copy?.retry ? (
                <button type="button" onClick={onRetry} className="btn btn-secondary btn-sm">
                  <RotateCw className="size-4" aria-hidden />
                  Try again
                </button>
              ) : null}
              <button type="button" onClick={onBack} className="btn btn-ghost btn-sm sm:ml-auto">
                <ArrowLeft className="size-4" aria-hidden />
                Ask something else
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
