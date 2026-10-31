// Loads a store's calendar.csv and call-notes/*.md into its tenant (T7). Each file set is checked in full before anything is
// written, and each load replaces the tenant's rows, so running it again leaves the same rows.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import type { Db } from "../../lib/db/client";
import { calendarEvents, callNotes } from "../../lib/db/schema";

export interface CalendarRow {
  dateFrom: string;
  dateTo: string;
  title: string;
  type: string;
  channel: string;
  details: string;
}
export interface CallNoteRow {
  heldOn: string;
  title: string;
  body: string;
}
export interface NoteFile {
  name: string;
  text: string;
}

const HEADER = ["date_from", "date_to", "event", "type", "channel", "notes"];

// One CSV line into cells, with "quoted, cells" and "" for a quote. Calendar notes are free text, so a comma may appear.
function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      cells.push(cell.trim());
      cell = "";
    } else cell += c;
  }
  cells.push(cell.trim());
  return cells;
}

function realDay(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

export function parseCalendar(text: string): CalendarRow[] {
  const rows: CalendarRow[] = [];
  let sawHeader = false;
  text.split("\n").forEach((raw, i) => {
    const line = raw.replace(/\r$/, "");
    if (line.trim() === "" || line.startsWith("#")) return;
    const cells = splitCsvLine(line);
    if (!sawHeader) {
      if (cells.join(",") !== HEADER.join(",")) throw new Error(`Expected the header "${HEADER.join(",")}" but found "${line}" on line ${i + 1}.`);
      sawHeader = true;
      return;
    }
    if (cells.length !== HEADER.length) throw new Error(`Line ${i + 1}: expected ${HEADER.length} columns but found ${cells.length}.`);
    const [dateFrom, dateTo, title, type, channel, details] = cells as [string, string, string, string, string, string];
    if (!realDay(dateFrom)) throw new Error(`Line ${i + 1}: "${dateFrom}" is not a date (YYYY-MM-DD).`);
    if (!realDay(dateTo)) throw new Error(`Line ${i + 1}: "${dateTo}" is not a date (YYYY-MM-DD).`);
    if (dateTo < dateFrom) throw new Error(`Line ${i + 1}: the event ends (${dateTo}) before it starts (${dateFrom}).`);
    if (!title || !type || !channel) throw new Error(`Line ${i + 1}: the event, type and channel can't be empty.`);
    rows.push({ dateFrom, dateTo, title, type, channel, details });
  });
  if (!sawHeader) throw new Error(`The file is empty: expected the header "${HEADER.join(",")}".`);
  return rows;
}

// The date is the start of the file name (2026-10-01-q4-budget.md); the title is the first "# " heading; the body is what
// follows the heading. The fixtures' FICTIONAL SAMPLE line is a disclaimer, not part of the note.
export function parseCallNote(file: NoteFile): CallNoteRow {
  const date = /^(\d{4}-\d{2}-\d{2})-/.exec(file.name)?.[1];
  if (!date || !realDay(date)) throw new Error(`${file.name}: the file name must start with the call's date (YYYY-MM-DD-...).`);
  const lines = file.text.replace(/\r/g, "").split("\n");
  const at = lines.findIndex((l) => /^#\s+\S/.test(l));
  if (at < 0) throw new Error(`${file.name}: no "# title" heading.`);
  const body = lines
    .slice(at + 1)
    .join("\n")
    .trim();
  if (!body) throw new Error(`${file.name}: the note has no text after its title.`);
  return { heldOn: date, title: lines[at]!.replace(/^#\s+/, "").trim(), body };
}

export function parseCallNotes(files: NoteFile[]): CallNoteRow[] {
  return files.map(parseCallNote);
}

const fixturePath = (store: string, name: string) => fileURLToPath(new URL(`../../fixtures/${store}/${name}`, import.meta.url));

// A store with no call-notes folder has no notes (Tidepool has a calendar only).
export function readCallNoteFiles(store: string): NoteFile[] {
  const dir = fixturePath(store, "call-notes");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => n.endsWith(".md"))
    .sort()
    .map((name) => ({ name, text: readFileSync(`${dir}/${name}`, "utf8") }));
}

export async function loadCalendar(db: Db, tenantId: string, csv: string): Promise<{ events: number }> {
  const parsed = parseCalendar(csv);
  await db.transaction(async (tx) => {
    await tx.delete(calendarEvents).where(eq(calendarEvents.tenantId, tenantId));
    if (parsed.length > 0) await tx.insert(calendarEvents).values(parsed.map((r) => ({ tenantId, ...r })));
  });
  return { events: parsed.length };
}

export async function loadCallNotes(db: Db, tenantId: string, files: NoteFile[]): Promise<{ notes: number }> {
  const parsed = parseCallNotes(files);
  await db.transaction(async (tx) => {
    await tx.delete(callNotes).where(eq(callNotes.tenantId, tenantId));
    if (parsed.length > 0) await tx.insert(callNotes).values(parsed.map((r) => ({ tenantId, ...r })));
  });
  return { notes: parsed.length };
}
