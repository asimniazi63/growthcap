import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";

// Colours come from the tokens (bg-surface, text-ink-2, var(--color-brand)) so every scheme can restyle them. A hex literal in a
// component would stay the same in all five schemes, so this test fails on one, and on rgb(), rgba(), hsl() and hsla() literals with
// numbers in them. Colour values belong in lib/appearance/palettes.ts. (A colour in a CSS file or a CSS variable is fine: it is a token.)
const ROOT = resolve(process.cwd());
const HEX_COLOUR = /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3})\b|\b(?:rgba?|hsla?)\(\s*\d/gi;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

it("no component or page uses a hex, rgb or hsl colour literal", () => {
  const found: string[] = [];
  for (const file of ["app", "components"].flatMap((d) => sourceFiles(join(ROOT, d)))) {
    readFileSync(file, "utf8").split("\n").forEach((line, i) => {
      for (const hit of line.match(HEX_COLOUR) ?? []) found.push(`${file.slice(ROOT.length + 1)}:${i + 1} ${hit}`);
    });
  }
  expect(found).toEqual([]);
});
