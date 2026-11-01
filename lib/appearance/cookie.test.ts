import { describe, expect, it } from "vitest";
import { cookieString, parseAppearance, serializeAppearance } from "./cookie";
import { APPEARANCE_COOKIE, DEFAULT_APPEARANCE, MODE_PREFS, SCHEME_IDS } from "./schemes";

describe("parseAppearance", () => {
  it("accepts every valid scheme and mode pair", () => {
    for (const scheme of SCHEME_IDS) {
      for (const mode of MODE_PREFS) {
        expect(parseAppearance(`${scheme}.${mode}`)).toEqual({ scheme, mode });
      }
    }
  });

  it("falls back to the default when the cookie is missing or empty", () => {
    expect(parseAppearance(undefined)).toEqual(DEFAULT_APPEARANCE);
    expect(parseAppearance(null)).toEqual(DEFAULT_APPEARANCE);
    expect(parseAppearance("")).toEqual(DEFAULT_APPEARANCE);
  });

  it("falls back to the default for garbage", () => {
    for (const raw of ["garbage", ".", "..", "<script>alert(1)</script>", "sorbet-dark", "SORBET.DARK", " sorbet . dark "]) {
      expect(parseAppearance(raw)).toEqual(DEFAULT_APPEARANCE);
    }
  });

  it("keeps a valid scheme when the mode is wrong or missing, and the other way round", () => {
    expect(parseAppearance("sorbet")).toEqual({ scheme: "sorbet", mode: DEFAULT_APPEARANCE.mode });
    expect(parseAppearance("sorbet.purple")).toEqual({ scheme: "sorbet", mode: DEFAULT_APPEARANCE.mode });
    expect(parseAppearance("sorbet.")).toEqual({ scheme: "sorbet", mode: DEFAULT_APPEARANCE.mode });
    expect(parseAppearance("neon.dark")).toEqual({ scheme: DEFAULT_APPEARANCE.scheme, mode: "dark" });
    expect(parseAppearance(".dark")).toEqual({ scheme: DEFAULT_APPEARANCE.scheme, mode: "dark" });
    expect(parseAppearance(" sorbet.dark")).toEqual({ scheme: DEFAULT_APPEARANCE.scheme, mode: "dark" });
  });

  it("ignores anything after a third dot, so extra dots cannot smuggle a value in", () => {
    expect(parseAppearance("sorbet.dark.extra")).toEqual({ scheme: "sorbet", mode: "dark" });
    expect(parseAppearance("neon.dark.sorbet")).toEqual({ scheme: DEFAULT_APPEARANCE.scheme, mode: "dark" });
  });
});

describe("serializeAppearance and cookieString", () => {
  it("writes scheme.mode, which parseAppearance reads back", () => {
    expect(serializeAppearance({ scheme: "dusk", mode: "system" })).toBe("dusk.system");
    for (const scheme of SCHEME_IDS) {
      for (const mode of MODE_PREFS) {
        expect(parseAppearance(serializeAppearance({ scheme, mode }))).toEqual({ scheme, mode });
      }
    }
  });

  it("sets one year, the whole site and SameSite Lax", () => {
    expect(cookieString({ scheme: "sorbet", mode: "dark" }, false)).toBe(`${APPEARANCE_COOKIE}=sorbet.dark; Path=/; Max-Age=31536000; SameSite=Lax`);
  });

  it("adds Secure only when asked", () => {
    const a = { scheme: "graphite", mode: "light" } as const;
    expect(cookieString(a, true)).toBe(`${APPEARANCE_COOKIE}=graphite.light; Path=/; Max-Age=31536000; SameSite=Lax; Secure`);
    expect(cookieString(a, false)).not.toContain("Secure");
  });

  it("carries no HttpOnly flag, because the browser has to write and read it", () => {
    expect(cookieString(DEFAULT_APPEARANCE, true)).not.toContain("HttpOnly");
  });
});
