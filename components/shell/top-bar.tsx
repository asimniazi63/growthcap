import { PaletteButton } from "@/components/shell/command-palette";
import { ShortcutsButton } from "@/components/shell/shortcuts-help";

// The Sorbet scheme's white bar above the page: a wide pill that opens the command palette (the same button and the same Ctrl K
// event as the sidebar's), and a small ? beside it that opens the keyboard shortcuts. It is always in the markup and hidden by
// default; app/sorbet.css shows it for the Sorbet scheme on large screens, so switching schemes never needs a reload. The pill is
// styled from there too.
export function TopBar() {
  return (
    <div className="app-topbar sticky top-0 z-20 hidden gap-2.5">
      <div className="app-topbar-search w-full">
        <PaletteButton />
      </div>
      <ShortcutsButton />
    </div>
  );
}
