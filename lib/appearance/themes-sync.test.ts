import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { renderThemesCss } from "./themes-css";

// app/themes.css is generated from palettes.ts. If this fails, run `npm run themes:build` and keep the result.
it("app/themes.css matches the palettes", () => {
  const onDisk = readFileSync(resolve(process.cwd(), "app/themes.css"), "utf8");
  expect(onDisk).toBe(renderThemesCss());
});
