import { daysBetween } from "../metrics/dates";
import { METRICS, type MetricId } from "../metrics/registry";
import type { ToolResult } from "../tools/result";
import { documentFigureEntries } from "../plan-in/figures";

// The number checker. Every figure in an answer must equal a value from that turn's tool results, with the same unit
// (money, count or percent) and after rounding to the precision shown. Nothing is derived: a sum or ratio the model
// worked out is unmatched, which is the point. Dates, years, codes, ids, ordinals and the tools' own inputs are skipped.

export type ClaimUnit = "money" | "count" | "rate";

export interface ClaimEntry {
  value: number; // money in dollars, a rate as a percentage (18.4 means 18.4%), a count as is
  unit: ClaimUnit;
  queryId: string;
  path: string;
}

export interface ClaimLedger {
  entries: ClaimEntry[];
  names?: string[]; // product and variant titles with a digit in them ("SPF 50"): part of a name, not a claim
  rangeDays?: number[]; // how many days each result covers, so "the last 30 days" is not a claim when no input said 30
}

const METRIC_MAPS = new Set(["values", "previous", "change"]);
const RATE_MAPS = new Set(["pctChange", "share"]);
const RATE_KEYS = new Set(["marginRate", "repeatRate", "repeatShare", "contributionMarginRate", "pctOfExpected", "ordersPctOfExpected", "repeatRateGap"]);

function classify(key: string, parentKey: string | undefined, raw: number): { value: number; unit: ClaimUnit } {
  if (parentKey && METRIC_MAPS.has(parentKey)) {
    const metric = METRICS[key as MetricId];
    if (metric?.unit === "money") return { value: raw / 100, unit: "money" };
    if (metric?.unit === "rate") return { value: raw * 100, unit: "rate" };
    return { value: raw, unit: "count" };
  }
  if ((parentKey && RATE_MAPS.has(parentKey)) || RATE_KEYS.has(key)) return { value: raw * 100, unit: "rate" };
  if (/Cents$/.test(key)) return { value: raw / 100, unit: "money" };
  return { value: raw, unit: "count" };
}

// A plan gap is keyed by metric, and every figure in it is in that metric's unit, except pctGap, which is a fraction.
function walkPlanGaps(node: unknown, path: string, queryId: string, out: ClaimEntry[]): void {
  if (!node || typeof node !== "object") return;
  for (const [metric, gap] of Object.entries(node)) {
    const def = METRICS[metric as MetricId];
    if (!def || !gap || typeof gap !== "object") continue;
    for (const [field, raw] of Object.entries(gap)) {
      if (typeof raw !== "number" || !Number.isFinite(raw)) continue;
      const unit: ClaimUnit = field === "pctGap" ? "rate" : field === "daysLeft" ? "count" : def.unit === "money" ? "money" : def.unit === "rate" ? "rate" : "count";
      const value = unit === "money" ? raw / 100 : unit === "rate" ? raw * 100 : raw;
      out.push({ value, unit, queryId, path: `${path}.${metric}.${field}` });
    }
  }
}

function walk(node: unknown, path: string, key: string, parentKey: string | undefined, queryId: string, out: ClaimEntry[]): void {
  if (typeof node === "number" && Number.isFinite(node)) {
    out.push({ ...classify(key, parentKey, node), queryId, path });
  } else if (Array.isArray(node)) {
    node.forEach((item, i) => walk(item, `${path}[${i}]`, key, parentKey, queryId, out));
  } else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      if (k === "untrusted") continue; // store text: never a source of numbers
      if (k === "gapToPlan") {
        walkPlanGaps(v, `${path}.${k}`, queryId, out);
        continue;
      }
      walk(v, `${path}.${k}`, k, key, queryId, out);
    }
  }
  // Strings (ids, dates, text) and null carry no claimable numbers.
}

// Only titles are taken, never other store text such as a note, so an injected sentence can't excuse its own numbers.
const NAME_KEYS = new Set(["title", "product", "variant"]);

function collectNames(node: unknown, key: string, parentKey: string | undefined, underUntrusted: boolean, out: Set<string>): void {
  if (typeof node === "string") {
    if (underUntrusted && (NAME_KEYS.has(key) || parentKey === "variantTitles") && /\d/.test(node) && node.length <= 80) out.add(node);
  } else if (Array.isArray(node)) {
    node.forEach((item) => collectNames(item, key, parentKey, underUntrusted, out));
  } else if (node && typeof node === "object") {
    // A calendar event or a call note is text people wrote, not a name: a figure in its title ("budget reduced by 40%") is not
    // a result, so its title is never a name that excuses a number. Only product and variant titles are.
    const written = "dateFrom" in node || "heldOn" in node;
    for (const [k, v] of Object.entries(node)) collectNames(v, k, key, underUntrusted || (k === "untrusted" && !written), out);
  }
}

export function ledgerFromToolResults(results: ToolResult<unknown>[]): ClaimLedger {
  const entries: ClaimEntry[] = [];
  const names = new Set<string>();
  const rangeDays = new Set<number>();
  results.forEach((r) => {
    if (r.range?.from && r.range?.to) rangeDays.add(daysBetween(r.range.from, r.range.to) + 1);
    walk(r.data, "data", "data", undefined, r.queryId, entries);
    if (r.truncated) walk(r.truncated, "truncated", "truncated", undefined, r.queryId, entries);
    collectNames(r.data, "data", undefined, false, names);
    entries.push(...documentFigureEntries(r)); // page text returned by ask_document: what the document states, with its page
  });
  return { entries, names: [...names], rangeDays: [...rangeDays] };
}

