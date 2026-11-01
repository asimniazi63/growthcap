"use client";

import { Moon, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";

// The theme lives on <html data-theme>. The script in app/layout.tsx sets it before first paint (the saved choice, else the
// system setting); this button flips it and saves the choice.

export const THEME_KEY = "oasis-theme";
const THEME_EVENT = "oasis:theme";

const subscribe = (onChange: () => void) => {
  window.addEventListener(THEME_EVENT, onChange);
  return () => window.removeEventListener(THEME_EVENT, onChange);
};
const current = () => (document.documentElement.dataset.theme === "dark" ? "dark" : "light");

export function ThemeToggle({ className = "" }: { className?: string }) {
  const theme = useSyncExternalStore(subscribe, current, () => "light");
  const next = theme === "dark" ? "light" : "dark";
  const Icon = theme === "dark" ? Sun : Moon;

  return (
    <button
      type="button"
      onClick={() => {
        document.documentElement.dataset.theme = next;
        try {
          localStorage.setItem(THEME_KEY, next);
        } catch {
          // Private mode: the choice just lasts until the page closes.
        }
        window.dispatchEvent(new Event(THEME_EVENT));
      }}
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
      className={`btn btn-ghost size-9 shrink-0 p-0 ${className}`}
    >
      <Icon className="size-[1.125rem]" aria-hidden />
    </button>
  );
}
