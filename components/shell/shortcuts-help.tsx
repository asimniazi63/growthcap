"use client";

import { Keyboard, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { announceChange, browserStore, readRaw, subscribeStore, writeRaw } from "@/lib/shell/local-store";
import { goTargets, keyboardBusy, shortcutGroups, SINGLE_KEYS_PREF, singleKeysOn, stepShortcut, type Pending, type TargetLike } from "@/lib/shell/shortcuts";
import { trapTab } from "./focus-trap";
import { KBD } from "./kbd";
import { useIsMac } from "./platform";

// Press ? anywhere outside a text field for the list of keyboard shortcuts. This is also where the single keys that go to a page
// (g, then o for Overview) are heard. The list shows exactly what lib/shell/shortcuts.ts declares.

export const SHORTCUTS_EVENT = "oasis:shortcuts";
export const openShortcuts = () => window.dispatchEvent(new CustomEvent(SHORTCUTS_EVENT));

// The rows of the list, without the window around them.
export function ShortcutsList({ gc, mac }: { gc: boolean; mac: boolean }) {
  const uid = useId();
  return (
    <div className="space-y-5">
      {shortcutGroups(gc, mac).map((group, gi) => (
        <section key={group.title} aria-labelledby={`${uid}-${gi}`}>
          <h3 id={`${uid}-${gi}`} className="text-xs font-semibold text-ink-3">
            {group.title}
          </h3>
          <ul className="mt-1.5 divide-y divide-line">
            {group.rows.map((row) => (
              <li key={`${row.keys.join("+")}-${row.label}`} className="flex items-center justify-between gap-4 py-2 text-sm">
                <span className="min-w-0 text-ink">{row.label}</span>
                <span className="flex shrink-0 items-center gap-1 text-xs text-ink-3">
                  {row.keys.map((k, i) => (
                    <Fragment key={k}>
                      {i > 0 && row.then ? <span>then</span> : null}
                      <kbd className={KBD}>{k}</kbd>
                    </Fragment>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

const readPref = () => readRaw(browserStore(), SINGLE_KEYS_PREF);

export function ShortcutsHelp({ gc }: { gc: boolean }) {
  const router = useRouter();
  const mac = useIsMac();
  const [open, setOpen] = useState(false);
  const singleKeys = singleKeysOn(useSyncExternalStore(subscribeStore, readPref, () => null));
  const pending = useRef<Pending>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  const uid = useId();
  const targets = useMemo(() => goTargets(gc), [gc]);

  const show = useCallback(() => {
    returnTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setOpen(true);
  }, []);
  const hide = useCallback(() => {
    setOpen(false);
    const back = returnTo.current;
    if (back?.isConnected) back.focus();
  }, []);

  // The two buttons that open the list (the top bar's ? and the search window's footer) send an event instead of sharing state.
  useEffect(() => {
    window.addEventListener(SHORTCUTS_EVENT, show);
    return () => window.removeEventListener(SHORTCUTS_EVENT, show);
  }, [show]);

  // The single keys. They stay out of the way while someone types, while a window holds the keyboard, and when switched off below.
  useEffect(() => {
    if (open) return;
    const onKey = (e: KeyboardEvent) => {
      if (!singleKeys || e.defaultPrevented || e.repeat || e.isComposing || keyboardBusy(e.target as TargetLike | null)) {
        pending.current = null;
        return;
      }
      const step = stepShortcut(pending.current, e, targets);
      pending.current = step.pending;
      if (!step.action) return;
      e.preventDefault();
      if (step.action.type === "help") show();
      else router.push(step.action.href);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, singleKeys, targets, router, show]);

  // While the list is open: Esc or ? closes it, Tab stays inside it, and Ctrl K gives way to the search window. Capture phase, like the search window.
  useEffect(() => {
    if (!open) return;
    dialog.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || (e.key === "?" && !e.ctrlKey && !e.metaKey && !e.altKey)) {
        e.preventDefault();
        hide();
      } else if (e.key === "Tab") {
        trapTab(e, dialog.current);
      } else if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, hide]);

  const toggleSingleKeys = () => {
    if (writeRaw(browserStore(), SINGLE_KEYS_PREF, singleKeys ? "off" : null)) announceChange({ key: SINGLE_KEYS_PREF });
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center bg-black/55 px-4 pt-[12vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) hide();
      }}
    >
      <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby={`${uid}-title`} tabIndex={-1} className="max-h-[76vh] w-full max-w-[480px] overflow-y-auto overscroll-contain rounded-[18px] border border-line bg-surface shadow-pop outline-none">
        <div className="flex items-center gap-3 border-b border-line px-5 py-3.5">
          <Keyboard className="size-[1.125rem] shrink-0 text-ink-3" aria-hidden />
          <h2 id={`${uid}-title`} className="min-w-0 flex-1 text-base font-semibold">
            Keyboard shortcuts
          </h2>
          <button type="button" onClick={hide} className="btn btn-ghost -mr-2 p-1.5" aria-label="Close">
            <X className="size-4" aria-hidden />
          </button>
        </div>
        <div className="px-5 py-4">
          <ShortcutsList gc={gc} mac={mac} />
        </div>
        <label className="flex cursor-pointer items-start gap-2.5 border-t border-line bg-paper px-5 py-3.5 text-sm text-ink-2">
          <input type="checkbox" checked={singleKeys} onChange={toggleSingleKeys} className="mt-0.5 size-4 shrink-0 accent-brand" />
          <span>
            Single-key shortcuts
            <span className="block text-xs text-ink-3">The ? key and g then a letter. Turn them off if they get in the way of voice control. {mac ? "⌘K" : "Ctrl K"} always works.</span>
          </span>
        </label>
      </div>
    </div>
  );
}

// A small ? button for the top bar.
export function ShortcutsButton() {
  return (
    <button type="button" onClick={openShortcuts} aria-haspopup="dialog" aria-keyshortcuts="?" aria-label="Keyboard shortcuts" title="Keyboard shortcuts" className="btn btn-secondary size-[38px] shrink-0 border-line-strong bg-paper px-0 text-ink-2">
      <span aria-hidden className="text-sm font-semibold">
        ?
      </span>
    </button>
  );
}
