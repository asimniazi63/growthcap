// Turns the saved write-up of a Creative briefs run into cards (T23 UI). The write-up is model text: an intro of up to three
// paragraphs (Campaign, Last year, Not pushing), then three briefs, each a bold title and a line per item (Who, Product, Angle,
// Hook lines, Offer, Proof, Do not, Measure). Real answers vary a little, so the parser reads line by line and forgives the common
// variants: "Brief 1: " before a title, items in their own paragraphs, bullets, a colon outside the bold, hooks without quotes.
// It never invents or drops a word: a line it cannot place goes to `other` (an item line with a name it does not know) or `rest`
// (anything else), and a write-up that does not look like briefs at all returns null so the page shows it as plain text.
import type { CreativeBrief, CreativeBriefsParsed } from "./creative-briefs-types";
import { paragraphs } from "./format";

type Field = "who" | "product" | "angle" | "hooks" | "offer" | "proof" | "doNot" | "measure";
type Intro = "campaign" | "lastYear" | "notPushing";

// Maps, not plain objects: a lead-in called "constructor" must not find a key on the prototype.
const INTROS = new Map<string, Intro>([
  ["campaign", "campaign"],
  ["last year", "lastYear"],
  ["not pushing", "notPushing"],
]);
const ITEMS = new Map<string, Field>([
  ["who", "who"],
  ["product", "product"],
  ["angle", "angle"],
  ["offer", "offer"],
  ["proof", "proof"],
  ["do not", "doNot"],
  ["don't", "doNot"],
  ["measure", "measure"],
]);
const HOOKS_NAME = /^hook(?:\s?lines?|s)?(?:\s\d+)?$/; // hook, hooks, hook line, hook lines, "hook line 2"

