import { and, eq, isNotNull, isNull, min, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setTestNow } from "../clock";
import type { Db } from "../db/client";
import { calendarEvents, callNotes, orders, tenants } from "../db/schema";
import { createTestDb } from "../db/test-db";
import { loadCalendar, loadCallNotes, readCallNoteFiles } from "../../scripts/fixtures/load-why";
import { readFixtureFile } from "../../scripts/fixtures/load-pace";
import { seedTwoStores } from "../../scripts/fixtures/load-db";
import type { TenantContext } from "../tenancy/context";
import { ANNOTATION_CAP, capAnnotations, shorten, type PaceAnnotation } from "./annotation-types";
import { loadPaceAnnotations, noteExcerpt } from "./annotations";

let db: Db;
let sCtx: TenantContext;
let tCtx: TenantContext;

beforeAll(async () => {
  setTestNow("2026-11-02T12:00:00-05:00");
  db = await createTestDb();
  const seeded = await seedTwoStores(db);
  sCtx = seeded.ctxs.solenne;
  tCtx = seeded.ctxs.tidepool;
  await loadCalendar(db, sCtx.tenantId, readFixtureFile("solenne", "calendar.csv"));
  await loadCallNotes(db, sCtx.tenantId, readCallNoteFiles("solenne"));
  await loadCalendar(db, tCtx.tenantId, readFixtureFile("tidepool", "calendar.csv"));
}, 240_000);

afterAll(() => setTestNow(null));

const a = (over: Partial<PaceAnnotation>): PaceAnnotation => ({ date: "2026-10-10", kind: "calendar", label: "x", ...over });

describe("capAnnotations", () => {
  it("keeps everything when there is room, in date order and calendar before note before code before stockout on a shared day", () => {
    const out = capAnnotations([a({ kind: "stockout", label: "s" }), a({ kind: "code", label: "c" }), a({ kind: "note", label: "n" }), a({ kind: "calendar", label: "e", date: "2026-10-09" })]);
    expect(out.map((x) => x.label)).toEqual(["e", "n", "c", "s"]);
  });

  it("prefers calendar entries and notes, then codes, then stockouts, and caps codes at 5 and stockouts at 3", () => {
    const many: PaceAnnotation[] = [
      ...Array.from({ length: 4 }, (_, i) => a({ kind: "stockout", label: `s${i}`, date: `2026-10-0${i + 1}` })),
      ...Array.from({ length: 8 }, (_, i) => a({ kind: "code", label: `c${i}`, date: `2026-10-1${i}` })),
      ...Array.from({ length: 2 }, (_, i) => a({ kind: i ? "note" : "calendar", label: `e${i}`, date: `2026-10-2${i}` })),
    ];
    const out = capAnnotations(many);
    expect(out).toHaveLength(ANNOTATION_CAP - 2); // 2 calendar/note + 5 codes + 3 stockouts = 10
    expect(out.filter((x) => x.kind === "code")).toHaveLength(5);
    expect(out.filter((x) => x.kind === "stockout")).toHaveLength(3);
    expect(out.map((x) => x.label)).toContain("e0");
    expect(out.map((x) => x.label)).toContain("e1");
    expect(out.map((x) => x.date)).toEqual([...out.map((x) => x.date)].sort());
  });

  it("lets calendar entries and notes crowd out codes and stockouts once they alone fill the cap", () => {
    const events = Array.from({ length: 14 }, (_, i) => a({ kind: "calendar", label: `e${i}`, date: `2026-10-${String(i + 1).padStart(2, "0")}` }));
    const out = capAnnotations([...events, a({ kind: "code", label: "c" }), a({ kind: "stockout", label: "s" })]);
    expect(out).toHaveLength(ANNOTATION_CAP);
    expect(out.every((x) => x.kind === "calendar")).toBe(true);
  });
});

