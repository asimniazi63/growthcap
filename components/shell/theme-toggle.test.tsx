import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { APPEARANCE_COOKIE } from "@/lib/appearance/schemes";
import { ThemeToggle } from "./theme-toggle";

// No DOM library in this repo, so the toggle is called as a function with a stand-in window and document, and React's two hooks
// replaced by plain calls. Clicking is calling the button's onClick; "re-rendering" is calling the component again.
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => string) => getSnapshot(),
  useCallback: <T,>(fn: T) => fn,
}));

interface ButtonProps {
  onClick: () => void;
  "aria-label": string;
  title: string;
  className: string;
}

const dataset: Record<string, string | undefined> = {};
const jar = new Map<string, string>();
let dark = false;

beforeEach(() => {
  for (const k of Object.keys(dataset)) delete dataset[k];
  jar.clear();
  dark = false;
  vi.stubGlobal(
    "window",
    Object.assign(new EventTarget(), {
      location: { protocol: "http:" },
      matchMedia: (q: string) => ({ matches: q.includes("dark") && dark }),
    }),
  );
  vi.stubGlobal("document", {
    documentElement: { dataset },
    get cookie() {
      return [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
    },
    set cookie(raw: string) {
      const [name = "", ...rest] = (raw.split(";")[0] ?? "").split("=");
      jar.set(name, rest.join("="));
    },
  });
});
afterEach(() => vi.unstubAllGlobals());

const render = (props: { className?: string } = {}) => ThemeToggle(props) as ReactElement<ButtonProps>;

describe("ThemeToggle", () => {
  it("offers dark mode while the page is light, and flips to dark on click", () => {
    Object.assign(dataset, { scheme: "sorbet", pref: "light", mode: "light" });
    const before = render();
    expect(before.props["aria-label"]).toBe("Switch to dark mode");
    expect(before.props.title).toBe("Switch to dark mode");

    before.props.onClick();
    expect(dataset).toMatchObject({ scheme: "sorbet", pref: "dark", mode: "dark" });
    expect(render().props["aria-label"]).toBe("Switch to light mode");
  });

  it("flips back to light on a second click", () => {
    Object.assign(dataset, { scheme: "dusk", pref: "light", mode: "light" });
    render().props.onClick();
    render().props.onClick();
    expect(dataset).toMatchObject({ scheme: "dusk", pref: "light", mode: "light" });
    expect(render().props["aria-label"]).toBe("Switch to dark mode");
  });

  it("saves the choice in the cookie and keeps the scheme", () => {
    Object.assign(dataset, { scheme: "ledger", pref: "light", mode: "light" });
    render().props.onClick();
    expect(jar.get(APPEARANCE_COOKIE)).toBe("ledger.dark");
    render().props.onClick();
    expect(jar.get(APPEARANCE_COOKIE)).toBe("ledger.light");
  });

  it("turns a dark page that follows the device into a fixed light page", () => {
    dark = true;
    Object.assign(dataset, { scheme: "graphite", pref: "system", mode: "dark" });
    const button = render();
    expect(button.props["aria-label"]).toBe("Switch to light mode");
    button.props.onClick();
    expect(dataset).toMatchObject({ pref: "light", mode: "light" });
    expect(jar.get(APPEARANCE_COOKIE)).toBe("graphite.light");
  });

  it("turns a light page that follows the device into a fixed dark page", () => {
    Object.assign(dataset, { scheme: "graphite", pref: "system", mode: "light" });
    render().props.onClick();
    expect(dataset).toMatchObject({ pref: "dark", mode: "dark" });
    expect(jar.get(APPEARANCE_COOKIE)).toBe("graphite.dark");
  });

  it("keeps the button classes and adds the className it is given", () => {
    const button = render({ className: "extra" });
    expect(button.props.className).toBe("btn btn-ghost size-9 shrink-0 p-0 extra");
  });
});
