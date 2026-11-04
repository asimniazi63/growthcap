import { describe, expect, it } from "vitest";
import { footerItems, navGroups } from "@/components/shell/nav";
import { GC_ONLY_PAGES } from "@/components/shell/pages";
import { CHORD_MS, GO_TARGETS, goTargets, keyboardBusy, nextFocusIndex, paletteKey, shortcutGroups, singleKeysOn, stepShortcut, type KeyEventLike, type PaletteKeyState, type Pending } from "./shortcuts";

const key = (k: string, over: Partial<KeyEventLike> = {}, at = 1000): KeyEventLike => ({ key: k, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, timeStamp: at, ...over });
const targets = goTargets(true);

describe("stepShortcut", () => {
  it("opens the list on ? and ignores it with Ctrl, Cmd or Alt held", () => {
    expect(stepShortcut(null, key("?", { shiftKey: true }), targets).action).toEqual({ type: "help" });
    expect(stepShortcut(null, key("?", { ctrlKey: true }), targets).action).toBeNull();
    expect(stepShortcut(null, key("?", { metaKey: true }), targets).action).toBeNull();
    expect(stepShortcut(null, key("?", { altKey: true }), targets).action).toBeNull();
  });

  it("goes to a page on g then its letter", () => {
    const first = stepShortcut(null, key("g", {}, 1000), targets);
    expect(first).toEqual({ pending: { at: 1000 }, action: null });
    const second = stepShortcut(first.pending, key("o", {}, 1400), targets);
    expect(second).toEqual({ pending: null, action: { type: "go", href: "/overview" } });
  });

  it("forgets the g after the chord time, and after any other key", () => {
    const pending: Pending = { at: 1000 };
    expect(stepShortcut(pending, key("o", {}, 1000 + CHORD_MS + 1), targets).action).toBeNull();
    expect(stepShortcut(pending, key("o", {}, 1000 + CHORD_MS), targets).action).toEqual({ type: "go", href: "/overview" });
    expect(stepShortcut(pending, key("x", {}, 1200), targets)).toEqual({ pending: null, action: null });
    expect(stepShortcut(pending, key("ArrowDown", {}, 1200), targets)).toEqual({ pending: null, action: null });
  });

  it("keeps the g while a modifier key alone is pressed, so Shift then ? still works after g", () => {
    const pending: Pending = { at: 1000 };
    expect(stepShortcut(pending, key("Shift", { shiftKey: true }, 1100), targets)).toEqual({ pending, action: null });
  });

  it("does not treat a capital G, or a letter with Ctrl, as the chord", () => {
    expect(stepShortcut(null, key("G", { shiftKey: true }), targets).pending).toBeNull();
    expect(stepShortcut(null, key("g", { ctrlKey: true }), targets).pending).toBeNull();
    expect(stepShortcut({ at: 1000 }, key("o", { ctrlKey: true }, 1100), targets).action).toBeNull();
  });

  it("never goes to a page that is not in the list it was given", () => {
    const clientTargets = goTargets(false);
    expect(stepShortcut({ at: 1000 }, key("a", {}, 1100), clientTargets).action).toBeNull();
    expect(stepShortcut({ at: 1000 }, key("a", {}, 1100), targets).action).toEqual({ type: "go", href: "/actions" });
  });
});

describe("keyboardBusy", () => {
  it("is true in text fields, selects and editable regions, and inside a window that holds the keyboard", () => {
    expect(keyboardBusy({ tagName: "INPUT" })).toBe(true);
    expect(keyboardBusy({ tagName: "textarea" })).toBe(true);
    expect(keyboardBusy({ tagName: "SELECT" })).toBe(true);
    expect(keyboardBusy({ tagName: "DIV", isContentEditable: true })).toBe(true);
    expect(keyboardBusy({ tagName: "BUTTON", closest: (s) => (s === '[aria-modal="true"]' ? {} : null) })).toBe(true);
  });

  it("is false on a button or the page body, or with no target", () => {
    expect(keyboardBusy({ tagName: "BUTTON", closest: () => null })).toBe(false);
    expect(keyboardBusy({ tagName: "BODY" })).toBe(false);
    expect(keyboardBusy(null)).toBe(false);
  });
});

