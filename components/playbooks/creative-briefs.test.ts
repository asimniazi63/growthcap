import { describe, expect, it } from "vitest";
import { parseCreativeBriefs } from "./creative-briefs";
import type { CreativeBrief, CreativeBriefsParsed } from "./creative-briefs-types";

// A write-up as the question asks for it, copied from the eval's own sample (evals/t23-cases.test.ts), which the real number checker
// accepted. Real model answers look like this, so the parser is tested on it first and on small changes to it after.
const BEST = [
  "**Best customers first**",
  "**Who:** 53 champions and 16 customers due to reorder, by email and text message.",
  "**Product:** Hero Vitamin C Serum in the 50 ml: 184 available, 613.3 days of cover, margin rate 76.4%.",
  `**Angle:** "You were here first, so you shop first."`,
  `**Hook lines:** "Black Friday opens for you first." / "Your serum, before everyone else's." / "A thank-you, a day early."`,
  "**Offer:** Early access a day before the public sale, with no code to share.",
  "**Proof:** Champions average $331.43 in lifetime value; the serum was 26.3% of units sold in the last 90 days.",
  "**Do not:** Lead with the 30 ml: 12 available and 18.9 days of cover, so it runs out before the campaign starts.",
  "**Measure:** Orders from these customers in the week after the send.",
];
const QUIET = [
  "**Win back the quiet ones**",
  "**Who:** 99 at-risk customers, by email. They last ordered 202.2 days ago on average and are worth $296.07 each in lifetime value.",
  "**Product:** Barrier Cream in the 100 ml: 204 available, 765 days of cover, margin rate 79.4%.",
  `**Angle:** "Pick up where you left off."`,
  `**Hook lines:** "It has been a while." / "Your routine is waiting." / "An easy way back."`,
  "**Offer:** A free mini with any order, not a percent off.",
  "**Proof:** Barrier Cream sold 110 units in the last 90 days, with a refund rate of 3.6%.",
  "**Do not:** Make any claim about reactions or sensitive skin.",
  "**Measure:** Reorders in the two weeks after the send, against a held-out group that gets nothing.",
];
const FRESH = [
  "**New customers**",
  "**Who:** People who have not bought, on paid social. The calendar shows a paid-social budget change, which makes this the costliest audience to reach.",
  "**Product:** Daily Gel Cleanser in the 150 ml: 85 available, 425 days of cover, margin rate 82.1%.",
  `**Angle:** "Start with one good habit."`,
  `**Hook lines:** "Your first step, made simple." / "One cleanser, a better routine." / "Start here this Black Friday."`,
  "**Offer:** A free gift with the first order. If a percent off is needed, 10% at most, which takes the profit margin to 13.8%, the worst case because it prices the whole store and assumes a price response.",
  "**Proof:** Daily Gel Cleanser sold 47 units in the last 90 days with a refund rate of 2.1%.",
  "**Do not:** Lead with a percent off.",
  "**Measure:** New-customer orders by offer, six weeks after the campaign.",
];
const CAMPAIGN = "**Campaign.** Black Friday and Cyber Monday 2026, November 27 to 30.";
const LAST_YEAR = "**Last year.** Customers whose first order fell in last year's Black Friday weekend came back within 180 days at 18.2% (33 customers), against 42.5% (40 customers) for those who first ordered in the weeks before. The profit margin falls from 15.6% to 13.8% at ten percent off and to 6.8% at twenty-five percent off, so do not repeat a deep store-wide offer.";
const NOT_PUSHING = "**Not pushing.** Lip Tint (refund rate 18.4%) and Niacinamide Clarity Serum (13.3%) on refunds, and the Hero Vitamin C Serum 30 ml, which runs out before the campaign starts.";
const write = (parts: { best?: string[]; quiet?: string[]; fresh?: string[] } = {}) =>
  [CAMPAIGN, LAST_YEAR, NOT_PUSHING, (parts.best ?? BEST).join("\n"), (parts.quiet ?? QUIET).join("\n"), (parts.fresh ?? FRESH).join("\n")].join("\n\n");
