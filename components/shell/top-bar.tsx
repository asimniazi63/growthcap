import { PaletteButton } from "@/components/shell/command-palette";

// The Sorbet scheme's white bar above the page, with one control: a wide pill that opens the command palette (the same
// button and the same Ctrl K event as the sidebar's). It is always in the markup and hidden by default; app/sorbet.css shows it
// for the Sorbet scheme on large screens, so switching schemes never needs a reload. The pill is styled from there too.
export function TopBar() {
  return (
    <div className="app-topbar sticky top-0 z-20 hidden">
      <div className="app-topbar-search w-full">
        <PaletteButton />
      </div>
    </div>
  );
}
