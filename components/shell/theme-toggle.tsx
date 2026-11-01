"use client";

import { Moon, Sun } from "lucide-react";
import { useAppearance } from "@/lib/appearance/use-appearance";

// A one-click light/dark shortcut. It goes through the same hook as the Settings page, so the two can never disagree: dark becomes
// light, anything else (light, or "match my device" showing light) becomes dark.

export function ThemeToggle({ className = "" }: { className?: string }) {
  const { mode, setMode } = useAppearance();
  const next = mode === "dark" ? "light" : "dark";
  const Icon = mode === "dark" ? Sun : Moon;

  return (
    <button
      type="button"
      onClick={() => setMode(next)}
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
      className={`btn btn-ghost size-9 shrink-0 p-0 ${className}`}
    >
      <Icon className="size-[1.125rem]" aria-hidden />
    </button>
  );
}