const MAX_HOOKS = 6;
const MIN_BRIEFS = 2; // fewer than this and the page shows plain text
const MIN_ITEMS = 3; // a brief with fewer recognised items does not count as one
const RULE = /^([-*_])(?:\s*\1){2,}$/; // same rule as paragraphs() uses, for a rule that sits inside a paragraph
const LIST_MARK = /^(?:[-*•–]\s+|\d+[.)]\s+)/; // a bullet or "1." in front of a line
const LEAD_BOLD = /^\*\*\s*([^*]{1,40}?)\s*\*\*\s*(.*)$/; // **Who:** text, **Who**: text, **Who** - text, **Best customers first**
const LEAD_PLAIN = /^([A-Za-z][A-Za-z0-9'’ ]{1,30}?)\s*:\s*(.*)$/; // Who: text (read only when the name is a known one)
const BRIEF_N = /^brief\s+#?\d+\s*(?:[:.–—-]\s*(.*))?$/i; // "Brief 1", "Brief 1: Title", "Brief 1 - Title"

const norm = (label: string): string =>
  label
    .toLowerCase()
    .replace(/\([^)]*\)/g, "")
    .replace(/[‘’`]/g, "'")
    .replace(/\s+/g, " ")
    .replace(/[\s:.]+$/, "")
    .trim();
const introKey = (label: string): Intro | null => INTROS.get(norm(label)) ?? null;
// A real answer opened its Last year paragraph with "**Last year's Black Friday weekend** customers who...": the bold words are the start
// of the sentence, not a name. With text after them, a lead-in that begins with an intro's name opens that intro, and its words stay in
// the text. A bold line alone is still a title ("**Last year's winners**").
const INTRO_STARTS: [RegExp, Intro][] = [
  [/^campaign\b/, "campaign"],
  [/^last year\b/, "lastYear"],
  [/^not pushing\b/, "notPushing"],
];
const introStartKey = (label: string): Intro | null => INTRO_STARTS.find(([re]) => re.test(norm(label)))?.[1] ?? null;
const itemKey = (label: string): Field | null => {
  const n = norm(label);
  return HOOKS_NAME.test(n) ? "hooks" : (ITEMS.get(n) ?? null);
};

type Line =
  | { kind: "title"; title: string; bare: boolean } // bare: only "Brief 2", the real title may be on the next line
  | { kind: "intro"; key: Intro; text: string }
  | { kind: "item"; key: Field; text: string }
  | { kind: "other"; label: string; text: string }
  | { kind: "text" };

// A bold lead-in at the start of a line: its name (the colon or full stop that ends it taken off, wherever it was written),
// the text after it, and the separator that was found ("" when the bold stands alone, as a title does).
function boldLead(s: string): { label: string; text: string; sep: string } | null {
  const m = LEAD_BOLD.exec(s);
  if (!m) return null;
  let label = m[1]!.trim();
  let text = m[2]!;
  let sep = "";
  const inner = /[:.]$/.exec(label);
  if (inner) {
    sep = inner[0];
    label = label.slice(0, -1).trim();
  } else {
    const after = /^(?:([:.])|([–—-])(?=\s|$))\s*/.exec(text);
    if (after) {
      sep = after[1] ?? "-";
      text = text.slice(after[0].length);
    }
  }
  return { label, text: text.trim(), sep };
}

function classify(line: string): Line {
  const noMark = line.replace(LIST_MARK, "");
  const bare = noMark.replace(/^#{1,6}\s+/, "");
  const heading = bare !== noMark;
  const plain = bare.replace(/\*\*/g, "").trim();

  const n = BRIEF_N.exec(plain);
  if (n) {
    const title = (n[1] ?? "").trim();
    return title ? { kind: "title", title, bare: false } : { kind: "title", title: plain.replace(/\s*[:.–—-]+$/, ""), bare: true };
  }

  const b = boldLead(bare);
  if (b) {
    const intro = introKey(b.label);
    if (intro) return { kind: "intro", key: intro, text: b.text };
    const field = itemKey(b.label);
    if (field) return { kind: "item", key: field, text: b.text };
    const started = b.text === "" ? null : introStartKey(b.label);
    if (started) return { kind: "intro", key: started, text: `${b.label} ${b.text}` };
    // An unknown name with nothing after it and no colon is a title ("**Best customers first**", or with a full stop); with a colon
    // or a dash it opens a line of an item the parser does not know (parse() turns one with no text, directly above an item line,
    // into a title); with only a full stop and some text it opens one too. A bold phrase that merely starts a sentence is none of
    // these and stays text.
    if (b.text === "" && b.sep !== ":" && b.sep !== "-") return { kind: "title", title: b.label, bare: false };
    if (b.sep === ":" || b.sep === "-" || (b.sep === "." && b.text !== "")) return { kind: "other", label: b.label, text: b.text };
  } else {
    // A bold-only line too long to be a lead-in name is still a title.
    const bold = /^\*\*([^*]+)\*\*$/.exec(bare);
    if (bold) return { kind: "title", title: bold[1]!.trim(), bare: false };
  }

  const p = LEAD_PLAIN.exec(bare);
  if (p) {
    const intro = introKey(p[1]!);
    if (intro) return { kind: "intro", key: intro, text: p[2]!.trim() };
    const field = itemKey(p[1]!);
    if (field) return { kind: "item", key: field, text: p[2]!.trim() };
  }

  if (heading && plain) return { kind: "title", title: plain, bare: false };
  return { kind: "text" };
}

interface Draft {
  title: string;
  bare: boolean;
  fields: Map<Field, string[]>; // the lines written for each item, in order
  others: { label: string; lines: string[] }[];
}

const clean = (s: string): string => s.replace(/\*\*/g, "").trim();
const joinLines = (lines: string[]): string =>
  lines
    .map(clean)
    .filter((l) => l !== "")
    .join(" ");
const orNull = (s: string): string | null => (s === "" ? null : s);

// One pair of double quotes around the whole value, straight or curly. A value with quotes inside it ("a" and "b") is left as it is.
function unquote(s: string): string {
  const m = /^["“”]([^"“”]*)["“”]$/.exec(s);
  return m ? m[1]!.trim() : s;
}

// Every quoted span is a hook. With none, the line is split on " / ", " | ", ";" or one hook per line, with bullets and quotes removed.
function hooksOf(lines: string[]): string[] {
  const text = lines.map(clean).filter((l) => l !== "");
  const quoted = [...text.join("\n").matchAll(/["“]([^"“”]+?)["”]/g)].map((m) => m[1]!.trim()).filter((h) => h !== "");
  const list =
    quoted.length > 0
      ? quoted
      : text
          .flatMap((l) => l.replace(LIST_MARK, "").split(/\s\/\s|\s\|\s|;/))
          // A hook in single quotes loses them only when the pair wraps the whole hook, so "Your routine's waiting" keeps its apostrophe.
          .map((h) => h.replace(/["“”]/g, "").replace(/^['‘](.*)['’]$/, "$1").trim())
          .filter((h) => h !== "");
  return list.slice(0, MAX_HOOKS);
}

function finish(d: Draft, index: number): CreativeBrief {
  const one = (key: Field): string | null => {
    const lines = d.fields.get(key);
    return lines ? orNull(joinLines(lines)) : null;
  };
  const angle = one("angle");
  return {
    title: clean(d.title) || `Brief ${index + 1}`,
    who: one("who"),
    product: one("product"),
    angle: angle === null ? null : unquote(angle),
    hooks: hooksOf(d.fields.get("hooks") ?? []),
    offer: one("offer"),
    proof: one("proof"),
    doNot: one("doNot"),
    measure: one("measure"),
    other: d.others.map((o) => ({ label: clean(o.label), text: joinLines(o.lines) })),
  };
}

function parse(body: string): CreativeBriefsParsed | null {
  const intros: Record<Intro, string[]> = { campaign: [], lastYear: [], notPushing: [] };
  const drafts: Draft[] = [];
  const rest: string[] = [];
  let brief: Draft | null = null; // the brief that item lines belong to: the latest title, kept across paragraphs
  let cont: string[] | null = null; // where a line with no lead-in goes: the lines of the item or intro just written

  const open = (title: string, bare: boolean): Draft => {
    const d: Draft = { title, bare, fields: new Map(), others: [] };
    drafts.push(d);
    return d;
  };

  // Every line of the write-up in order, with its paragraph and what it is, worked out first so a line can look at the line below it:
  // a title that ends in a colon is told from an item that has no text only by what comes next.
  const entries: { paragraph: number; line: string; found: Line }[] = [];
  paragraphs(body).forEach((paragraph, index) => {
    for (const raw of paragraph.split(/\r?\n/)) {
      const line = raw.trim();
      if (line !== "" && !RULE.test(line)) entries.push({ paragraph: index, line, found: classify(line) });
    }
  });

  let strays: string[] = []; // lines of this paragraph that are nothing above: they go to `rest`, with their ** markers
  let current = -1; // the paragraph being read
  for (const [i, { paragraph, line, found }] of entries.entries()) {
    if (paragraph !== current) {
      if (strays.length > 0) rest.push(strays.join("\n"));
      strays = [];
      current = paragraph;
      // A new paragraph ends the item before it, unless that item has no text yet (a lead-in alone on its line, its text below).
      if (cont && cont.length > 0) cont = null;
    }
    // A bold name with a colon and nothing after it, directly above an item line (in the next paragraph too), is a title
    // ("**Best customers first:**" over "**Who:** ..."), not an item that has no text. With prose below it, it stays an item line of
    // the brief above ("**Note:**"). The known names (Campaign, Last year, Not pushing, Who ...) were told apart before this.
    const c: Line =
      found.kind === "other" && found.text === "" && entries[i + 1]?.found.kind === "item" ? { kind: "title", title: found.label, bare: false } : found;
    if (c.kind === "title") {
      // "**Brief 2**" on a line of its own, then the title on the next, is one brief.
      if (brief && brief.bare && !c.bare && brief.fields.size === 0 && brief.others.length === 0) {
        brief.title = c.title;
        brief.bare = false;
      } else {
        brief = open(c.title, c.bare);
      }
      cont = null;
    } else if (c.kind === "intro") {
      const target = intros[c.key];
      if (c.text) target.push(c.text);
      cont = target;
    } else if (c.kind === "item") {
      brief ??= open(`Brief ${drafts.length + 1}`, false);
      let target = brief.fields.get(c.key);
      if (!target) {
        target = [];
        brief.fields.set(c.key, target);
      }
      if (c.text) target.push(c.text);
      cont = target;
    } else if (c.kind === "other" && brief) {
      const target = c.text ? [c.text] : [];
      brief.others.push({ label: c.label, lines: target });
      cont = target;
    } else if (c.kind === "text" && cont) {
      cont.push(line);
    } else {
      strays.push(line);
    }
  }
  if (strays.length > 0) rest.push(strays.join("\n"));

  if (drafts.length < MIN_BRIEFS || drafts.filter((d) => d.fields.size >= MIN_ITEMS).length < MIN_BRIEFS) return null;
  return {
    campaign: orNull(joinLines(intros.campaign)),
    lastYear: orNull(joinLines(intros.lastYear)),
    notPushing: orNull(joinLines(intros.notPushing)),
    briefs: drafts.map(finish),
    rest,
  };
}

// The write-up as cards, or null when it does not look like briefs (the page then shows it as text). Never throws.
export function parseCreativeBriefs(body: string): CreativeBriefsParsed | null {
  try {
    return typeof body === "string" ? parse(body) : null;
  } catch {
    return null;
  }
}
