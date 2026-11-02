import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { goTargets } from "@/lib/shell/shortcuts";
import { ShortcutsButton, ShortcutsList } from "./shortcuts-help";

const html = (gc: boolean, mac = false) => renderToStaticMarkup(<ShortcutsList gc={gc} mac={mac} />);

describe("ShortcutsList", () => {
  it("lists the search shortcut with the platform's own label, and the keys that are wired", () => {
    expect(html(true)).toContain(">Ctrl K<");
    expect(html(true, true)).toContain(">⌘K<");
    const out = html(false);
    for (const text of ["Anywhere", "In the search window", "Show this list", "Move through the results", "Open the result, or ask what you typed", "Stop an answer that is coming in, or close the window"]) expect(out).toContain(text);
  });

  it("shows one 'g then letter' row per page the person can open, and only those", () => {
    for (const gc of [true, false]) {
      const out = html(gc);
      for (const t of goTargets(gc)) expect(out).toContain(`Go to ${t.label}`);
      expect(out.match(/Go to /g)?.length).toBe(goTargets(gc).length);
    }
    expect(html(false)).not.toContain("Go to Actions");
    expect(html(true)).toContain("Go to Actions");
  });

  it("draws every key as a key chip, with 'then' between the keys that are pressed one after the other", () => {
    const out = html(true);
    expect(out).toMatch(/<kbd[^>]*>g<\/kbd><span>then<\/span><kbd[^>]*>o<\/kbd>/);
    expect(out).toContain(">Esc<");
    expect(out).toContain(">↑<");
    expect(out).toContain(">↓<");
  });

  it("names each group for assistive tools", () => {
    const out = html(true);
    expect(out.match(/<section aria-labelledby="/g)).toHaveLength(2);
    expect(out).toMatch(/<h3 id="[^"]+"[^>]*>Anywhere<\/h3>/);
  });
});

describe("ShortcutsButton", () => {
  it("is a labelled button that says which key does the same", () => {
    const out = renderToStaticMarkup(<ShortcutsButton />);
    expect(out).toContain('aria-label="Keyboard shortcuts"');
    expect(out).toContain('aria-keyshortcuts="?"');
    expect(out).toContain('aria-haspopup="dialog"');
    expect(out).toContain('type="button"');
  });
});
