import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PLAYBOOK_IDS } from "@/lib/playbooks/definitions";
import type { PlaybookRunView } from "@/lib/playbooks/store";
import { PlaybookRun } from "./playbook-run";

// One saved run on the Playbooks page. The Creative briefs run (T23) carries one extra thing: a plain link that opens the chat with a
// question that drafts the campaign's landing page. It is only for a finished run, because a blocked write-up has figures nobody
// matched to the data and should not lead anywhere.

const HREF = "/chat?q=Draft%20a%20landing%20page%20for%20the%20next%20planned%20campaign.";
const LABEL = "Draft the campaign&#x27;s landing page in chat"; // the apostrophe as the renderer escapes it

const run = (over: Partial<PlaybookRunView> = {}): PlaybookRunView => ({
  id: "run-1",
  playbook: "creative-briefs",
  params: {},
  status: "ready",
  body: "**Best customers first**\n**Who:** The champions.\n\n**Last year.** A paragraph.",
  unmatched: [],
  createdAt: new Date("2026-11-02T17:00:00Z"),
  ...over,
});
const html = (r: PlaybookRunView, title = "Creative briefs") => renderToStaticMarkup(<PlaybookRun run={r} title={title} />);

describe("the link under a Creative briefs run", () => {
  it("is one plain link to the chat for a finished run, with the exact question in the address", () => {
    const out = html(run());
    expect(out).toContain(`href="${HREF}"`);
    expect(out).toContain(LABEL);
    expect(out.match(/href="\/chat\?q=/g)).toHaveLength(1);
    expect(decodeURIComponent(HREF.split("q=")[1]!)).toBe("Draft a landing page for the next planned campaign.");
  });

  it("sits under the write-up, which still shows its bold lead-ins", () => {
    const out = html(run());
    expect(out).toContain("<strong>Best customers first</strong>");
    expect(out.indexOf("Last year.")).toBeLessThan(out.indexOf(HREF));
    expect(out).toContain("Ready");
  });

  it("is left off a blocked run, which lists the figures that could not be matched instead", () => {
    const out = html(run({ status: "blocked", unmatched: ["69"] }));
    expect(out).not.toContain("/chat?q=");
    expect(out).not.toContain("landing page");
    expect(out).toContain("Blocked");
    expect(out).toContain("<li>69</li>");
  });

  it("is left off every other playbook's run", () => {
    for (const playbook of PLAYBOOK_IDS.filter((id) => id !== "creative-briefs")) {
      const out = html(run({ playbook, params: playbook === "monthly-review" ? { month: "2026-10" } : {} }), "Another playbook");
      expect(out, playbook).not.toContain("/chat?q=");
      expect(out, playbook).not.toContain("landing page");
    }
  });
});

// A write-up as the question asks for it (the real answers look like this): three intro paragraphs, then three briefs of one line per item.
const brief = (title: string, who: string) =>
  [
    `**${title}**`,
    `**Who:** ${who}`,
    "**Product:** Hero Vitamin C Serum in the 50 ml: 184 available, 613.3 days of cover, margin rate 76.4%.",
    `**Angle:** "You were here first, so you shop first."`,
    `**Hook lines:** "Black Friday opens for you first." / "Your serum, before everyone else's." / "A thank-you, a day early."`,
    "**Offer:** Early access a day before the public sale, with no code to share.",
    "**Proof:** Champions average $331.43 in lifetime value.",
    "**Do not:** Lead with the 30 ml, which runs out before the campaign starts.",
    "**Measure:** Orders from these customers in the week after the send.",
  ].join("\n");
const FULL = [
  "**Campaign.** Black Friday and Cyber Monday 2026, November 27 to 30.",
  "**Last year.** Customers whose first order fell in last year's Black Friday weekend came back at 18.2%.",
  "**Not pushing.** Lip Tint (refund rate 18.4%).",
  brief("Best customers first", "53 champions and 16 customers due to reorder."),
  brief("Win back the quiet ones", "99 at-risk customers."),
  brief("New customers", "People who have not bought."),
].join("\n\n");

describe("the Creative briefs cards", () => {
  it("draw a finished run as three brief cards, each with copy buttons, and keep the landing-page link under them", () => {
    const out = html(run({ body: FULL }));
    for (const title of ["Best customers first", "Win back the quiet ones", "New customers"]) expect(out).toContain(title);
    for (const n of [1, 2, 3]) expect(out).toContain(`Brief ${n}`);
    expect((out.match(/<button/g) ?? []).length).toBeGreaterThanOrEqual(9); // one per hook line, three briefs
    expect(out).not.toContain("**"); // the markers are gone: the cards show text, not markup
    expect(out).toContain("Black Friday opens for you first.");
    expect(out.match(/href="\/chat\?q=/g)).toHaveLength(1);
    expect(out.lastIndexOf("New customers")).toBeLessThan(out.indexOf(HREF));
  });

  it("show a blocked run as plain text, because its figures are unchecked", () => {
    const out = html(run({ body: FULL, status: "blocked", unmatched: ["69"] }));
    expect(out).not.toContain("Brief 1");
    expect(out).toContain("<strong>Best customers first</strong>");
    expect(out).not.toContain("<button");
  });

  it("are for Creative briefs only: another playbook with the same text stays plain", () => {
    const out = html(run({ playbook: "retention-check", body: FULL }), "Retention check");
    expect(out).not.toContain("Brief 1");
    expect(out).toContain("<strong>Best customers first</strong>");
  });

  it("fall back to the plain paragraphs when the write-up cannot be told apart, and lose no words", () => {
    const body = "**Campaign.** Nothing is planned, so this is for the next 30 days.\n\nA short note with no briefs in it.";
    const out = html(run({ body }));
    expect(out).toContain("<strong>Campaign.</strong>");
    expect(out).toContain("A short note with no briefs in it.");
    expect(out).not.toContain("Brief 1");
    expect(out).toContain(`href="${HREF}"`); // the link is for any finished Creative briefs run
  });
});
