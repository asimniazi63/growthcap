import { formatRange } from "../pace/format";

// "October 31, 2026"
export const longDate = (ymd: string) => formatRange(ymd, ymd);

// "11:31 AM UTC", or "October 30, 11:31 AM UTC" when the last sync was not on the store's today. Null when nothing has synced.
export function formatAsOf(iso: string, today: string): string | null {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime()) || at.getTime() === 0) return null;
  const time = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" }).format(at);
  if (at.toISOString().slice(0, 10) === today) return `${time} UTC`;
  const day = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", timeZone: "UTC" }).format(at);
  return `${day}, ${time} UTC`;
}

// "Oct 31", in the store's own time zone.
export function shortDay(iso: string, timeZone: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  try {
    return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone }).format(at);
  } catch {
    return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(at);
  }
}

// The first ~max characters of a brief as plain text: headings, list marks, bold, links and code marks stripped, cut at a word.
export function plainSnippet(markdown: string, max = 220): string {
  const lines = markdown
    .replace(/```[\s\S]*?```/g, " ")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const body = lines.filter((l) => !/^#{1,6}\s/.test(l));
  const source = body.length > 0 ? body : lines;
  const text = source
    .map((l) =>
      l
        .replace(/^#{1,6}\s+/, "")
        .replace(/^>\s?/, "")
        .replace(/^([-*+]|\d+[.)])\s+/, "")
        .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/[*_`~|]/g, ""),
    )
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:–-]+$/, "")}…`;
}
