import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { APPEARANCE_COOKIE, DEFAULT_APPEARANCE } from "./schemes";
import { APPEARANCE_EVENT, applyAppearance, resolveMode, useAppearance } from "./use-appearance";

// The repo has no DOM library (the other component tests render to a string), so these tests stand in a tiny window and document
// and run the hook with React's two hooks replaced by plain calls. That covers what the hook decides; React's own subscribing is
// checked by capturing the subscribe function it hands to useSyncExternalStore.
const react = vi.hoisted(() => ({ subscribe: null as null | ((onChange: () => void) => () => void) }));
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useSyncExternalStore: (subscribe: (onChange: () => void) => () => void, getSnapshot: () => string) => {
    react.subscribe = subscribe;
    return getSnapshot();
  },
  useCallback: <T,>(fn: T) => fn,
}));

interface Dom {
  dataset: Record<string, string | undefined>;
  jar: Map<string, string>;
  writes: string[];
  system: { dark: boolean };
  blockCookies: () => void;
}

function installDom(opts: { protocol?: string; dark?: boolean } = {}): Dom {
  const dataset: Dom["dataset"] = {};
  const jar = new Map<string, string>();
  const writes: string[] = [];
  const system = { dark: opts.dark ?? false };
  let blocked = false;
  const win = Object.assign(new EventTarget(), {
    location: { protocol: opts.protocol ?? "http:" },
    matchMedia: (query: string) => ({ matches: query.includes("dark") && system.dark }),
  });
  const doc = {
    documentElement: { dataset },
    get cookie() {
      return [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
    },
    set cookie(raw: string) {
      if (blocked) throw new Error("cookies blocked");
      writes.push(raw);
      const [name = "", ...rest] = (raw.split(";")[0] ?? "").split("=");
      jar.set(name, rest.join("="));
    },
  };
  vi.stubGlobal("window", win);
  vi.stubGlobal("document", doc);
  return { dataset, jar, writes, system, blockCookies: () => (blocked = true) };
}

let dom: Dom;
beforeEach(() => {
  react.subscribe = null;
  dom = installDom();
});
afterEach(() => vi.unstubAllGlobals());

describe("applyAppearance", () => {
  it("sets data-scheme, data-pref and data-mode on <html> and writes the cookie", () => {
    applyAppearance({ scheme: "sorbet", mode: "dark" });
    expect(dom.dataset).toMatchObject({ scheme: "sorbet", pref: "dark", mode: "dark" });
    expect(dom.jar.get(APPEARANCE_COOKIE)).toBe("sorbet.dark");
    expect(dom.writes[0]).toBe(`${APPEARANCE_COOKIE}=sorbet.dark; Path=/; Max-Age=31536000; SameSite=Lax`);
  });

  it("adds Secure to the cookie on https", () => {
    dom = installDom({ protocol: "https:" });
    applyAppearance({ scheme: "dusk", mode: "light" });
    expect(dom.writes[0]).toMatch(/; Secure$/);
  });

  it("resolves match-my-device through matchMedia while keeping the choice as system", () => {
    dom.system.dark = true;
    applyAppearance({ scheme: "ledger", mode: "system" });
    expect(dom.dataset).toMatchObject({ scheme: "ledger", pref: "system", mode: "dark" });
    expect(dom.jar.get(APPEARANCE_COOKIE)).toBe("ledger.system");

    dom.system.dark = false;
    applyAppearance({ scheme: "ledger", mode: "system" });
    expect(dom.dataset.mode).toBe("light");
  });

  it("tells listeners with the appearance event", () => {
    const seen = vi.fn();
    window.addEventListener(APPEARANCE_EVENT, seen);
    applyAppearance({ scheme: "graphite", mode: "light" });
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it("still applies the choice when cookies are blocked", () => {
    dom.blockCookies();
    const seen = vi.fn();
    window.addEventListener(APPEARANCE_EVENT, seen);
    expect(() => applyAppearance({ scheme: "lagoon", mode: "dark" })).not.toThrow();
    expect(dom.dataset).toMatchObject({ scheme: "lagoon", pref: "dark", mode: "dark" });
    expect(seen).toHaveBeenCalledTimes(1);
  });
});

describe("resolveMode", () => {
  it("passes light and dark through and asks the device only for system", () => {
    dom.system.dark = true;
    expect(resolveMode("light")).toBe("light");
    expect(resolveMode("dark")).toBe("dark");
    expect(resolveMode("system")).toBe("dark");
    dom.system.dark = false;
    expect(resolveMode("system")).toBe("light");
  });
});

describe("useAppearance", () => {
  it("returns the values from the <html> attributes", () => {
    Object.assign(dom.dataset, { scheme: "dusk", pref: "system", mode: "dark" });
    expect(useAppearance()).toMatchObject({ scheme: "dusk", pref: "system", mode: "dark" });
  });

  it("falls back to the default for missing or unknown attributes", () => {
    expect(useAppearance()).toMatchObject({ scheme: DEFAULT_APPEARANCE.scheme, pref: DEFAULT_APPEARANCE.mode, mode: "light" });
    Object.assign(dom.dataset, { scheme: "neon", pref: "purple", mode: "purple" });
    expect(useAppearance()).toMatchObject({ scheme: DEFAULT_APPEARANCE.scheme, pref: DEFAULT_APPEARANCE.mode, mode: "light" });
  });

  it("updates after setScheme, keeping the chosen mode", () => {
    applyAppearance({ scheme: "sorbet", mode: "dark" });
    useAppearance().setScheme("ledger");
    expect(useAppearance()).toMatchObject({ scheme: "ledger", pref: "dark", mode: "dark" });
    expect(dom.jar.get(APPEARANCE_COOKIE)).toBe("ledger.dark");
  });

  it("updates after setMode, keeping the chosen scheme", () => {
    applyAppearance({ scheme: "graphite", mode: "dark" });
    useAppearance().setMode("light");
    expect(useAppearance()).toMatchObject({ scheme: "graphite", pref: "light", mode: "light" });
    expect(dom.jar.get(APPEARANCE_COOKIE)).toBe("graphite.light");
  });

  it("resolves system through matchMedia after setMode", () => {
    dom.system.dark = true;
    applyAppearance({ scheme: "sorbet", mode: "light" });
    useAppearance().setMode("system");
    expect(useAppearance()).toMatchObject({ scheme: "sorbet", pref: "system", mode: "dark" });
    dom.system.dark = false;
    useAppearance().setMode("system");
    expect(useAppearance()).toMatchObject({ pref: "system", mode: "light" });
  });

  it("reset goes back to the default scheme and match-my-device", () => {
    applyAppearance({ scheme: "dusk", mode: "dark" });
    useAppearance().reset();
    expect(useAppearance()).toMatchObject({ scheme: DEFAULT_APPEARANCE.scheme, pref: DEFAULT_APPEARANCE.mode, mode: "light" });
    expect(dom.jar.get(APPEARANCE_COOKIE)).toBe(`${DEFAULT_APPEARANCE.scheme}.${DEFAULT_APPEARANCE.mode}`);
  });

  it("subscribes to the appearance event and stops when unsubscribed", () => {
    useAppearance();
    const onChange = vi.fn();
    const unsubscribe = react.subscribe!(onChange);
    applyAppearance({ scheme: "lagoon", mode: "light" });
    expect(onChange).toHaveBeenCalledTimes(1);
    unsubscribe();
    applyAppearance({ scheme: "lagoon", mode: "dark" });
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
