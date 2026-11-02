// The keyboard shortcuts the app really has, and the logic of the ones that use single keys. The listeners live in
// components/shell/*; the shortcuts list is drawn from what is declared here, so a key is never listed without being wired.

export interface KeyEventLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  timeStamp: number;
}

export interface TargetLike {
  tagName?: string;
  isContentEditable?: boolean;
  closest?: (selector: string) => unknown;
}

const TYPING_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

// A single key is left alone while someone types, and inside a window that holds the keyboard (the search window, the shortcuts list).
export function keyboardBusy(target: TargetLike | null): boolean {
  if (!target) return false;
  if (target.tagName && TYPING_TAGS.has(target.tagName.toUpperCase())) return true;
  if (target.isContentEditable) return true;
  return Boolean(target.closest?.('[aria-modal="true"]'));
}

// "g" then a letter goes to a page. Only pages in the sidebar and the search window are here; `gc` marks the ones only Growth Capital staff can open.
export interface GoTarget {
  key: string;
  href: string;
  label: string;
  gc: boolean;
}

export const GO_TARGETS: readonly GoTarget[] = [
  { key: "o", href: "/overview", label: "Overview", gc: false },
  { key: "c", href: "/chat", label: "Chat", gc: false },
  { key: "p", href: "/pace", label: "Pace", gc: false },
  { key: "b", href: "/briefs", label: "Briefs", gc: false },
  { key: "s", href: "/settings", label: "Settings", gc: false },
  { key: "a", href: "/actions", label: "Actions", gc: true },
];

export const goTargets = (gc: boolean): GoTarget[] => GO_TARGETS.filter((t) => gc || !t.gc);

// The letter after "g" counts for this long.
export const CHORD_MS = 1500;

// null: nothing pending. Otherwise "g" was pressed at `at` (the event's timeStamp).
export type Pending = { at: number } | null;
export type ShortcutAction = { type: "help" } | { type: "go"; href: string };

const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta", "CapsLock", "AltGraph"]);

// One key press in, the new pending state and what to do out. Anything with Ctrl, Cmd or Alt is somebody else's shortcut.
export function stepShortcut(pending: Pending, e: KeyEventLike, targets: readonly GoTarget[]): { pending: Pending; action: ShortcutAction | null } {
  if (e.ctrlKey || e.metaKey || e.altKey) return { pending: null, action: null };
  if (MODIFIER_KEYS.has(e.key)) return { pending, action: null };
  if (e.key === "?") return { pending: null, action: { type: "help" } };
  if (e.key.length !== 1 || e.shiftKey) return { pending: null, action: null };

  const key = e.key.toLowerCase();
  if (pending && e.timeStamp - pending.at <= CHORD_MS) {
    const hit = targets.find((t) => t.key === key);
    return { pending: null, action: hit ? { type: "go", href: hit.href } : null };
  }
  return { pending: key === "g" ? { at: e.timeStamp } : null, action: null };
}

export interface PaletteKeyState {
  open: boolean;
  answering: boolean; // an answer is on screen instead of the results (coming in, finished, stopped or failed)
  asking: boolean; // the answer is still coming in
  query: string;
}

export type PaletteKey = "toggle" | "close" | "stop" | "shortcuts" | "up" | "down" | "enter" | "trap" | "focus-input";

// What a key press means to the search window, or null to leave it alone. Esc stops an answer that is coming in and closes the window
// otherwise; while an answer is on screen Enter and the arrows go to whatever has focus, so Enter cannot ask a second time.
export function paletteKey(state: PaletteKeyState, e: KeyEventLike & { isComposing?: boolean; repeat?: boolean }): PaletteKey | null {
  if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k") return "toggle";
  if (!state.open) return null;
  if (e.key === "Escape") return state.asking ? "stop" : "close";
  if (state.answering) return e.key === "Tab" ? "trap" : null;
  if (e.key === "?" && state.query === "" && !e.ctrlKey && !e.metaKey && !e.altKey) return "shortcuts";
  if (e.key === "ArrowDown") return "down";
  if (e.key === "ArrowUp") return "up";
  if (e.key === "Enter" && !e.isComposing) return e.repeat ? null : "enter";
  if (e.key === "Tab") return "focus-input";
  return null;
}

// Single-key shortcuts (? and g then a letter) can be switched off, so speech input and assistive tools that send single
// keys cannot trigger them by accident. Ctrl K is not affected.
export const SINGLE_KEYS_PREF = "oasis:single-key-shortcuts";
export const singleKeysOn = (stored: string | null): boolean => stored !== "off";

// Moving focus inside a window with Tab: the index to focus next, wrapping at both ends. -1 when nothing inside can take focus.
export function nextFocusIndex(current: number, count: number, backwards: boolean): number {
  if (count <= 0) return -1;
  if (current < 0) return backwards ? count - 1 : 0;
  return (current + (backwards ? -1 : 1) + count) % count;
}

export interface ShortcutRow {
  keys: string[]; // one chip each
  then?: boolean; // the keys are pressed one after the other
  label: string;
}

export interface ShortcutGroup {
  title: string;
  rows: ShortcutRow[];
}

// What the shortcuts list shows. Every row is wired: Ctrl K, Esc, the arrows and Enter in command-palette.tsx, "?" and "g" in
// shortcuts-help.tsx, Esc for the sources panel in components/chat/proof-drawer.tsx.
export function shortcutGroups(gc: boolean, mac: boolean): ShortcutGroup[] {
  return [
    {
      title: "Anywhere",
      rows: [
        { keys: [mac ? "⌘K" : "Ctrl K"], label: "Search, ask a question or jump to a page" },
        { keys: ["?"], label: "Show this list" },
        ...goTargets(gc).map((t) => ({ keys: ["g", t.key], then: true, label: `Go to ${t.label}` })),
        { keys: ["Esc"], label: "Close a window or the sources panel" },
      ],
    },
    {
      title: "In the search window",
      rows: [
        { keys: ["↑", "↓"], label: "Move through the results" },
        { keys: ["Enter"], label: "Open the result, or ask what you typed" },
        { keys: ["Esc"], label: "Stop an answer that is coming in, or close the window" },
        { keys: ["?"], label: "Show this list, when the search box is empty" },
      ],
    },
  ];
}
