"use client";

import { useAuth, useOrganizationList } from "@clerk/nextjs";
import { BookOpenCheck, Building2, Calculator, CornerDownLeft, FileText, Gauge, LayoutDashboard, LayoutGrid, ListChecks, MessagesSquare, Newspaper, Plug, ScanSearch, Search, Settings, Sparkles, UsersRound, type LucideIcon } from "lucide-react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useReducer, useRef, useState } from "react";
import { addPin, newPinId, parsePins, pinsKey, type PinnedAnswer } from "@/lib/overview/pinned-answers";
import { announceChange, browserStore, readRaw, writeRaw } from "@/lib/shell/local-store";
import { askReducer, askRowPlacement, canPin, IDLE, problemCode, runAsk } from "@/lib/shell/palette-ask";
import { paletteKey } from "@/lib/shell/shortcuts";
import { SUGGESTED_QUESTIONS } from "../chat/suggestions";
import { useToast } from "../ui/toast";
import { trapTab } from "./focus-trap";
import { KBD } from "./kbd";
import { GC_ONLY_PAGES } from "./pages";
import { useIsMac } from "./platform";
import { openShortcuts, ShortcutsHelp } from "./shortcuts-help";

// Ctrl K or Cmd K (or the sidebar button) opens a small search over three things: the pages, the other brands the person
// belongs to, and the suggested questions. Picking one of those is a navigation the person could make by hand. A typed
// question can also be asked right here: Enter sends it to the assistant (the same route as Chat) and the answer streams
// into this window, where it can be pinned to the Overview page. That is the only thing here that calls the model, and it
// only happens when the person presses Enter on the "Ask the assistant" row.

// The answer panel pulls in the markdown renderer, so it loads when the first question is asked, not with every page.
const PaletteAnswer = dynamic(() => import("./palette-answer").then((m) => m.PaletteAnswer), {
  loading: () => <p className="px-5 py-6 text-sm text-ink-3">Loading…</p>,
});

export const PALETTE_EVENT = "oasis:palette";

interface Entry {
  id: string;
  group: "Jump to" | "Switch brand" | "Ask" | "Ask the assistant";
  label: string;
  icon: LucideIcon;
  hint?: string;
  ask?: string; // the question to ask here, in this window; the other rows navigate
  run: () => void;
}

const PAGES: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/overview", label: "Overview", icon: LayoutDashboard },
  { href: "/chat", label: "Chat", icon: MessagesSquare },
  { href: "/pace", label: "Pace", icon: Gauge },
  { href: "/ebitda", label: "EBITDA", icon: Calculator },
  { href: "/portfolio", label: "Portfolio", icon: LayoutGrid },
  { href: "/briefs", label: "Briefs", icon: Newspaper },
  { href: "/audit", label: "Audit", icon: ScanSearch },
  { href: "/playbooks", label: "Playbooks", icon: BookOpenCheck },
  { href: "/segments", label: "Segments", icon: UsersRound },
  { href: "/plan", label: "Plan", icon: FileText },
  { href: "/actions", label: "Actions", icon: ListChecks },
  { href: "/connect", label: "Connect", icon: Plug },
  { href: "/settings", label: "Settings", icon: Settings },
];

// With nothing typed, only the first few questions show, so the pages and brands stay in view.
const ASK_PREVIEW = 4;
const askUrl = (question: string) => `/chat?q=${encodeURIComponent(question)}`;

const kbd = KBD;

// The search window, with the shortcuts list beside it (the list is its own window, opened by ? or its buttons).
export function CommandPalette({ gc }: { gc: boolean }) {
  return (
    <>
      <PaletteWindow gc={gc} />
      <ShortcutsHelp gc={gc} />
    </>
  );
}

