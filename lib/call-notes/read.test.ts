import { describe, expect, it } from "vitest";
import { scriptedReader } from "../plan-in/test-support";
import { dateInQuote, listedActionItems, readCallNote, verifyStatements, type Statement } from "./read";

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

const FULL_NOTE = `# Black Friday planning
**Date:** 2026-11-01

## Decisions
- The November 2026 net sales target is raised to $12,000 to reflect the Black Friday offer.
- BFCM26 stays live for Black Friday week only and is not extended.

## Action items
- Priya to send the Black Friday email schedule to Mara by 2026-11-10.
- Tomas to confirm Black Friday stock levels for the best sellers by 2026-11-13.`;

describe("listedActionItems: the lines under an action heading", () => {
  it("lists each bullet under 'Action items' and none of the bullets under other headings", () => {
    expect(listedActionItems(FULL_NOTE)).toEqual([
      "Priya to send the Black Friday email schedule to Mara by 2026-11-10.",
      "Tomas to confirm Black Friday stock levels for the best sellers by 2026-11-13.",
    ]);
  });

  it("knows bold headings, 'Label:' headings and numbered lists, and stops at the next heading", () => {
    const text = `**Next steps**\n1. Priya to send the schedule to Mara by 2026-11-10.\n2) Tomas to confirm the stock levels.\n\n**Decisions**\n- BFCM26 stays live for Black Friday week only.`;
    expect(listedActionItems(text)).toEqual(["Priya to send the schedule to Mara by 2026-11-10.", "Tomas to confirm the stock levels."]);
    expect(listedActionItems("To-do:\n* Mara to approve the offer copy.\nDecisions:\n* Nothing else changes this month.")).toEqual(["Mara to approve the offer copy."]);
  });

  it("finds nothing in a note with no action heading, and skips a bullet too short to be a follow-up", () => {
    expect(listedActionItems("Summary\n- Priya to send the schedule to Mara.")).toEqual([]);
    expect(listedActionItems("## Action items\n- None")).toEqual([]);
  });
});

describe("readCallNote: a follow-up the first pass missed is still read", () => {
  const plan = { kind: "plan_change", sentence: "The November target is $12,000.", quote: "The November 2026 net sales target is raised to $12,000 to reflect the Black Friday offer." };
  const priya = { kind: "action_item", sentence: "Priya sends the schedule.", quote: "Priya to send the Black Friday email schedule to Mara by 2026-11-10." };
  const pass2 = {
    planChanges: [{ statement: 1, month: "2026-11", metric: "net_sales", value: 1200000 }],
    actionItems: [
      { statement: 2, title: "Send Black Friday email schedule to Mara", owner: "Priya", dueOn: "2026-11-10" },
      { statement: 3, title: "Confirm Black Friday stock levels", owner: "Tomas", dueOn: "2026-11-13" },
    ],
    unapplied: [],
  };

  it("hands the missed line to the second pass as an action item, and the review shows both items", async () => {
    const model = scriptedReader({ statements: [plan, priya] }, pass2); // the first pass leaves out Tomas's line
    const out = await readCallNote(FULL_NOTE, "2026-11-01", { model });
    expect(out.actionItems.map((a) => [a.owner, a.dueOn])).toEqual([["Priya", "2026-11-10"], ["Tomas", "2026-11-13"]]);
    expect(out.actionItems[1]!.quote).toBe("Tomas to confirm Black Friday stock levels for the best sellers by 2026-11-13.");
    expect(out.unapplied).toEqual([]);
    expect(JSON.stringify(model.doGenerateCalls[1]!.prompt)).toContain("3. (action_item) Tomas to confirm Black Friday stock levels");
  });

  it("does not add a line the first pass already found", async () => {
    const tomas = { kind: "action_item", sentence: "Tomas confirms stock.", quote: "Tomas to confirm Black Friday stock levels for the best sellers by 2026-11-13." };
    const model = scriptedReader({ statements: [plan, priya, tomas] }, pass2);
    await readCallNote(FULL_NOTE, "2026-11-01", { model });
    const prompt = JSON.stringify(model.doGenerateCalls[1]!.prompt);
    expect(prompt).toContain("3. (action_item)");
    expect(prompt).not.toContain("4. (action_item)");
  });

  it("shows a missed line the second pass says nothing about, never loses it", async () => {
    const model = scriptedReader({ statements: [plan, priya] }, { ...pass2, actionItems: [pass2.actionItems[0]] });
    const out = await readCallNote(FULL_NOTE, "2026-11-01", { model });
    expect(out.actionItems.map((a) => a.owner)).toEqual(["Priya"]);
    expect(out.unapplied).toEqual([{ sentence: "Tomas to confirm Black Friday stock levels for the best sellers by 2026-11-13.", reason: expect.stringMatching(/Check it by hand/) }]);
  });

  it("reads a note whose action list is all the first pass left out", async () => {
    const model = scriptedReader({ statements: [] }, { planChanges: [], actionItems: [{ statement: 1, title: "Send the schedule", owner: "Priya", dueOn: "2026-11-10" }, { statement: 2, title: "Confirm stock", owner: "Tomas", dueOn: "2026-11-13" }], unapplied: [] });
    const out = await readCallNote(FULL_NOTE, "2026-11-01", { model });
    expect(out.actionItems.map((a) => a.owner)).toEqual(["Priya", "Tomas"]);
  });
});
