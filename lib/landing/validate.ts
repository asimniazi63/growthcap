import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AppError } from "../errors";
import type { LandingCopy, LandingFile } from "./types";

// Two layers. Our own lint is pure and catches what Theme Check does not: a typed price, a handle the store does not have,
// a script or a link to another site. Theme Check (Shopify's linter) catches invalid Liquid and theme mistakes.

const CURRENCY = /[$€£¥₹₽₩₺฿]|\b(?:USD|EUR|GBP|CAD|AUD|NZD|JPY|CHF|SEK|NOK|DKK)\b|\b(?:dollars?|euros?|pounds?|bucks)\b/i;
const ALLOWED_TAGS = new Set(["assign", "if", "elsif", "else", "endif", "unless", "endunless", "comment", "endcomment", "stylesheet", "endstylesheet", "schema", "endschema"]);

export interface LintOptions {
  handles: ReadonlySet<string>; // the handles of this store's active products
  allowedNumbers?: ReadonlySet<string>; // numbers the campaign row holds (see campaignNumbers)
}

// The text a visitor reads: no tags, no Liquid, no CSS, no schema.
function visibleText(content: string): string {
  return content
    .replace(/\{%-?\s*(comment|schema|stylesheet|style|javascript)\s*-?%\}[\s\S]*?\{%-?\s*end\1\s*-?%\}/g, " ")
    .replace(/\{\{[\s\S]*?\}\}/g, " ")
    .replace(/\{%[\s\S]*?%\}/g, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&#?\w+;/g, " ");
}

function numberProblems(text: string, where: string, allowed: ReadonlySet<string>): string[] {
  const out: string[] = [];
  if (CURRENCY.test(text)) out.push(`${where} has a currency symbol or word. Prices are never written in the copy; the page reads them from the store.`);
  if (/\d+[.,]\d{1,2}\b/.test(text)) out.push(`${where} has a number that looks like a price. Prices are never written in the copy.`);
  for (const found of text.match(/(?<![\w.])\d[\d,]*(?![\w])/g) ?? []) {
    const hit = found.replace(/,+$/, "");
    const n = String(Number(hit.replace(/,/g, "")));
    const year = /^(19|20)\d{2}$/.test(n);
    if (!year && !allowed.has(n)) out.push(`${where} has the number ${hit}, which is not in the campaign details. Leave numbers out of the copy.`);
  }
  return out;
}

// Checks the model's words before anything is built, so that the message it gets back names the field.
export function lintCopy(copy: LandingCopy, allowedNumbers: ReadonlySet<string> = new Set()): string[] {
  const fields: [string, string][] = [["headline", copy.headline], ["subhead", copy.subhead], ["ctaLabel", copy.ctaLabel], ...copy.bullets.map((b, i): [string, string] => [`bullets[${i}]`, b])];
  const out: string[] = [];
  for (const [name, text] of fields) {
    if (/<\s*\/?\s*(script|iframe|object|embed|style|link|form)\b/i.test(text)) out.push(`${name} has a script or embed tag. Write plain words only.`);
    if (/\bon[a-z]+\s*=/i.test(text) || /javascript\s*:/i.test(text)) out.push(`${name} has an event handler or a javascript: link. Write plain words only.`);
    if (/(?:https?:)?\/\/\S|\bwww\./i.test(text)) out.push(`${name} has a link. Write plain words only; the page links to the store's own products.`);
    if (/\{\{|\{%/.test(text)) out.push(`${name} has Liquid syntax. Write plain words only.`);
    out.push(...numberProblems(text, name, allowedNumbers));
  }
  return out;
}

// Our own lint of the files that would be written. Pure.
export function lintLanding(files: LandingFile[], opts: LintOptions): string[] {
  const out: string[] = [];
  const allowed = opts.allowedNumbers ?? new Set<string>();
  for (const f of files) {
    const at = f.path;
    if (/<\s*script\b/i.test(f.content)) out.push(`${at}: has a script tag.`);
    if (/\son[a-z]+\s*=/i.test(f.content)) out.push(`${at}: has an event handler attribute.`);
    if (/javascript\s*:/i.test(f.content)) out.push(`${at}: has a javascript: link.`);
    if (/https?:\/\/|(?:^|[\s"'(=])\/\/[a-z0-9-]+\.[a-z]/i.test(f.content) || /@import|\burl\s*\(/i.test(f.content)) out.push(`${at}: links to another site or loads an external file.`);

    if (f.path.endsWith(".json")) {
      try {
        JSON.parse(f.content);
      } catch {
        out.push(`${at}: is not valid JSON.`);
      }
      continue;
    }

    for (const tag of f.content.matchAll(/\{%-?\s*([a-z_]+)/g)) {
      if (!ALLOWED_TAGS.has(tag[1]!)) out.push(`${at}: uses the Liquid tag "${tag[1]}", which a landing page does not need.`);
    }
    const used = [...f.content.matchAll(/all_products\[\s*(['"])(.*?)\1\s*\]/g)].map((m) => m[2]!);
    if (/all_products(?!\[\s*['"])/.test(f.content)) out.push(`${at}: reads all_products without a fixed handle.`);
    for (const h of used) if (!opts.handles.has(h)) out.push(`${at}: the product handle "${h}" does not exist in this store.`);
    if (f.path.startsWith("sections/") && used.length === 0) out.push(`${at}: shows no products.`);
    out.push(...numberProblems(visibleText(f.content), at, allowed));
  }
  return out;
}

// ---- Theme Check

// A theme the linter accepts, with only the files a landing page needs around it.
const SKELETON: LandingFile[] = [
  { path: "layout/theme.liquid", content: `<!doctype html>\n<html lang="en">\n<head>\n  <title>{{ page_title }}</title>\n  {{ content_for_header }}\n</head>\n<body>\n  {{ content_for_layout }}\n</body>\n</html>\n` },
  { path: "config/settings_schema.json", content: "[]\n" },
  { path: "config/settings_data.json", content: "{}\n" },
  { path: "locales/en.default.json", content: "{}\n" },
  { path: "templates/index.json", content: `{ "sections": {}, "order": [] }\n` },
];

export interface ThemeCheckResult {
  errors: string[];
  warnings: string[];
}
export type ThemeCheckFn = (files: LandingFile[]) => Promise<ThemeCheckResult>;

const CHECK_TIMEOUT_MS = 30_000;

// Runs Shopify's Theme Check on our files inside a throwaway theme. Only offenses in our own files count.
export const runThemeCheck: ThemeCheckFn = async (files) => {
  const root = await mkdtemp(path.join(tmpdir(), "oasis-theme-"));
  try {
    for (const f of [...SKELETON, ...files, { path: ".theme-check.yml", content: "extends: theme-check:recommended\n" }]) {
      const at = path.join(root, f.path);
      await mkdir(path.dirname(at), { recursive: true });
      await writeFile(at, f.content, "utf8");
    }
    const { themeCheckRun, Severity } = await import("@shopify/theme-check-node"); // loaded on first use: it is a large package
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new AppError("INTERNAL_ERROR", "Theme Check did not finish in time.")), CHECK_TIMEOUT_MS);
    });
    const run = await Promise.race([themeCheckRun(root), timeout]).finally(() => clearTimeout(timer));
    const ours = new Set(files.map((f) => f.path));
    const result: ThemeCheckResult = { errors: [], warnings: [] };
    for (const o of run.offenses) {
      const rel = path.relative(root, fileURLToPath(o.uri));
      if (!ours.has(rel)) continue;
      const line = `${rel} line ${o.start.line + 1}: ${o.message} (${o.check})`;
      if (o.severity === Severity.ERROR) result.errors.push(line);
      else result.warnings.push(line);
    }
    return result;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
};

export interface Validation {
  ok: boolean;
  problems: string[];
  notes: string[]; // what ran and passed, for the approval card
}

// A draft that passed, kept for a minute: the tool checks it and the ledger's diff checks it again right after, and
// Theme Check takes about a second. Failures are never kept.
const passed = new Map<string, { at: number; value: Validation }>();
const KEEP_MS = 60_000;

// Our lint, then Theme Check. A problem from either fails the draft.
export async function validateLanding(files: LandingFile[], opts: LintOptions, deps: { themeCheck?: ThemeCheckFn } = {}): Promise<Validation> {
  const problems = lintLanding(files, opts);
  if (problems.length > 0) return { ok: false, problems, notes: [] };

  const key = deps.themeCheck ? null : JSON.stringify([files, [...opts.handles].sort(), [...(opts.allowedNumbers ?? [])].sort()]);
  const hit = key ? passed.get(key) : undefined;
  if (hit && Date.now() - hit.at < KEEP_MS) return hit.value;

  const checked = await (deps.themeCheck ?? runThemeCheck)(files);
  if (checked.errors.length > 0) return { ok: false, problems: checked.errors.map((e) => `Theme Check: ${e}`), notes: [] };
  const value: Validation = {
    ok: true,
    problems: [],
    notes: [
      "Theme Check passed",
      ...checked.warnings.map((w) => `Theme Check warning: ${w}`),
      "Every product handle exists in the synced catalogue",
      "No price is typed: prices and stock are read from the store when the page loads",
      "The page is created hidden; a person publishes it in the Shopify admin",
    ],
  };
  if (key) {
    if (passed.size >= 20) passed.clear();
    passed.set(key, { at: Date.now(), value });
  }
  return value;
}
