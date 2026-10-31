import { describe, expect, it } from "vitest";
import { dateInQuote, verifyStatements, type Statement } from "./read";

const NOTE = `Decisions
- The November 2026 net sales target is raised to $12,000 to reflect the Black Friday offer.

Action items
- Priya to send the Black Friday email schedule to Mara by 2026-11-10.`;

const st = (kind: Statement["kind"], quote: string): Statement => ({ kind, sentence: quote, quote });

describe("verifyStatements", () => {
  it("keeps a quote that appears in the note, whatever its spacing, case or line breaks", () => {
    const { verified, unverified } = verifyStatements([st("action_item", "priya to send the black friday\nemail schedule to mara by 2026-11-10.")], NOTE);
    expect(verified).toHaveLength(1);
    expect(unverified).toHaveLength(0);
  });

  it("drops a quote the note does not contain, a changed figure and a quote that is too short", () => {
    const { verified, unverified } = verifyStatements(
      [st("plan_change", "The November 2026 net sales target is raised to $15,000"), st("action_item", "Tomas to confirm stock levels by 2026-11-13."), st("action_item", "Priya to")],
      NOTE,
    );
    expect(verified).toHaveLength(0);
    expect(unverified).toHaveLength(3);
  });
});

describe("dateInQuote", () => {
  it("accepts an ISO date that is written in the quote", () => {
    expect(dateInQuote("2026-11-10", "Priya to send it by 2026-11-10.", "2026-11-01")).toBe(true);
  });

  it("accepts a month name with the day, with the year left out only when it is the call's year or the next", () => {
    expect(dateInQuote("2026-11-10", "Priya to send it by November 10.", "2026-11-01")).toBe(true);
    expect(dateInQuote("2027-01-05", "Priya to send it by 5 Jan", "2026-12-20")).toBe(true);
    expect(dateInQuote("2031-11-10", "Priya to send it by November 10.", "2026-11-01")).toBe(false);
  });

  it("refuses a date the quote does not write, such as a relative one the model worked out", () => {
    expect(dateInQuote("2026-11-06", "Priya to send it by next Friday.", "2026-11-01")).toBe(false);
    expect(dateInQuote("2026-11-12", "Priya to send it by November 10.", "2026-11-01")).toBe(false);
  });
});
