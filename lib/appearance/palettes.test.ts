import { describe, expect, it } from "vitest";
import { COLOR_TOKENS, PALETTES, SHADOW_TOKENS } from "./palettes";
import { SCHEME_IDS, type Mode } from "./schemes";

const MODES: Mode[] = ["light", "dark"];
const HEX = /^#[0-9a-f]{6}$/i;

// WCAG relative luminance and contrast ratio.
function luminance(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}
function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// [foreground, background, minimum ratio]
const CHECKS: [string, string, number][] = [
  ["ink", "paper", 7], ["ink", "surface", 7], ["ink-2", "surface", 4.5], ["ink-2", "paper", 4.5], ["ink-3", "surface", 4.5], ["ink-3", "paper", 4.5],
  ["on-brand", "brand", 4.5], ["brand", "surface", 3], ["brand", "paper", 3], ["brand-strong", "brand-tint", 4.5], ["brand-strong", "surface", 4.5],
  ["ahead", "ahead-tint", 4.5], ["ahead", "surface", 4.5], ["behind", "behind-tint", 4.5], ["behind", "surface", 4.5],
  ["warn", "warn-tint", 4.5], ["warn", "surface", 4.5], ["on-inverse", "inverse", 7], ["estimate", "surface", 3], ["on-mark", "mark", 3], ["on-rail-3", "rail", 4.5],
];

describe("palettes", () => {
  it("defines every scheme and mode", () => {
    expect(Object.keys(PALETTES).sort()).toEqual([...SCHEME_IDS].sort());
    for (const scheme of SCHEME_IDS) expect(Object.keys(PALETTES[scheme]).sort()).toEqual(["dark", "light"]);
  });

  for (const scheme of SCHEME_IDS) {
    for (const mode of MODES) {
      describe(`${scheme} ${mode}`, () => {
        const tokens = PALETTES[scheme][mode];

        it("defines every token and nothing else", () => {
          const wanted = [...COLOR_TOKENS, ...SHADOW_TOKENS].sort();
          expect(Object.keys(tokens).sort()).toEqual(wanted);
          for (const name of wanted) expect(tokens[name as keyof typeof tokens], name).toMatch(/\S/);
        });

        it("keeps the text and status colours readable", () => {
          const failures: string[] = [];
          for (const [fg, bg, need] of CHECKS) {
            const a = tokens[fg as keyof typeof tokens];
            const b = tokens[bg as keyof typeof tokens];
            // A value built from other tokens (var, color-mix, rgb) has no fixed colour to measure, so only plain hex pairs are checked.
            if (!HEX.test(a) || !HEX.test(b)) continue;
            const ratio = contrast(a, b);
            if (ratio < need) failures.push(`${fg} on ${bg} is ${ratio.toFixed(2)}, needs ${need}`);
          }
          expect(failures).toEqual([]);
        });
      });
    }
  }
});

// Sorbet's rail text is white at partial opacity over the navy rail, so the pair has no single hex to measure: composite it first.
describe("sorbet rail text", () => {
  const over = (alpha: number, fg: string, bg: string) => {
    const mix = (i: number) => Math.round(alpha * parseInt(fg.slice(i, i + 2), 16) + (1 - alpha) * parseInt(bg.slice(i, i + 2), 16));
    return `#${[1, 3, 5].map((i) => mix(i).toString(16).padStart(2, "0")).join("")}`;
  };
  for (const mode of MODES) {
    it(`is readable on the ${mode} rail`, () => {
      const t = PALETTES.sorbet[mode];
      for (const name of ["on-rail-2", "on-rail-3"] as const) {
        const alpha = Number(/\/\s*([\d.]+)\)/.exec(t[name])?.[1]);
        expect(alpha, name).toBeGreaterThan(0);
        expect(contrast(over(alpha, "#ffffff", t.rail), t.rail), name).toBeGreaterThanOrEqual(4.5);
      }
    });
  }
});