describe("shorten and noteExcerpt", () => {
  it("cuts at a word end with an ellipsis and leaves short text alone", () => {
    expect(shorten("  a   short one ", 40)).toBe("a short one");
    const cut = shorten("The Meta prospecting budget was reduced by forty percent from the fifth", 40);
    expect(cut.endsWith("…")).toBe(true);
    expect(cut.length).toBeLessThanOrEqual(40);
    expect(cut).not.toMatch(/\s…$/);
  });

  it("takes the first plain paragraph of a call note, skipping headings and the bold date and attendee lines, without markdown", () => {
    const body = "**Date:** 2026-10-01\n**Attendees:** A, B\n\n## Summary\nMara wants to **protect cash** ahead of the buy.\n\n## Decisions\n- Cut Meta.";
    expect(noteExcerpt(body)).toBe("Mara wants to protect cash ahead of the buy.");
    expect(noteExcerpt("## Decisions\n- Cut Meta by 40%.")).toBe("Cut Meta by 40%.");
  });
});

describe("loadPaceAnnotations on Solenne, October 2026", () => {
  it("has the Meta budget cut on October 5 and the Q4 budget call on October 1, in date order, as plain text", async () => {
    const out = await loadPaceAnnotations(db, sCtx.tenantId, "2026-10", { through: "2026-10-31" });
    expect(out.length).toBeLessThanOrEqual(ANNOTATION_CAP);
    expect(out.map((x) => x.date)).toEqual([...out.map((x) => x.date)].sort());
    const cut = out.find((x) => x.kind === "calendar" && x.date === "2026-10-05");
    expect(cut?.label).toBe("Meta prospecting budget reduced by 40%");
    expect(cut?.detail).toContain("Budget change");
    expect(cut?.detail).toContain("Agreed at the 2026-10-01 check-in");
    const call = out.find((x) => x.kind === "note" && x.date === "2026-10-01");
    expect(call?.label).toContain("Q4 budget");
    expect(call?.detail).toContain("protect cash");
    expect(out.every((x) => x.date >= "2026-10-01" && x.date <= "2026-10-31")).toBe(true);
  });

  it("clips an entry that began before the month to the first day, and leaves out one that is over or not yet started", async () => {
    await db.insert(calendarEvents).values([
      { tenantId: sCtx.tenantId, dateFrom: "2026-09-20", dateTo: "2026-10-03", title: "Autumn promo", type: "promo", channel: "email", details: "" },
      { tenantId: sCtx.tenantId, dateFrom: "2026-09-01", dateTo: "2026-09-30", title: "September only", type: "promo", channel: "all", details: "" },
      { tenantId: sCtx.tenantId, dateFrom: "2026-11-02", dateTo: "2026-11-04", title: "November only", type: "promo", channel: "all", details: "" },
    ]);
    const out = await loadPaceAnnotations(db, sCtx.tenantId, "2026-10", { through: "2026-10-31" });
    expect(out.find((x) => x.label === "Autumn promo")?.date).toBe("2026-10-01");
    expect(out.map((x) => x.label)).not.toContain("September only");
    expect(out.map((x) => x.label)).not.toContain("November only");
  });

  it("marks only codes that first appear in the month, on the first day, with the order counts from the orders", async () => {
    const out = (await loadPaceAnnotations(db, sCtx.tenantId, "2026-10", { through: "2026-10-31" })).filter((x) => x.kind === "code");
    const rows = await db
      .select({ code: orders.discountCode, first: min(orders.localDate), n: sql<number>`(count(*) filter (where ${orders.localDate} >= '2026-10-01' and ${orders.localDate} <= '2026-10-31'))::int` })
      .from(orders)
      .where(and(eq(orders.tenantId, sCtx.tenantId), isNull(orders.cancelledAt), isNotNull(orders.discountCode)))
      .groupBy(orders.discountCode);
    const fresh = rows.filter((r) => r.first! >= "2026-10-01" && r.first! <= "2026-10-31");
    expect(out.length).toBe(Math.min(fresh.length, 5));
    for (const m of out) {
      const r = fresh.find((f) => f.code === m.label)!;
      expect(r).toBeTruthy();
      expect(m.date).toBe(r.first);
      expect(m.detail).toContain(`${r.n} order`);
    }
  });

  it("stops the sales-based markers at the last complete day", async () => {
    const early = await loadPaceAnnotations(db, sCtx.tenantId, "2026-10", { through: "2026-10-04" });
    expect(early.filter((x) => x.kind === "code" || x.kind === "stockout").every((x) => x.date <= "2026-10-04")).toBe(true);
    expect(early.find((x) => x.date === "2026-10-05")).toBeTruthy(); // the calendar is not cut: a planned entry can lie ahead
  });

  it("leaves out the calendar and call notes for a viewer who is not offered them", async () => {
    const out = await loadPaceAnnotations(db, sCtx.tenantId, "2026-10", { through: "2026-10-31", internal: false });
    expect(out.some((x) => x.kind === "calendar" || x.kind === "note")).toBe(false);
  });

  it("gives nothing for a month the data does not reach and the calendar does not touch", async () => {
    const out = await loadPaceAnnotations(db, sCtx.tenantId, "2024-02", { through: "2024-02-29" });
    expect(out).toEqual([]);
  });
});

