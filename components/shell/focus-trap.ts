import { nextFocusIndex } from "@/lib/shell/shortcuts";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), [tabindex="0"]';

// Tab and Shift Tab stay inside a window: from the last control it goes to the first, and the other way round.
export function trapTab(e: KeyboardEvent, root: HTMLElement | null): void {
  e.preventDefault();
  const items = root ? Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)) : [];
  const current = document.activeElement instanceof HTMLElement ? items.indexOf(document.activeElement) : -1;
  items[nextFocusIndex(current, items.length, e.shiftKey)]?.focus();
}