describe("the shortcut targets and the list", () => {
  const hrefs = new Set([...navGroups(true).flatMap((g) => g.items.map((i) => i.href)), ...footerItems(true).map((i) => i.href)]);

  it("only point to pages that exist in the sidebar", () => {
    for (const t of GO_TARGETS) expect(hrefs.has(t.href)).toBe(true);
  });

  it("use each letter once, and mark exactly the Growth-Capital-only pages as such", () => {
    expect(new Set(GO_TARGETS.map((t) => t.key)).size).toBe(GO_TARGETS.length);
    for (const t of GO_TARGETS) expect(t.gc).toBe(GC_ONLY_PAGES.includes(t.href));
  });

  it("hide the Growth-Capital-only pages from everyone else", () => {
    expect(goTargets(false).map((t) => t.href)).not.toContain("/actions");
    expect(goTargets(true).map((t) => t.href)).toContain("/actions");
  });

  it("are listed exactly as they are wired: one row per target, and the Ctrl K label follows the platform", () => {
    const rows = (gc: boolean, mac: boolean) => shortcutGroups(gc, mac).flatMap((g) => g.rows);
    const goRows = rows(true, false).filter((r) => r.then);
    expect(goRows.map((r) => r.keys.join(" "))).toEqual(goTargets(true).map((t) => `g ${t.key}`));
    expect(rows(false, false).filter((r) => r.then)).toHaveLength(goTargets(false).length);
    expect(rows(true, false)[0]!.keys).toEqual(["Ctrl K"]);
    expect(rows(true, true)[0]!.keys).toEqual(["⌘K"]);
  });
});

describe("singleKeysOn", () => {
  it("is on unless the stored choice says off", () => {
    expect(singleKeysOn(null)).toBe(true);
    expect(singleKeysOn("on")).toBe(true);
    expect(singleKeysOn("off")).toBe(false);
  });
});

describe("nextFocusIndex", () => {
  it("wraps in both directions and starts at the right end when focus is outside", () => {
    expect(nextFocusIndex(0, 3, false)).toBe(1);
    expect(nextFocusIndex(2, 3, false)).toBe(0);
    expect(nextFocusIndex(0, 3, true)).toBe(2);
    expect(nextFocusIndex(-1, 3, false)).toBe(0);
    expect(nextFocusIndex(-1, 3, true)).toBe(2);
    expect(nextFocusIndex(-1, 0, false)).toBe(-1);
  });
});

describe("paletteKey", () => {
  const idle: PaletteKeyState = { open: true, answering: false, asking: false, query: "" };
  const asking: PaletteKeyState = { open: true, answering: true, asking: true, query: "net sales?" };
  const answered: PaletteKeyState = { open: true, answering: true, asking: false, query: "net sales?" };
  const press = (state: PaletteKeyState, k: string, over: Partial<KeyEventLike & { isComposing: boolean; repeat: boolean }> = {}) => paletteKey(state, { ...key(k), ...over });

  it("opens and closes with Ctrl K or Cmd K, from anywhere, but not with Shift or Alt added", () => {
    expect(press({ ...idle, open: false }, "k", { ctrlKey: true })).toBe("toggle");
    expect(press(idle, "K", { metaKey: true })).toBe("toggle");
    expect(press(asking, "k", { ctrlKey: true })).toBe("toggle");
    expect(press(idle, "k", { ctrlKey: true, shiftKey: true })).toBeNull();
    expect(press(idle, "k", { ctrlKey: true, altKey: true })).toBeNull();
  });

  it("hears nothing else while closed", () => {
    expect(press({ ...idle, open: false }, "Escape")).toBeNull();
    expect(press({ ...idle, open: false }, "Enter")).toBeNull();
    expect(press({ ...idle, open: false }, "?")).toBeNull();
  });

  it("moves, opens and ignores held-down or half-typed Enter while the results are showing", () => {
    expect(press(idle, "ArrowDown")).toBe("down");
    expect(press(idle, "ArrowUp")).toBe("up");
    expect(press(idle, "Enter")).toBe("enter");
    expect(press(idle, "Enter", { repeat: true })).toBeNull();
    expect(press(idle, "Enter", { isComposing: true })).toBeNull();
    expect(press(idle, "Tab")).toBe("focus-input");
    expect(press(idle, "Escape")).toBe("close");
    expect(press(idle, "a")).toBeNull();
  });

  it("opens the shortcuts list on ? only when nothing is typed", () => {
    expect(press(idle, "?", { shiftKey: true })).toBe("shortcuts");
    expect(press({ ...idle, query: "pa" }, "?", { shiftKey: true })).toBeNull();
    expect(press(idle, "?", { ctrlKey: true })).toBeNull();
  });

  it("stops an answer that is coming in on Esc, and closes the window once it has ended", () => {
    expect(press(asking, "Escape")).toBe("stop");
    expect(press(answered, "Escape")).toBe("close");
  });

  it("cannot ask twice: Enter and the arrows are left alone while an answer is on screen, and Tab stays on its controls", () => {
    for (const state of [asking, answered]) {
      expect(press(state, "Enter")).toBeNull();
      expect(press(state, "ArrowDown")).toBeNull();
      expect(press(state, "?", { shiftKey: true })).toBeNull();
      expect(press(state, "Tab")).toBe("trap");
    }
  });
});
