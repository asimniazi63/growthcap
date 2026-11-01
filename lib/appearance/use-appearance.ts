"use client";

import { useCallback, useSyncExternalStore } from "react";
import { cookieString } from "./cookie";
import { APPEARANCE_EVENT, DEFAULT_APPEARANCE, isModePref, isSchemeId, type Appearance, type Mode, type ModePref, type SchemeId } from "./schemes";

export { APPEARANCE_EVENT };

// The page's appearance lives on <html data-scheme data-pref data-mode>. The root layout renders those from the cookie, so the
// first paint is already right; this hook reads them back and, when a person changes something, sets them again and saves the cookie.

const subscribe = (onChange: () => void) => {
  window.addEventListener(APPEARANCE_EVENT, onChange);
  return () => window.removeEventListener(APPEARANCE_EVENT, onChange);
};
const snapshot = () => {
  const d = document.documentElement.dataset;
  return `${d.scheme}|${d.pref}|${d.mode}`;
};
// What the server rendered, for the first client render: the person's saved choice when the page passes it, else the default.
// "system" is rendered as light on the server, because the server cannot know the device setting.
const serverSnapshotFor = (initial: Appearance) => () => `${initial.scheme}|${initial.mode}|${initial.mode === "dark" ? "dark" : "light"}`;

export const resolveMode = (pref: ModePref): Mode => (pref === "system" ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : pref);

// Sets the attributes at once, saves the cookie, and tells every subscriber. Also used by the one-click light/dark toggle.
export function applyAppearance(next: Appearance): void {
  const root = document.documentElement;
  root.dataset.scheme = next.scheme;
  root.dataset.pref = next.mode;
  root.dataset.mode = resolveMode(next.mode);
  try {
    document.cookie = cookieString(next, window.location.protocol === "https:");
  } catch {
    // Cookies blocked: the choice lasts until the page closes.
  }
  window.dispatchEvent(new Event(APPEARANCE_EVENT));
}

export interface AppearanceApi {
  scheme: SchemeId;
  pref: ModePref; // what the person chose
  mode: Mode; // light or dark, as it shows now
  setScheme: (scheme: SchemeId) => void;
  setMode: (pref: ModePref) => void;
  reset: () => void;
}

export function useAppearance(initial: Appearance = DEFAULT_APPEARANCE): AppearanceApi {
  const key = useSyncExternalStore(subscribe, snapshot, serverSnapshotFor(initial));
  const [s, p, m] = key.split("|");
  const scheme = isSchemeId(s) ? s : DEFAULT_APPEARANCE.scheme;
  const pref = isModePref(p) ? p : DEFAULT_APPEARANCE.mode;
  const mode: Mode = m === "dark" ? "dark" : "light";

  const setScheme = useCallback((next: SchemeId) => applyAppearance({ scheme: next, mode: pref }), [pref]);
  const setMode = useCallback((next: ModePref) => applyAppearance({ scheme, mode: next }), [scheme]);
  const reset = useCallback(() => applyAppearance(DEFAULT_APPEARANCE), []);
  return { scheme, pref, mode, setScheme, setMode, reset };
}
