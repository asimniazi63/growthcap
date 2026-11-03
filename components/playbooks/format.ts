// Small pure helpers for the Playbooks page, kept apart from the components so they can be tested without a renderer.

export interface MonthOption {
  value: string; // YYYY-MM, or "" for "no month": the server then reviews the last finished month
  label: string;
}

const LABEL = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
const ym = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

// "2026-10" -> "October 2026". Anything that isn't YYYY-MM comes back as it was.
export function monthLabel(month: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  return m ? LABEL.format(new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1))) : month;
}

// The months the monthly review offers: "Last month" first (no month param, so the server picks it in the store's time zone),
// then the n - 1 months before it. Worked out in UTC from `now`.
export function monthOptions(now: Date, n = 6): MonthOption[] {
  const options: MonthOption[] = [{ value: "", label: "Last month" }];
  for (let back = 2; back <= n; back++) {
    const value = ym(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1)));
    options.push({ value, label: monthLabel(value) });
  }
  return options;
}

// Three or more of the same dash, asterisk or underscore, with spaces allowed between: a horizontal rule. The shared rules forbid them in
// a write-up, but a model sometimes puts one between its sections, and as plain text it would show as a line of dashes.
const HORIZONTAL_RULE = /^([-*_])(?:\s*\1){2,}$/;

// A write-up is model text, shown as plain text only: split into paragraphs on blank lines, single line breaks kept by CSS. A paragraph
// that is only a horizontal rule is left out; one that merely contains dashes ("a - b", "-- note") stays.
export const paragraphs = (body: string): string[] =>
  body
    .split(/\r?\n\s*\r?\n/)
    .map((p) => p.trim())
    .filter((p) => p !== "" && !HORIZONTAL_RULE.test(p));

export interface Segment {
  text: string;
  bold: boolean;
}

// The write-up's one bit of markup: a lead-in between double asterisks. Anything else stays text, so the model can't add
// links, images or HTML. An unpaired "**" is shown as it is.
export function segments(paragraph: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const m of paragraph.matchAll(/\*\*([^*]+?)\*\*/g)) {
    if (m.index > last) out.push({ text: paragraph.slice(last, m.index), bold: false });
    out.push({ text: m[1]!, bold: true });
    last = m.index + m[0].length;
  }
  if (last < paragraph.length) out.push({ text: paragraph.slice(last), bold: false });
  return out;
}