// ---- Reading the answer

const MONTH = "(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)";
const DAY = "(?:0?[1-9]|[12]\\d|3[01])(?:st|nd|rd|th)?"; // 1 to 31
const SKIP_PATTERNS: RegExp[] = [
  /\b(?:https?|gid):\/\/\S+/g, // links and Shopify ids
  /\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?/g, // ISO timestamps
  /\b\d{4}-\d{2}(?:-\d{2})?\b/g, // 2026-05-01 and 2026-05
  /\b\d{1,2}:\d{2}(?::\d{2})?(?:\s?[ap]\.?m\.?)?/gi, // times
  /#\d+/g, // order numbers
  /\bCUST_[0-9a-f]+/g,
  /\b[A-Za-z][A-Za-z_-]*\d+[A-Za-z0-9_-]*\b/g, // codes and SKUs: WELCOME10, SOL-01A, P_007, Q3
  // Day ranges come first so the end day is masked too. A dash takes no spaces, so "October 31 - 83 orders" still checks 83,
  // and the end must be a real day, so "October 31 to 83 orders" does too.
  new RegExp(`\\b${MONTH}[a-z]*\\.?\\s+${DAY}(?:[–—-]|\\s+(?:to|through|thru)\\s+)(?:${MONTH}[a-z]*\\.?\\s+)?${DAY}(?!\\d)\\b`, "g"), // September 1–30, Sep 1 to 30, Sep 28–Oct 3
  new RegExp(`\\b${DAY}[–—-]${DAY}\\s+${MONTH}[a-z]*\\b`, "g"), // 1–30 September
  new RegExp(`\\b${MONTH}[a-z]*\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?\\b`, "g"), // May 14th
  new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+${MONTH}[a-z]*\\b`, "g"), // 14 May
  /^[ \t]*\d+[.)](?=\s)/gm, // list numbering
];

function mask(text: string, names: string[] = []): string {
  let out = text;
  for (const name of names) out = out.split(name).join(" ".repeat(name.length));
  for (const re of SKIP_PATTERNS) out = out.replace(re, (m) => " ".repeat(m.length));
  return out;
}

// Numbers the tools were asked with ("last 30 days", "top 5"): numeric inputs, and the number inside names such as
// last_30_days. Digits inside dates and ids don't count, or "5 orders" would be waved through by a date in May.
function numbersInInputs(inputs: unknown[]): Set<number> {
  const found = new Set<number>();
  const visit = (node: unknown) => {
    if (typeof node === "number") found.add(node);
    else if (typeof node === "string") for (const m of node.matchAll(/_(\d+)_/g)) found.add(Number(m[1]));
    else if (Array.isArray(node)) node.forEach(visit);
    else if (node && typeof node === "object") Object.values(node).forEach(visit);
  };
  inputs.forEach(visit);
  return found;
}

const TOKEN = /(?<![\w.])(\$)?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?(?:\s?(%|[kKmM](?![A-Za-z])|(?:st|nd|rd|th)(?![A-Za-z])))?/g;

export interface ClaimCheck {
  ok: boolean;
  matched: { span: [number, number]; value: number; queryId: string }[];
  unmatched: { text: string; value: number }[];
}

export function checkClaims(answer: string, ledger: ClaimLedger, toolInputs: unknown[]): ClaimCheck {
  const skip = numbersInInputs(toolInputs);
  const rangeDays = new Set(ledger.rangeDays ?? []);
  const masked = mask(answer, ledger.names);
  const result: ClaimCheck = { ok: true, matched: [], unmatched: [] };

  for (const m of masked.matchAll(TOKEN)) {
    const [text, dollar, whole, frac, suffix] = m;
    if (suffix && /^(st|nd|rd|th)$/.test(suffix)) continue; // an ordinal
    const digits = Number(whole!.replace(/,/g, ""));
    const plain = !dollar && !suffix && !whole!.includes(",") && frac === undefined;
    if (plain && digits >= 1900 && digits <= 2100) continue; // a year
    const multiplier = suffix === "k" || suffix === "K" ? 1e3 : suffix === "m" || suffix === "M" ? 1e6 : 1;
    const decimals = frac?.length ?? 0;
    const value = Number(`${whole!.replace(/,/g, "")}${frac !== undefined ? `.${frac}` : ""}`) * multiplier;
    const unit: ClaimUnit = dollar ? "money" : suffix === "%" ? "rate" : "count";
    if (unit === "count" && skip.has(value)) continue; // asked for by the tool input
    if (unit === "count" && rangeDays.has(value) && /^[\s-]?days?\b/i.test(masked.slice(m.index! + text.length))) continue; // "30 days", when a result covers 30

    const start = m.index!;
    const span: [number, number] = [start, start + text.length];
    const tolerance = 0.5 * 10 ** -decimals * multiplier + 1e-9;
    const hit = ledger.entries
      .filter((e) => e.unit === unit && Math.abs(Math.abs(e.value) - value) <= tolerance)
      .sort((a, b) => Math.abs(Math.abs(a.value) - value) - Math.abs(Math.abs(b.value) - value))[0];
    if (hit) result.matched.push({ span, value, queryId: hit.queryId });
    else result.unmatched.push({ text: answer.slice(...span).trim(), value });
  }
  result.ok = result.unmatched.length === 0;
  return result;
}
