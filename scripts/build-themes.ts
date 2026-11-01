// Writes app/themes.css from lib/appearance/palettes.ts. Run it with `npm run themes:build` after changing a palette.
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderThemesCss } from "../lib/appearance/themes-css";

const target = resolve(import.meta.dirname, "../app/themes.css");
writeFileSync(target, renderThemesCss());
console.log(`wrote ${target}`);
