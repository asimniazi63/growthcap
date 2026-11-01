import { describe, expect, it, vi } from "vitest";
import { appearanceScript } from "./script";
import { APPEARANCE_COOKIE, APPEARANCE_EVENT, DEFAULT_APPEARANCE } from "./schemes";

// Runs the real script string against a small fake browser, so the behaviour that no component test can reach is covered:
// the localStorage migration, the "system" listener, and not overriding a person's explicit choice.
function run(opts: { pref: string; mode?: string; osDark?: boolean; cookie?: string; stored?: string; protocol?: string }) {
  const dataset: Record<string, string> = { pref: opts.pref, mode: opts.mode ?? "light" };
  let jar = opts.cookie ?? "";
  const writes: string[] = [];
  const document = {
    documentElement: { dataset },
    get cookie() {
      return jar;
    },
    set cookie(v: string) {
      writes.push(v);
      jar = jar ? `${jar}; ${v.split(";")[0]}` : v.split(";")[0]!;
    },
  };
  const media = { matches: opts.osDark ?? false, listeners: [] as (() => void)[], addEventListener: (_: string, fn: () => void) => media.listeners.push(fn) };
  const observers: (() => void)[] = [];
  class FakeObserver {
    constructor(cb: () => void) {
      observers.push(cb);
    }
    observe() {}
  }
  const dispatched: string[] = [];
  const win = { dispatchEvent: (e: { type: string }) => dispatched.push(e.type) };
  class FakeEvent {
    constructor(public type: string) {}
  }
  const storage = { getItem: (k: string) => (k === "oasis-theme" ? (opts.stored ?? null) : null) };
  new Function("document", "localStorage", "matchMedia", "location", "window", "Event", "MutationObserver", appearanceScript())(
    document,
    storage,
    () => media,
    { protocol: opts.protocol ?? "http:" },
    win,
    FakeEvent,
    FakeObserver,
  );
  return {
    dataset,
    writes,
    dispatched,
    osChanges: (dark: boolean) => {
      media.matches = dark;
      media.listeners.forEach((fn) => fn());
    },
    domChanged: () => observers.forEach((fn) => fn()),
  };
}

describe("the inline appearance script", () => {
  it("is valid JavaScript and only interpolates constants", () => {
    const script = appearanceScript();
    expect(() => new Function(script)).not.toThrow();
    expect(script).toContain(APPEARANCE_COOKIE);
    expect(script).toContain(APPEARANCE_EVENT);
  });

  it("carries a saved light or dark choice from before schemes existed over into the cookie, once", () => {
    const r = run({ pref: "system", stored: "dark" });
    expect(r.writes).toEqual([`${APPEARANCE_COOKIE}=${DEFAULT_APPEARANCE.scheme}.dark; Path=/; Max-Age=31536000; SameSite=Lax`]);
    expect(r.dataset).toMatchObject({ pref: "dark", mode: "dark" });
  });

  it("adds Secure on https, and ignores a stored value that is not light or dark", () => {
    expect(run({ pref: "system", stored: "light", protocol: "https:" }).writes[0]).toMatch(/; Secure$/);
    expect(run({ pref: "system", stored: "sepia" }).writes).toEqual([]);
  });

  it("does not migrate when an appearance cookie exists, and a look-alike cookie name does not count as one", () => {
    expect(run({ pref: "light", cookie: `${APPEARANCE_COOKIE}=ledger.light`, stored: "dark" }).writes).toEqual([]);
    expect(run({ pref: "system", cookie: `x-${APPEARANCE_COOKIE}=ledger.light`, stored: "dark" }).writes).toHaveLength(1);
  });

  it("sets the mode from the device when the choice is system, and follows the device afterwards", () => {
    const r = run({ pref: "system", mode: "light", osDark: true });
    expect(r.dataset.mode).toBe("dark");
    expect(r.dispatched).toEqual([APPEARANCE_EVENT]);
    r.osChanges(false);
    expect(r.dataset.mode).toBe("light");
  });

  it("never lets the device override an explicit Light or Dark, even after the device changes", () => {
    const r = run({ pref: "dark", mode: "dark", osDark: false });
    r.osChanges(true);
    r.osChanges(false);
    expect(r.dataset.mode).toBe("dark");
    expect(r.dispatched).toEqual([]);
  });

  it("starts following the device when the person switches to system after the page loaded with an explicit choice", () => {
    const r = run({ pref: "dark", mode: "dark", osDark: false });
    r.dataset.pref = "system";
    r.domChanged();
    expect(r.dataset.mode).toBe("light");
    r.osChanges(true);
    expect(r.dataset.mode).toBe("dark");
  });

  it("corrects data-mode when a server re-render resets it to light for a system choice on a dark device", () => {
    const r = run({ pref: "system", mode: "light", osDark: true });
    r.dataset.mode = "light"; // what React writes after router.refresh()
    r.domChanged();
    expect(r.dataset.mode).toBe("dark");
  });

  it("keeps working when localStorage or matchMedia throw", () => {
    expect(() => new Function("document", "localStorage", "matchMedia", "location", "window", "Event", "MutationObserver", appearanceScript())(
      { documentElement: { dataset: {} }, cookie: "" },
      { getItem: vi.fn(() => { throw new Error("blocked"); }) },
      () => { throw new Error("nope"); },
      { protocol: "http:" },
      {},
      class {},
      class {},
    )).not.toThrow();
  });
});