const GOOD = write();

// The parse that must succeed, so a test reads its result without a non-null check on every line.
const parse = (text: string): CreativeBriefsParsed => {
  const parsed = parseCreativeBriefs(text);
  if (!parsed) throw new Error("expected the write-up to parse");
  return parsed;
};
const briefAt = (p: CreativeBriefsParsed, i: number): CreativeBrief => {
  const b = p.briefs[i];
  if (!b) throw new Error(`no brief at ${i}`);
  return b;
};

// The words of a write-up with the lead-ins left out (**Who:**, **Last year.**: they become field names), and the quotes, the double
// asterisks, the " / " between hooks and the rules. Bold titles have no colon or full stop inside, so they stay.
const inputWords = (text: string): string[] =>
  text
    .replace(/^\s*---\s*$/gm, " ")
    .replace(/\*\*[^*]*[:.]\*\*/g, " ")
    .replace(/\*\*|["“”]/g, "")
    .split(/\s+/)
    .filter((w) => w !== "" && w !== "/")
    .sort();
const outputWords = (p: CreativeBriefsParsed): string[] =>
  [
    p.campaign,
    p.lastYear,
    p.notPushing,
    ...p.briefs.flatMap((b) => [b.title, b.who, b.product, b.angle, ...b.hooks, b.offer, b.proof, b.doNot, b.measure, ...b.other.flatMap((o) => [o.label, o.text])]),
    ...p.rest,
  ]
    .filter((s): s is string => s !== null)
    .join(" ")
    .replace(/\*\*/g, "")
    .split(/\s+/)
    .filter((w) => w !== "")
    .sort();

describe("parseCreativeBriefs: a write-up as the question asks for it", () => {
  it("reads the three intro paragraphs and the three briefs, item by item", () => {
    const parsed = parse(GOOD);
    expect(parsed.campaign).toBe("Black Friday and Cyber Monday 2026, November 27 to 30.");
    expect(parsed.lastYear).toBe(LAST_YEAR.replace("**Last year.** ", ""));
    expect(parsed.notPushing).toBe(NOT_PUSHING.replace("**Not pushing.** ", ""));
    expect(parsed.rest).toEqual([]);
    expect(parsed.briefs.map((b) => b.title)).toEqual(["Best customers first", "Win back the quiet ones", "New customers"]);
    expect(briefAt(parsed, 0)).toEqual({
      title: "Best customers first",
      who: "53 champions and 16 customers due to reorder, by email and text message.",
      product: "Hero Vitamin C Serum in the 50 ml: 184 available, 613.3 days of cover, margin rate 76.4%.",
      angle: "You were here first, so you shop first.",
      hooks: ["Black Friday opens for you first.", "Your serum, before everyone else's.", "A thank-you, a day early."],
      offer: "Early access a day before the public sale, with no code to share.",
      proof: "Champions average $331.43 in lifetime value; the serum was 26.3% of units sold in the last 90 days.",
      doNot: "Lead with the 30 ml: 12 available and 18.9 days of cover, so it runs out before the campaign starts.",
      measure: "Orders from these customers in the week after the send.",
      other: [],
    });
    for (const b of parsed.briefs) {
      expect(b.hooks).toHaveLength(3);
      expect(b.angle).not.toMatch(/["“”]/);
      for (const value of [b.who, b.product, b.offer, b.proof, b.doNot, b.measure]) expect(value).toBeTruthy();
      expect(b.other).toEqual([]);
    }
    expect(briefAt(parsed, 1).angle).toBe("Pick up where you left off.");
    expect(briefAt(parsed, 2).offer).toContain("profit margin to 13.8%");
  });

  it("keeps every word: nothing but the lead-ins, quotes and rules is dropped, and what it cannot place goes to rest", () => {
    const messy = ["Here is the plan.", "---", write({ best: [BEST[0]!, "Reward the champions early.", ...BEST.slice(1)] })].join("\n\n");
    const parsed = parse(messy);
    expect(parsed.rest).toEqual(["Here is the plan.", "Reward the champions early."]);
    expect(outputWords(parsed)).toEqual(inputWords(messy));
    expect(outputWords(parse(GOOD))).toEqual(inputWords(GOOD));
  });
});

describe("parseCreativeBriefs: the variants of the format", () => {
  it("takes 'Brief N' off a title, however it is written", () => {
    const parsed = parse(
      write({
        best: ["**Brief 1: Best customers first**", ...BEST.slice(1)],
        quiet: ["**Brief 2 - Win back the quiet ones**", ...QUIET.slice(1)],
        fresh: ["**Brief 3:** New customers", ...FRESH.slice(1)],
      }),
    );
    expect(parsed.briefs.map((b) => b.title)).toEqual(["Best customers first", "Win back the quiet ones", "New customers"]);
    expect(parsed.rest).toEqual([]);
  });

  it("reads '**Brief 3**' on a line of its own as the start of the brief whose title is on the next line", () => {
    const parsed = parse(write({ fresh: ["**Brief 3**", ...FRESH] }));
    expect(parsed.briefs.map((b) => b.title)).toEqual(["Best customers first", "Win back the quiet ones", "New customers"]);
  });

  it("reads each item in a paragraph of its own, with rules between the paragraphs", () => {
    const spaced = GOOD.replace(/\n(?!\n)/g, "\n\n");
    const ruled = spaced.replace(/\n\n(?=\*\*(?:Best|Win|New))/g, "\n\n---\n\n");
    expect(parse(spaced)).toEqual(parse(GOOD));
    expect(parse(ruled)).toEqual(parse(GOOD));
  });

  it("reads the hook lines as bullets, as a list with slashes, or as a list with semicolons, none of them in quotes", () => {
    const expected = ["Black Friday opens for you first.", "Your serum, before everyone else's.", "A thank-you, a day early."];
    const withHooks = (...lines: string[]) => parse(write({ best: [...BEST.slice(0, 4), ...lines, ...BEST.slice(5)] }));
    const bullets = withHooks("**Hook lines:**", "- Black Friday opens for you first.", "* Your serum, before everyone else's.", "• A thank-you, a day early.");
    const numbered = withHooks("**Hook lines:**", "1. Black Friday opens for you first.", "2. Your serum, before everyone else's.", "3. A thank-you, a day early.");
    const slashes = withHooks("**Hook lines:** Black Friday opens for you first. / Your serum, before everyone else's. / A thank-you, a day early.");
    const semicolons = withHooks("**Hook lines:** Black Friday opens for you first.; Your serum, before everyone else's.; A thank-you, a day early.");
    for (const parsed of [bullets, numbered, slashes, semicolons]) expect(briefAt(parsed, 0).hooks).toEqual(expected);
    expect(briefAt(bullets, 0).offer).toBe("Early access a day before the public sale, with no code to share.");
  });

  it("reads curly quotes, and keeps at most six hooks", () => {
    const hooks = `**Hook lines:** “One.” / “Two.” / “Three.” / “Four.” / “Five.” / “Six.” / “Seven.”`;
    const parsed = parse(write({ best: [...BEST.slice(0, 3), "**Angle:** “You shop first.”", hooks, ...BEST.slice(5)] }));
    expect(briefAt(parsed, 0).hooks).toEqual(["One.", "Two.", "Three.", "Four.", "Five.", "Six."]);
    expect(briefAt(parsed, 0).angle).toBe("You shop first.");
  });

  it("leaves the angle as written when it has no quotes, and gives [] for a missing hook line", () => {
    const parsed = parse(write({ best: [...BEST.slice(0, 3), "**Angle:** You shop first.", ...BEST.slice(5)] }));
    expect(briefAt(parsed, 0).angle).toBe("You shop first.");
    expect(briefAt(parsed, 0).hooks).toEqual([]);
  });

  it("reads the colon outside the bold, a plain name with a colon, a dash after the bold, and any capitals", () => {
    const parsed = parse(
      write({
        quiet: [
          "**Win back the quiet ones**",
          "**Who**: 99 at-risk customers, by email.",
          "Product: Barrier Cream in the 100 ml.",
          `**Angle.** "Pick up where you left off."`,
          `**HOOKS:** "It has been a while." / "An easy way back."`,
          "**Offer** - A free mini with any order.",
          "**Don't:** Make any claim about reactions.",
          "**Measure**: Reorders in the two weeks after the send.",
        ],
      }),
    );
    expect(briefAt(parsed, 1)).toEqual({
      title: "Win back the quiet ones",
      who: "99 at-risk customers, by email.",
      product: "Barrier Cream in the 100 ml.",
      angle: "Pick up where you left off.",
      hooks: ["It has been a while.", "An easy way back."],
      offer: "A free mini with any order.",
      proof: null,
      doNot: "Make any claim about reactions.",
      measure: "Reorders in the two weeks after the send.",
      other: [],
    });
  });

  it("joins a line with no lead-in to the item or intro above it, with a space", () => {
    const split = GOOD.replace("2026, November", "2026,\nNovember").replace("lifetime value; the serum", "lifetime value;\nthe serum");
    const parsed = parse(split);
    expect(parsed.campaign).toBe("Black Friday and Cyber Monday 2026, November 27 to 30.");
    expect(briefAt(parsed, 0).proof).toBe("Champions average $331.43 in lifetime value; the serum was 26.3% of units sold in the last 90 days.");
    expect(parsed.rest).toEqual([]);
  });

  it("puts an item line it does not know in the brief's other, with its continuation, and the items after it still land", () => {
    const parsed = parse(write({ best: [...BEST.slice(0, 7), "**Why now:** The sale starts in a week.", "It is the first one of the season.", ...BEST.slice(7)] }));
    expect(briefAt(parsed, 0).other).toEqual([{ label: "Why now", text: "The sale starts in a week. It is the first one of the season." }]);
    expect(briefAt(parsed, 0).doNot).toContain("Lead with the 30 ml");
    expect(briefAt(parsed, 0).measure).toBe("Orders from these customers in the week after the send.");
    expect(briefAt(parsed, 1).other).toEqual([]);
  });

  it("puts a paragraph that is none of these in rest as it was written, ** markers included", () => {
    const text = ["**Heads up.** Numbers are as of the last sync.", GOOD, "Remember: **do not** promise delivery dates."].join("\n\n");
    const parsed = parse(text);
    expect(parsed.rest).toEqual(["**Heads up.** Numbers are as of the last sync.", "Remember: **do not** promise delivery dates."]);
    expect(parsed.briefs).toHaveLength(3);
  });

  it("reads intro paragraphs that come after the briefs", () => {
    const after = [BEST.join("\n"), QUIET.join("\n"), FRESH.join("\n"), CAMPAIGN, LAST_YEAR, NOT_PUSHING].join("\n\n");
    const parsed = parse(after);
    expect(parsed.campaign).toBe("Black Friday and Cyber Monday 2026, November 27 to 30.");
    expect(parsed.lastYear).toBe(LAST_YEAR.replace("**Last year.** ", ""));
    expect(parsed.notPushing).toBe(NOT_PUSHING.replace("**Not pushing.** ", ""));
    expect(parsed.briefs.map((b) => b.title)).toEqual(["Best customers first", "Win back the quiet ones", "New customers"]);
    expect(briefAt(parsed, 2).measure).toBe("New-customer orders by offer, six weeks after the campaign.");
  });

  it("starts an untitled brief, called 'Brief N', for items that come before any title", () => {
    const parsed = parse(write({ best: BEST.slice(1) }));
    expect(parsed.briefs.map((b) => b.title)).toEqual(["Brief 1", "Win back the quiet ones", "New customers"]);
    expect(briefAt(parsed, 0).who).toContain("53 champions");
  });

  it("reads a bold name that ends in a colon as a title when an item line follows it, also in the next paragraph", () => {
    const colons = parse(
      write({
        best: ["**Best customers first:**", ...BEST.slice(1)],
        quiet: ["**Win back the quiet ones:**", ...QUIET.slice(1)],
        fresh: ["**New customers:**", ...FRESH.slice(1)],
      }),
    );
    expect(colons.briefs.map((b) => b.title)).toEqual(["Best customers first", "Win back the quiet ones", "New customers"]);
    // Each brief keeps its own items: none is appended to the brief above, and no title is left behind as an item line.
    expect(colons.briefs.map((b) => (b.who ?? "").split(" ").slice(0, 2).join(" "))).toEqual(["53 champions", "99 at-risk", "People who"]);
    expect(colons.briefs.every((b) => b.other.length === 0)).toBe(true);
    expect(colons.rest).toEqual([]);
    // A full stop, and the colon outside the bold, with every line in a paragraph of its own: the same write-up as the plain one.
    const mixed = write({
      best: ["**Best customers first.**", ...BEST.slice(1)],
      quiet: ["**Win back the quiet ones**:", ...QUIET.slice(1)],
      fresh: ["**New customers:**", ...FRESH.slice(1)],
    }).replace(/\n(?!\n)/g, "\n\n");
    expect(parse(mixed)).toEqual(parse(GOOD));
  });

  it("does not read a bold name with a colon as a title when prose follows it, and keeps an intro alone on its line with the text below", () => {
    const parsed = parse(write({ best: [...BEST, "**Note:**", "Figures are as of the last sync."] }));
    expect(parsed.briefs.map((b) => b.title)).toEqual(["Best customers first", "Win back the quiet ones", "New customers"]);
    expect(briefAt(parsed, 0).other).toEqual([{ label: "Note", text: "Figures are as of the last sync." }]);
    expect(briefAt(parsed, 0).measure).toBe("Orders from these customers in the week after the send.");
    expect(parsed.rest).toEqual([]);
    // **Campaign.** on a line of its own is the intro, not a title, whether its text is on the next line or in the next paragraph.
    for (const gap of ["\n", "\n\n"]) {
      const alone = parse(GOOD.replace(CAMPAIGN, `**Campaign.**${gap}Black Friday and Cyber Monday 2026, November 27 to 30.`));
      expect(alone.campaign).toBe("Black Friday and Cyber Monday 2026, November 27 to 30.");
      expect(alone.briefs.map((b) => b.title)).toEqual(["Best customers first", "Win back the quiet ones", "New customers"]);
    }
  });
});

describe("parseCreativeBriefs: when the text is not a set of briefs", () => {
  it("returns null for a single brief", () => {
    expect(parseCreativeBriefs([CAMPAIGN, BEST.join("\n")].join("\n\n"))).toBeNull();
  });

  it("returns null for plain prose and for an empty string", () => {
    expect(parseCreativeBriefs("Send your best customers an early-access email. Then follow up with the quiet ones.\n\nNew customers cost more now.")).toBeNull();
    expect(parseCreativeBriefs("")).toBeNull();
    expect(parseCreativeBriefs("  \n\n \n")).toBeNull();
  });

  it("returns null when fewer than two briefs have three recognised items", () => {
    expect(parseCreativeBriefs(write({ quiet: QUIET.slice(0, 3), fresh: FRESH.slice(0, 3) }))).toBeNull();
  });

  it("does not throw on odd input", () => {
    for (const text of ["**", "** ** **", "**Who:**", "#", "---", ":::", "**Brief 1**\n**Brief 2**", "- \n- \n-", "“”", "**a**:**b**"]) {
      expect(() => parseCreativeBriefs(text)).not.toThrow();
    }
    expect(parseCreativeBriefs(null as unknown as string)).toBeNull();
    expect(parseCreativeBriefs(undefined as unknown as string)).toBeNull();
  });
});
