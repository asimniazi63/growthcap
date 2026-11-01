import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { COLOR_TOKENS, PALETTES, SHADOW_TOKENS } from "./palettes";
import { DEFAULT_APPEARANCE } from "./schemes";

describe("the default appearance", () => {
  it("is Sorbet, following the device's light or dark setting", () => {
    expect(DEFAULT_APPEARANCE).toEqual({ scheme: "sorbet", mode: "system" });
  });

  it("is also the fallback in globals.css, so a page with no data-scheme still looks like the default", () => {
    const css = readFileSync(path.join(process.cwd(), "app/globals.css"), "utf8");
    const theme = css.slice(css.indexOf("@theme {"), css.indexOf("\n}\n", css.indexOf("@theme {")));
    const tokens = PALETTES[DEFAULT_APPEARANCE.scheme].light as Record<string, string>;
    for (const name of COLOR_TOKENS) expect(theme, `--color-${name}`).toContain(`--color-${name}: ${tokens[name]};`);
    for (const name of SHADOW_TOKENS) expect(theme, `--${name}`).toContain(`--${name}: ${tokens[name]};`);
  });
});
