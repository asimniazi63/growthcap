import { beforeEach, describe, expect, it } from "vitest";
import { count, eq } from "drizzle-orm";
import type { Db } from "../../lib/db/client";
import { calendarEvents, callNotes, tenants } from "../../lib/db/schema";
import { createTestDb } from "../../lib/db/test-db";
import { loadCalendar, loadCallNotes, parseCalendar, parseCallNote, parseCallNotes, readCallNoteFiles } from "./load-why";
import { readFixtureFile } from "./load-pace";

const HEADER = "date_from,date_to,event,type,channel,notes";

describe("parseCalendar", () => {
  it("skips the FICTIONAL SAMPLE line, keeps quoted commas, and reads the columns", () => {
    const rows = parseCalendar(`# FICTIONAL SAMPLE\n${HEADER}\n2026-10-05,2026-12-31,"Meta cut, 40%",budget_change,meta,"Agreed on the call, to protect cash"\n`);
    expect(rows).toEqual([
      { dateFrom: "2026-10-05", dateTo: "2026-12-31", title: "Meta cut, 40%", type: "budget_change", channel: "meta", details: "Agreed on the call, to protect cash" },
    ]);
  });

  it.each([
    ["a date that is not a day", "2026-02-30,2026-03-01,x,promo,all,"],
    ["an event that ends before it starts", "2026-03-02,2026-03-01,x,promo,all,"],
    ["a missing column", "2026-03-01,2026-03-02,x,promo"],
    ["an empty event name", "2026-03-01,2026-03-02,,promo,all,"],
  ])("rejects %s, naming the line", (_what, row) => {
    expect(() => parseCalendar(`${HEADER}\n${row}\n`)).toThrow(/Line 2/);
  });

  it("rejects a file with the wrong header", () => {
    expect(() => parseCalendar("from,to,what\n2026-03-01,2026-03-02,x\n")).toThrow(/header/);
  });
});

describe("parseCallNote", () => {
  it("takes the date from the file name, the title from the first heading and the body from what follows", () => {
    const note = parseCallNote({ name: "2026-10-01-q4-budget.md", text: "FICTIONAL SAMPLE: not real.\n\n# Q4 budget call\n\n**Date:** 2026-10-01\n\n## Summary\nCut the budget.\n" });
    expect(note.heldOn).toBe("2026-10-01");
    expect(note.title).toBe("Q4 budget call");
    expect(note.body).toBe("**Date:** 2026-10-01\n\n## Summary\nCut the budget.");
  });

  it.each([
    ["a file name without a date", "q4-budget.md", "# T\nbody"],
    ["a date that is not a day", "2026-13-01-x.md", "# T\nbody"],
    ["no heading", "2026-10-01-x.md", "just text"],
    ["a heading and nothing else", "2026-10-01-x.md", "# T\n"],
  ])("rejects %s", (_what, name, text) => {
    expect(() => parseCallNote({ name, text })).toThrow(name);
  });
});

describe("loading the Solenne files", () => {
  let db: Db;
  let a: string;
  let b: string;
  beforeEach(async () => {
    db = await createTestDb();
    [{ id: a }, { id: b }] = (await db
      .insert(tenants)
      .values([
        { orgId: "org_a", name: "A" },
        { orgId: "org_b", name: "B" },
      ])
      .returning({ id: tenants.id })) as [{ id: string }, { id: string }];
  }, 60_000);

  // Counted straight from the files, not through the parsers under test.
  const eventLines = readFixtureFile("solenne", "calendar.csv").split("\n").filter((l) => /^\d{4}-\d{2}-\d{2},/.test(l)).length;

  it("loads every calendar row, with the planted Meta budget cut", async () => {
    expect((await loadCalendar(db, a, readFixtureFile("solenne", "calendar.csv"))).events).toBe(eventLines);
    const rows = await db.select().from(calendarEvents).where(eq(calendarEvents.tenantId, a));
    expect(rows).toHaveLength(eventLines);
    const cut = rows.find((r) => r.type === "budget_change");
    expect(cut).toMatchObject({ dateFrom: "2026-10-05", dateTo: "2026-12-31", channel: "meta" });
    expect(cut!.title).toMatch(/Meta prospecting budget reduced/);
  });

  it("loads the four call notes with their dates and titles, including the supplier delay", async () => {
    const files = readCallNoteFiles("solenne");
    expect(files).toHaveLength(4);
    expect((await loadCallNotes(db, a, files)).notes).toBe(4);
    const rows = await db.select().from(callNotes).where(eq(callNotes.tenantId, a));
    expect(rows.map((r) => r.heldOn).sort()).toEqual(["2025-09-04", "2025-12-09", "2026-08-27", "2026-10-01"]);
    const supply = rows.find((r) => r.heldOn === "2026-08-27");
    expect(supply!.title).toBe("Solenne x Growth Capital: supply check-in");
    expect(supply!.body).toMatch(/Vitamin C Serum/);
    expect(supply!.body).not.toMatch(/FICTIONAL SAMPLE/);
  });

  it("is safe to run again, and replaces rows that are no longer in the files", async () => {
    await loadCalendar(db, a, `${HEADER}\n2026-01-01,2026-01-02,Old event,promo,all,\n`);
    await loadCalendar(db, a, readFixtureFile("solenne", "calendar.csv"));
    await loadCalendar(db, a, readFixtureFile("solenne", "calendar.csv"));
    const files = readCallNoteFiles("solenne");
    await loadCallNotes(db, a, files);
    await loadCallNotes(db, a, files);
    const [events] = await db.select({ n: count() }).from(calendarEvents).where(eq(calendarEvents.tenantId, a));
    const [notes] = await db.select({ n: count() }).from(callNotes).where(eq(callNotes.tenantId, a));
    expect(events!.n).toBe(eventLines);
    expect(notes!.n).toBe(4);
  });

  it("keeps each tenant's rows apart", async () => {
    await loadCalendar(db, a, readFixtureFile("solenne", "calendar.csv"));
    await loadCalendar(db, b, readFixtureFile("tidepool", "calendar.csv"));
    await loadCallNotes(db, a, readCallNoteFiles("solenne"));
    const [bEvents] = await db.select({ n: count() }).from(calendarEvents).where(eq(calendarEvents.tenantId, b));
    const [bNotes] = await db.select({ n: count() }).from(callNotes).where(eq(callNotes.tenantId, b));
    expect(bEvents!.n).toBeGreaterThan(0);
    expect(bEvents!.n).not.toBe(eventLines);
    expect(bNotes!.n).toBe(0);
  });

  it("stores nothing when one row is bad", async () => {
    await expect(loadCalendar(db, a, `${HEADER}\n2026-01-01,2026-01-02,Ok,promo,all,\n2026-01-03,2026-01-02,Bad,promo,all,\n`)).rejects.toThrow(/Line 3/);
    expect(parseCallNotes([])).toEqual([]);
    const [row] = await db.select({ n: count() }).from(calendarEvents).where(eq(calendarEvents.tenantId, a));
    expect(row!.n).toBe(0);
  });

  it("gives Tidepool, which has no call-notes folder, no notes", () => {
    expect(readCallNoteFiles("tidepool")).toEqual([]);
  });
});
