"use client";

import { useAuth, useOrganizationList } from "@clerk/nextjs";
import { Building2, CornerDownLeft, FileText, Gauge, LayoutDashboard, LayoutGrid, ListChecks, MessagesSquare, Newspaper, Plug, ScanSearch, Search, type LucideIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { SUGGESTED_QUESTIONS } from "../chat/suggestions";
import { useToast } from "../ui/toast";
import { GC_ONLY_PAGES } from "./pages";

// Ctrl K or Cmd K (or the sidebar button) opens a small search over three things: the pages, the other brands the person
// belongs to, and the suggested questions. Everything it does is a navigation the person could make by hand: it reads no
// store data and calls no model.

export const PALETTE_EVENT = "oasis:palette";

interface Entry {
  id: string;
  group: "Jump to" | "Switch brand" | "Ask";
  label: string;
  icon: LucideIcon;
  hint?: string;
  run: () => void;
}

const PAGES: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/overview", label: "Overview", icon: LayoutDashboard },
  { href: "/chat", label: "Chat", icon: MessagesSquare },
  { href: "/pace", label: "Pace", icon: Gauge },
  { href: "/portfolio", label: "Portfolio", icon: LayoutGrid },
  { href: "/briefs", label: "Briefs", icon: Newspaper },
  { href: "/audit", label: "Audit", icon: ScanSearch },
  { href: "/plan", label: "Plan", icon: FileText },
  { href: "/actions", label: "Actions", icon: ListChecks },
  { href: "/connect", label: "Connect", icon: Plug },
];

// With nothing typed, only the first few questions show, so the pages and brands stay in view.
const ASK_PREVIEW = 4;
const askUrl = (question: string) => `/chat?q=${encodeURIComponent(question)}`;

const kbd = "rounded-md border border-b-2 border-line-strong bg-surface px-1.5 py-px text-xs font-semibold text-ink-3";

export function CommandPalette({ gc }: { gc: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const { orgId } = useAuth();
  const { setActive, userMemberships } = useOrganizationList({ userMemberships: { infinite: true } });
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  const uid = useId();
  const optionId = (i: number) => `${uid}-option-${i}`;

  const show = useCallback(() => {
    returnTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setQuery("");
    setSel(0);
    setOpen(true);
  }, []);
  const hide = useCallback(() => {
    setOpen(false);
    const back = returnTo.current;
    if (back?.isConnected) back.focus();
  }, []);

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
    // Nothing matches: Enter asks what was typed, as a question in the chat.
    return found.length > 0 ? found : [{ id: "ask:typed", group: "Ask", label: `Ask: ${query.trim()}`, icon: MessagesSquare, run: () => router.push(askUrl(query.trim())) }];
  }, [gc, memberships, orgId, setActive, router, toast, query]);

  const run = useCallback(
    (i: number) => {
      const entry = entries[i];
      if (!entry) return;
      hide();
      entry.run();
    },
    [entries, hide],
  );

  // One listener for everything the palette hears: the shortcut and the sidebar button open or close it; the arrows, Enter,
  // Tab and Esc work while it is open. It listens in the capture phase so Esc here never also closes something behind it.
  useEffect(() => {
    const toggle = () => (open ? hide() : show());
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        toggle();
        return;
      }
      if (!open) return;
      if (e.key === "Escape") {
        e.preventDefault();
        hide();
      } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setSel((s) => (entries.length === 0 ? 0 : (s + (e.key === "ArrowDown" ? 1 : -1) + entries.length) % entries.length));
      } else if (e.key === "Enter" && !e.isComposing) {
        e.preventDefault();
        run(sel);
      } else if (e.key === "Tab") {
        e.preventDefault(); // the search box is the only stop inside the dialog
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener(PALETTE_EVENT, toggle);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener(PALETTE_EVENT, toggle);
    };
  }, [open, hide, show, entries.length, run, sel]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);
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
      <div role="dialog" aria-modal="true" aria-label="Search or jump to" className="w-full max-w-[620px] overflow-hidden rounded-[18px] border border-line bg-surface shadow-pop">
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
        <p className="hidden items-center gap-4 border-t border-line px-4 py-2.5 text-xs text-ink-3 sm:flex">
          <span>Up and down to move</span>
          <span>Enter to open</span>
          <span>Esc to close</span>
        </p>
      </div>
    </div>
  );
}

// "⌘K" on a Mac, "Ctrl K" elsewhere. The server and the first client render both say "Ctrl K", so nothing mismatches.
const noSubscription = () => () => undefined;
const onMac = () => /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent);

export function PaletteButton() {
  const mac = useSyncExternalStore(noSubscription, onMac, () => false);
  return (
    <button type="button" onClick={() => window.dispatchEvent(new CustomEvent(PALETTE_EVENT))} aria-haspopup="dialog" aria-keyshortcuts="Control+K Meta+K" className="btn btn-secondary w-full justify-start gap-2.5 px-3 text-ink-2">
      <Search className="size-4 shrink-0 text-ink-3" aria-hidden />
      <span className="truncate">Search or jump to</span>
      <kbd className={`ml-auto shrink-0 ${kbd}`}>{mac ? "⌘K" : "Ctrl K"}</kbd>
    </button>
  );
}