describe("loadPaceAnnotations: stockouts", () => {
  it("shows the first day of a long quiet spell for a variant that had been selling, one marker per product, never a one- or two-day gap", async () => {
    const out = await loadPaceAnnotations(db, sCtx.tenantId, "2026-09", { through: "2026-09-30", internal: false });
    const stock = out.filter((x) => x.kind === "stockout");
    expect(stock.length).toBeGreaterThan(0);
    expect(stock.length).toBeLessThanOrEqual(3);
    // September 2026 in the fixture: the 30 ml Hero Vitamin C Serum has no sales from the 1st to the 13th (the seeded supplier delay is the 3rd to the 13th).
    const serum = stock.find((x) => /Hero Vitamin C Serum/.test(x.label));
    expect(serum?.date).toBe("2026-09-01");
    expect(serum?.detail).toContain("13 days in a row from September 1");
    expect(serum?.detail).toContain("not confirmed");
    for (const s of stock) expect(Number(/for (\d+) days in a row/.exec(s.detail!)?.[1])).toBeGreaterThanOrEqual(3);
    const products = stock.map((x) => x.label.replace(/ \(.*\)$/, ""));
    expect(new Set(products).size).toBe(products.length);
  });

  it("says when a spell is still going on the last complete day, and does not look past it", async () => {
    const out = await loadPaceAnnotations(db, sCtx.tenantId, "2026-09", { through: "2026-09-06", internal: false });
    const serum = out.find((x) => /Hero Vitamin C Serum/.test(x.label));
    expect(serum?.detail).toContain("6 days in a row from September 1 (none on the last complete day either)");
  });
});

describe("loadPaceAnnotations: tenants", () => {
  it("never shows Tidepool a Solenne calendar entry, call note, code or product, and the other way round", async () => {
    const t = await loadPaceAnnotations(db, tCtx.tenantId, "2026-10", { through: "2026-10-31" });
    const s = await loadPaceAnnotations(db, sCtx.tenantId, "2026-10", { through: "2026-10-31" });
    const text = JSON.stringify(t);
    expect(text).not.toMatch(/Meta prospecting|Q4 budget|Solenne/i);
    expect(t.filter((x) => x.kind === "note")).toEqual([]); // Tidepool has no call notes
    expect(t.find((x) => x.kind === "calendar")?.label).toBe("Autumn swaddle campaign");
    expect(JSON.stringify(s)).not.toMatch(/swaddle/i);
    // A row written for another tenant after the fact stays out of both.
    const [other] = await db.insert(tenants).values({ orgId: "org_other", name: "Other" }).returning();
    await db.insert(calendarEvents).values({ tenantId: other!.id, dateFrom: "2026-10-10", dateTo: "2026-10-12", title: "Other brand sale", type: "promo", channel: "all", details: "" });
    await db.insert(callNotes).values({ tenantId: other!.id, heldOn: "2026-10-11", title: "Other call", body: "Secret plans" });
    expect(JSON.stringify(await loadPaceAnnotations(db, sCtx.tenantId, "2026-10", { through: "2026-10-31" }))).not.toMatch(/Other brand sale|Other call|Secret/);
    expect(JSON.stringify(await loadPaceAnnotations(db, tCtx.tenantId, "2026-10", { through: "2026-10-31" }))).not.toMatch(/Other brand sale|Other call|Secret/);
  });
});