function PaletteWindow({ gc }: { gc: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const { orgId, userId } = useAuth();
  const { setActive, userMemberships } = useOrganizationList({ userMemberships: { infinite: true } });
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState(0);
  const [ask, dispatchAsk] = useReducer(askReducer, IDLE);
  const [pinProblem, setPinProblem] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  const running = useRef<AbortController | null>(null); // the question being asked; null when none is
  const uid = useId();
  const optionId = (i: number) => `${uid}-option-${i}`;

  const show = useCallback(() => {
    returnTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setQuery("");
    setSel(0);
    setOpen(true);
  }, []);

  // Closing also stops a question that is still coming in. The server finishes and saves the turn either way (it has been paid for).
  const forget = useCallback(() => {
    running.current?.abort();
    running.current = null;
    dispatchAsk({ type: "reset" });
    setPinProblem(null);
  }, []);
  const hide = useCallback(() => {
    forget();
    setOpen(false);
    const back = returnTo.current;
    if (back?.isConnected) back.focus();
  }, [forget]);

  // Asks the assistant. Only one question runs at a time, so a second Enter does nothing until this one has ended.
  const startAsk = useCallback((question: string) => {
    if (running.current) return;
    const controller = new AbortController();
    running.current = controller;
    const live = () => running.current === controller;
    setPinProblem(null);
    dispatchAsk({ type: "start", question, at: new Date().toISOString() });
    void runAsk({ question, signal: controller.signal, onUpdate: (view) => live() && dispatchAsk({ type: "update", view }) })
      .then((view) => {
        if (!live()) return;
        if (controller.signal.aborted) dispatchAsk({ type: "stop" });
        else if (view.text.trim() === "") dispatchAsk({ type: "fail", code: "EMPTY" });
        else dispatchAsk({ type: "finish", view });
      })
      .catch((error: unknown) => {
        if (live()) dispatchAsk(controller.signal.aborted ? { type: "stop" } : { type: "fail", code: problemCode(error) });
      })
      .finally(() => {
        if (live()) running.current = null;
      });
  }, []);
  const stopAsk = useCallback(() => {
    running.current?.abort();
    dispatchAsk({ type: "stop" });
  }, []);
  const askAgain = useCallback(
    (question: string) => {
      running.current?.abort();
      running.current = null;
      dispatchAsk({ type: "reset" });
      startAsk(question);
    },
    [startAsk],
  );
  // Back to the search box with the same text, ready for something else.
  const back = useCallback(() => {
    forget();
    setSel(0);
  }, [forget]);

  // The answer goes to this person's list for this brand in this browser; the Overview page reads the same key.
  const pin = useCallback(() => {
    if (!canPin(ask)) return;
    const store = browserStore();
    if (!orgId || !userId || !store) {
      setPinProblem("Couldn't pin: this browser isn't letting the page save anything.");
      return;
    }
    const key = pinsKey(orgId, userId);
    const { view } = ask;
    const entry: PinnedAnswer = { id: newPinId(), question: ask.question, answer: view.text, askedAt: ask.askedAt, ...(view.check ? { check: view.check } : {}), ...(view.threadId ? { threadId: view.threadId } : {}) };
    if (!writeRaw(store, key, JSON.stringify(addPin(parsePins(readRaw(store, key)), entry)))) {
      setPinProblem("Couldn't pin: this browser's storage is full or blocked.");
      return;
    }
    hide();
    announceChange({ key, added: entry.id });
    toast.show("Pinned to Overview.");
  }, [ask, orgId, userId, hide, toast]);

  // Every membership is listed, even past the first page.
  const hasMore = userMemberships?.hasNextPage;
  const fetchMore = userMemberships?.fetchNext;
  useEffect(() => {
    if (open && hasMore) fetchMore?.();
  }, [open, hasMore, fetchMore]);

  const memberships = userMemberships?.data;
  const entries = useMemo<Entry[]>(() => {
    const switchTo = (id: string) => {
      void (async () => {
        try {
          if (id !== orgId) {
            if (!setActive) throw new Error("Clerk has not loaded yet");
            await setActive({ organization: id });
          }
          router.push("/overview");
        } catch {
          toast.show("Couldn't switch brand. Try again.", "error");
        }
      })();
    };
    const pages: Entry[] = PAGES.filter((p) => gc || !GC_ONLY_PAGES.includes(p.href)).map((p) => ({ id: `page:${p.href}`, group: "Jump to", label: p.label, icon: p.icon, run: () => router.push(p.href) }));
    const brands: Entry[] =
      (memberships?.length ?? 0) > 1 ? memberships!.map((m) => ({ id: `brand:${m.organization.id}`, group: "Switch brand", label: m.organization.name, icon: Building2, hint: m.organization.id === orgId ? "Current brand" : undefined, run: () => switchTo(m.organization.id) })) : [];
    const asks: Entry[] = SUGGESTED_QUESTIONS.map((q) => ({ id: `ask:${q}`, group: "Ask", label: q, icon: MessagesSquare, run: () => router.push(askUrl(q)) }));

    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) return [...pages, ...brands, ...asks.slice(0, ASK_PREVIEW)];
    const found = [...pages, ...brands, ...asks].filter((e) => words.every((w) => e.label.toLowerCase().includes(w)));
    // A question is offered first, so Enter asks it; text that matches nothing is offered as a question too. Nothing is sent until Enter.
    const typed: Entry = { id: "ask:typed", group: "Ask the assistant", label: query.trim(), icon: Sparkles, hint: "Answers here", ask: query.trim(), run: () => undefined };
    const where = askRowPlacement(query, found.length);
    return where === "only" ? [typed] : where === "first" ? [typed, ...found] : found;
  }, [gc, memberships, orgId, setActive, router, toast, query]);

  const run = useCallback(
    (i: number) => {
      const entry = entries[i];
      if (!entry) return;
      if (entry.ask) {
        startAsk(entry.ask);
        return;
      }
      hide();
      entry.run();
    },
    [entries, hide, startAsk],
  );

  const showingAnswer = ask.status !== "idle";
  const asking = ask.status === "asking";

  // One listener for everything the palette hears: the shortcut and the sidebar button open or close it; the arrows, Enter,
  // Tab and Esc work while it is open. It listens in the capture phase so Esc here never also closes something behind it.
  // Which key does what is decided by paletteKey (lib/shell/shortcuts.ts), which has the rules for the answer on screen.
  useEffect(() => {
    const toggle = () => (open ? hide() : show());
    const onKey = (e: KeyboardEvent) => {
      const action = paletteKey({ open, answering: showingAnswer, asking, query }, e);
      if (!action) return;
      if (action === "trap") return trapTab(e, dialogRef.current);
      e.preventDefault();
      if (action === "toggle") toggle();
      else if (action === "close") hide();
      else if (action === "stop") stopAsk();
      else if (action === "shortcuts") {
        hide(); // with nothing typed, ? opens the shortcuts list
        openShortcuts();
      } else if (action === "enter") run(sel);
      else if (action === "focus-input") inputRef.current?.focus(); // the search box is the only stop inside the results
      else setSel((s) => (entries.length === 0 ? 0 : (s + (action === "down" ? 1 : -1) + entries.length) % entries.length));
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener(PALETTE_EVENT, toggle);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener(PALETTE_EVENT, toggle);
    };
  }, [open, hide, show, stopAsk, showingAnswer, asking, query, entries.length, run, sel]);

  useEffect(() => {
    if (open && !showingAnswer) inputRef.current?.focus();
  }, [open, showingAnswer]);
  useEffect(() => {
    if (open) document.getElementById(`${uid}-option-${sel}`)?.scrollIntoView({ block: "nearest" });
  }, [open, sel, uid]);

  if (!open) return null;

  const groups: { name: Entry["group"]; items: { entry: Entry; index: number }[] }[] = [];
  entries.forEach((entry, index) => {
    const last = groups.at(-1);
    if (last?.name === entry.group) last.items.push({ entry, index });
    else groups.push({ name: entry.group, items: [{ entry, index }] });
  });
  const listId = `${uid}-results`;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center bg-black/55 px-4 pt-[12vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) hide();
      }}
    >
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={showingAnswer ? "Answer from the assistant" : "Search or jump to"} className="w-full max-w-[620px] overflow-hidden rounded-[18px] border border-line bg-surface shadow-pop">
        {ask.status !== "idle" ? (
          <>
            <div className="flex items-start gap-3 border-b border-line px-4 py-3.5">
              <Sparkles className="mt-1 size-[1.125rem] shrink-0 text-brand" aria-hidden />
              <p className="min-w-0 flex-1 break-words text-base font-medium leading-snug text-ink">{ask.question}</p>
              <kbd className={`${kbd} hidden sm:inline-block`}>Esc</kbd>
            </div>
            <PaletteAnswer state={ask} pinProblem={pinProblem} onPin={pin} onStop={stopAsk} onBack={back} onRetry={() => askAgain(ask.question)} onOpenChat={hide} />
          </>
        ) : (
          <>
            <div className="flex items-center gap-3 border-b border-line px-4 py-3.5 text-ink-3">
              <Search className="size-[1.125rem] shrink-0" aria-hidden />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setSel(0);
                }}
                role="combobox"
                aria-label="Search"
                aria-expanded="true"
                aria-controls={listId}
                aria-autocomplete="list"
                aria-activedescendant={entries.length > 0 ? optionId(sel) : undefined}
                autoComplete="off"
                spellCheck={false}
                maxLength={300}
                placeholder="Search pages, brands or questions"
                className="min-w-0 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-ink-3"
              />
              <kbd className={kbd}>Esc</kbd>
            </div>

            <div id={listId} role="listbox" aria-label="Results" className="max-h-[52vh] overflow-y-auto overscroll-contain p-2">
              {entries.length === 0 ? <p className="px-2.5 py-4 text-sm text-ink-3">Nothing matches. To ask the assistant, type a question or end it with a question mark.</p> : null}
              {groups.map((g, gi) => (
                <div key={g.name} role="group" aria-labelledby={`${uid}-group-${gi}`}>
                  <div id={`${uid}-group-${gi}`} role="presentation" className="px-2.5 pb-1 pt-2.5 text-xs font-semibold text-ink-3">
                    {g.name}
                  </div>
                  {g.items.map(({ entry, index }) => {
                    const Icon = entry.icon;
                    const selected = index === sel;
                    return (
                      <div
                        key={entry.id}
                        id={optionId(index)}
                        role="option"
                        aria-selected={selected}
                        onMouseMove={() => (index === sel ? undefined : setSel(index))}
                        onClick={() => run(index)}
                        className={`flex cursor-pointer items-center gap-3 rounded-[10px] px-2.5 py-2 text-[0.90625rem] ${selected ? "bg-brand-tint text-brand-strong" : "text-ink"}`}
                      >
                        <Icon className={`size-4 shrink-0 ${selected ? "text-brand" : "text-ink-3"}`} aria-hidden />
                        <span className="min-w-0 flex-1 truncate">{entry.label}</span>
                        {entry.hint ? <span className="shrink-0 text-[0.78rem] text-ink-3">{entry.hint}</span> : null}
                        {selected ? <CornerDownLeft className="size-3.5 shrink-0 text-brand" aria-hidden /> : null}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
            <p role="status" className="sr-only">
              {entries.length} {entries.length === 1 ? "result" : "results"}
            </p>
            <div className="hidden items-center gap-4 border-t border-line px-4 py-2.5 text-xs text-ink-3 sm:flex">
              <span>Up and down to move</span>
              <span>Enter to open or ask</span>
              <span>Esc to close</span>
              <button
                type="button"
                onClick={() => {
                  hide();
                  openShortcuts();
                }}
                className="ml-auto flex items-center gap-1.5 rounded-md hover:text-ink"
              >
                <kbd className={kbd}>?</kbd>
                Shortcuts
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// "⌘K" on a Mac, "Ctrl K" elsewhere.
export function PaletteButton() {
  const mac = useIsMac();
  return (
    <button type="button" onClick={() => window.dispatchEvent(new CustomEvent(PALETTE_EVENT))} aria-haspopup="dialog" aria-keyshortcuts="Control+K Meta+K" className="btn btn-secondary w-full justify-start gap-2.5 px-3 text-ink-2">
      <Search className="size-4 shrink-0 text-ink-3" aria-hidden />
      <span className="truncate">Search or jump to</span>
      <kbd className={`ml-auto shrink-0 ${kbd}`}>{mac ? "⌘K" : "Ctrl K"}</kbd>
    </button>
  );
}
