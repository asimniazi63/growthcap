import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CopyButton } from "./copy-button";
import type { CreativeBrief, CreativeBriefsParsed } from "./creative-briefs-types";
import { CreativeBriefsView, figureSegments, splitOffer } from "./creative-briefs-view";

// The repo has no browser-like DOM for tests (no jsdom, no Testing Library), so this runs in plain Node, as the EBITDA scenario panel's
// test does. The view is drawn to markup and read as text. The copy button keeps its one piece of state in useState, which is replaced
// by a small store that holds its value from one draw to the next: a test finds the button in the element tree the real component
// returns, calls its click handler, and draws again to see what a person would see.
const hooks = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0 }));
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState: <T,>(initial: T | (() => T)) => {
      const i = hooks.cursor++;
      if (!(i in hooks.slots)) hooks.slots[i] = typeof initial === "function" ? (initial as () => T)() : initial;
      const set = (next: T | ((cur: T) => T)) => {
        hooks.slots[i] = typeof next === "function" ? (next as (cur: T) => T)(hooks.slots[i] as T) : next;
      };
      return [hooks.slots[i] as T, set] as const;
    },
  };
});

beforeEach(() => {
  hooks.slots = [];
  hooks.cursor = 0;
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// As the renderer writes text into markup, so a hook with an apostrophe in it can be found there.
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
// The markup as plain words. A highlighted figure or a bold lead-in sits inside its sentence, so those tags are removed without a gap.
const text = (markup: string) =>
  markup
    .replace(/<span class="[^"]*tabular-nums[^"]*">([^<]*)<\/span>/g, "$1")
    .replace(/<\/?strong>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const HOOKS = [
  ["Early access, just for you", "You bought it first, so you get it first", "Black Friday opens for you on the 26th"],
  ["It has been a while, and we saved your spot", "Don't miss the serum you loved", "Come back for 2 days only"],
  ["Meet the serum behind 4.8 stars", "Your first order, a gift & a welcome", "Start your routine this weekend"],
] as const;

// Real-shaped briefs: the first offer states a profit limit, the other two do not.
const BRIEFS: CreativeBrief[] = [
  {
    title: "Best customers first",
    who: "53 champions and 16 customers due to reorder",
    product: "Hero Vitamin C Serum in the 50 ml: 184 available, 613.3 days of cover, margin rate 76.4%",
    angle: "Your first look at the sale, a day before everyone else",
    hooks: [...HOOKS[0]],
    offer: "Early access a day before the public sale. Taking 10% off would take the profit margin to 13.8%, the worst case.",
    proof: "53 champions bought in the last 90 days; 16 are due to reorder; the serum averages 4.8 stars over 120 reviews",
    doNot: "Do not offer more than 10% off, and do not show the sale price before the sale opens.",
    measure: "Orders from the 69 customers in the first 24 hours, against the same group last year.",
    other: [],
  },
  {
    title: "Win back the quiet ones",
    who: "212 customers who have not bought in 180 days",
    product: "Daily Moisturiser SPF 30: 96 available, 41.2 days of cover",
    angle: "We kept your favourites in stock",
    hooks: [...HOOKS[1]],
    offer: "Free shipping on orders over $50.",
    proof: "Customers who reorder spend $331.43 on average, which is the longest tail in the shop.",
    doNot: "Do not discount the moisturiser, which has under 42 days of cover.",
    measure: "Reactivated customers by Cyber Monday.",
    other: [{ label: "Channel", text: "Email first, then SMS two days later." }],
  },
  {
    title: "New customers",
    who: "Visitors who joined the list since September and have not bought",
    product: "Starter Serum Duo: 410 available",
    angle: "Start with the one everyone reorders",
    hooks: [...HOOKS[2]],
    offer: "A free travel-size serum with a first order of $60 or more.",
    proof: "Reviewers give the serum 4.8 stars over 120 reviews.",
    doNot: "Do not promise delivery dates.",
    measure: "First orders from the list, against September.",
    other: [],
  },
];

const parsed = (over: Partial<CreativeBriefsParsed> = {}): CreativeBriefsParsed => ({
  campaign: "Black Friday and Cyber Monday 2026, November 27 to 30.",
  lastYear: "Last year the sale made 69 orders worth $4,120.50, and the serum sold out on day 2.",
  notPushing: "The Daily Moisturiser has 41.2 days of cover left, so it stays out of the offer.",
  briefs: BRIEFS,
  rest: [],
  ...over,
});
const emptyBrief = (over: Partial<CreativeBrief> = {}): CreativeBrief => ({
  title: "Bare brief",
  who: null,
  product: null,
  angle: null,
  hooks: [],
  offer: null,
  proof: null,
  doNot: null,
  measure: null,
  other: [],
  ...over,
});
const html = (p: CreativeBriefsParsed = parsed()) => {
  hooks.cursor = 0;
  return renderToStaticMarkup(<CreativeBriefsView parsed={p} />);
};
const count = (haystack: string, needle: RegExp) => (haystack.match(needle) ?? []).length;

describe("CreativeBriefsView", () => {
  it("draws one numbered card per brief, each with its title as a heading, in an ordered list", () => {
    const out = html();
    expect(count(out, /<ol /g)).toBe(1);
    expect(count(out, /data-brief="\d"/g)).toBe(3);
    expect(count(out, /<h3 /g)).toBe(3);
    const t = text(out);
    for (const [i, brief] of BRIEFS.entries()) {
      expect(t, `eyebrow ${i + 1}`).toContain(`Brief ${i + 1} ${brief.title}`);
    }
    expect(t.indexOf("Brief 1")).toBeLessThan(t.indexOf("Brief 2"));
    expect(t.indexOf("Brief 2")).toBeLessThan(t.indexOf("Brief 3"));
    expect(out).toContain("lg:grid-cols-3");
  });

  it("gives every hook line, and every angle, a copy button named after the text it copies", () => {
    const out = html();
    const hookLines = HOOKS.flat();
    expect(hookLines).toHaveLength(9);
    for (const hook of hookLines) expect(count(out, new RegExp(`aria-label="${esc(`Copy hook line: ${hook}`)}"`, "g")), hook).toBe(1);
    for (const brief of BRIEFS) expect(out).toContain(`aria-label="${esc(`Copy angle: ${brief.angle}`)}"`);
    expect(count(out, /aria-label="Copy hook line: /g)).toBe(9);
    expect(count(out, /aria-label="Copy angle: /g)).toBe(3);
    expect(out).toContain("\u201CYour first look at the sale, a day before everyone else\u201D");
    expect(text(out)).toContain("Hook lines");
  });

  it("shows the profit-limit callout only for an offer that talks about margin, apart from the rest of the offer", () => {
    const out = html();
    expect(count(out, /Profit limit/g)).toBe(1);
    const first = out.slice(out.indexOf('data-brief="1"'), out.indexOf('data-brief="2"'));
    expect(first).toContain("Profit limit");
    expect(text(first)).toContain("Profit limit Taking 10% off would take the profit margin to 13.8%, the worst case.");
    expect(text(first)).toContain("Early access a day before the public sale.");
    expect(out.slice(out.indexOf('data-brief="2"'))).not.toContain("Profit limit");
    expect(text(out)).toContain("Free shipping on orders over $50.");
  });

  it("marks the figures in the product, proof and offer text, and nowhere else in the do-not box", () => {
    const out = html();
    for (const figure of ["76.4%", "613.3", "184", "13.8%", "$331.43"]) {
      expect(out, figure).toMatch(new RegExp(`<span class="[^"]*tabular-nums[^"]*">${esc(figure).replace(/[$.]/g, "\\$&")}</span>`));
    }
    const doNot = out.slice(out.indexOf("Do not offer more than 10% off"), out.indexOf("Do not offer more than 10% off") + 90);
    expect(doNot).not.toContain("<span");
  });

  it("splits the proof into bullets when it cuts cleanly, and keeps it as a paragraph when it does not", () => {
    const out = html();
    const first = out.slice(out.indexOf('data-brief="1"'), out.indexOf('data-brief="2"'));
    expect(count(first, /list-disc/g)).toBe(1);
    expect(text(first)).toContain("16 are due to reorder");
    const solo = html(parsed({ briefs: [emptyBrief({ proof: "Margin rate 76.4%, 184 available, 613.3 days of cover." }), emptyBrief({ proof: "A. B." })] }));
    expect(count(solo, /list-disc/g)).toBe(1); // the second proof is two short sentences, the first is one
    expect(text(solo)).toContain("Proof Margin rate 76.4%, 184 available, 613.3 days of cover.");
  });

  it("starts every proof bullet with a capital, since one cut at a semicolon begins mid-sentence, but leaves a name like iPhone alone", () => {
    const out = html();
    const first = out.slice(out.indexOf('data-brief="1"'), out.indexOf('data-brief="2"'));
    expect(text(first)).toContain("The serum averages 4.8 stars over 120 reviews");
    expect(text(first)).not.toContain("the serum averages");
    const names = html(parsed({ briefs: [emptyBrief({ proof: "iPhone cases sold well; the serum too" }), emptyBrief({ proof: "A. B." })] }));
    expect(text(names)).toContain("iPhone cases sold well");
    expect(text(names)).toContain("The serum too");
  });

  it("shows a Do not box and a Measure line on every brief, and the unknown lines as labelled rows", () => {
    const out = html();
    expect(count(out, />Do not</g)).toBe(3);
    expect(count(out, />Measure</g)).toBe(3);
    expect(text(out)).toContain("Do not offer more than 10% off, and do not show the sale price before the sale opens.");
    expect(text(out)).toContain("Channel Email first, then SMS two days later.");
  });

  it("shows the campaign line and the Last year and Not pushing callouts, and leaves each out when it is null", () => {
    const full = text(html());
    expect(full).toContain("Campaign Black Friday and Cyber Monday 2026, November 27 to 30.");
    expect(full).toContain("Last year Last year the sale made 69 orders");
    expect(full).toContain("Not pushing The Daily Moisturiser has 41.2 days of cover left");
    expect(count(html(), /role="note"/g)).toBe(3); // two callouts and the profit limit

    const bare = html(parsed({ campaign: null, lastYear: null, notPushing: null }));
    expect(text(bare)).not.toContain("Campaign");
    expect(text(bare)).not.toContain("Last year");
    expect(text(bare)).not.toContain("Not pushing");
    expect(count(bare, /role="note"/g)).toBe(1); // only the profit limit

    const onlyLastYear = html(parsed({ notPushing: null }));
    expect(text(onlyLastYear)).toContain("Last year");
    expect(text(onlyLastYear)).not.toContain("Not pushing");
  });

  it("shows every other paragraph under the cards, with its bold lead-in", () => {
    const out = html(parsed({ rest: ["**Note.** Keep every claim to what the data shows.", "A second paragraph\nwith a line break."] }));
    expect(out).toContain("<strong>Note.</strong>");
    expect(text(out)).toContain("Note. Keep every claim to what the data shows.");
    expect(text(out)).toContain("A second paragraph with a line break.");
    expect(out.lastIndexOf("Keep every claim")).toBeGreaterThan(out.indexOf('data-brief="3"'));
    expect(html()).not.toContain("<strong>");
  });

  it("draws a brief whose parts are all missing without those sections and without an error", () => {
    const out = html(parsed({ campaign: null, lastYear: null, notPushing: null, briefs: [emptyBrief(), emptyBrief({ title: "Hooks gone", hooks: ["", "  "], angle: "  ", offer: "" })] }));
    expect(count(out, /data-brief="\d"/g)).toBe(2);
    expect(text(out)).toContain("Brief 1 Bare brief");
    expect(text(out)).toContain("Brief 2 Hooks gone");
    expect(out).not.toContain("<dl");
    expect(out).not.toContain("<button");
    for (const label of ["Product", "Angle", "Hook lines", "Offer", "Proof", "Do not", "Measure", "Profit limit"]) expect(text(out), label).not.toContain(label);
  });
});

describe("figureSegments", () => {
  const figures = (s: string) => figureSegments(s).filter((p) => p.figure).map((p) => p.text);

  it("marks money, percentages, counts and decimals, and joins back to the text it was given", () => {
    const sample = "Hero Vitamin C Serum in the 50 ml: 184 available, 613.3 days of cover, margin rate 76.4%, average order $331.43, up from $1,204.50.";
    expect(figures(sample)).toEqual(["50", "184", "613.3", "76.4%", "$331.43", "$1,204.50"]);
    expect(figureSegments(sample).map((p) => p.text).join("")).toBe(sample);
    expect(figureSegments("")).toEqual([]);
    expect(figureSegments("no numbers here")).toEqual([{ text: "no numbers here", figure: false }]);
  });

  it("leaves numbers inside words and codes alone, and keeps a list comma out of the figure", () => {
    expect(figures("Q4 plan, the 50ml bottle and SKU-123 on page 2-3")).toEqual([]);
    expect(figures("Black Friday and Cyber Monday 2026, November 27 to 30.")).toEqual(["2026", "27", "30"]);
    expect(figureSegments("in 2026, then")).toEqual([
      { text: "in ", figure: false },
      { text: "2026", figure: true },
      { text: ", then", figure: false },
    ]);
  });
});

describe("splitOffer", () => {
  it("pulls the sentences about margin or profit out as the profit limit, and keeps the rest as the offer", () => {
    expect(splitOffer("Early access a day before the public sale. Taking 10% off would take the profit margin to 13.8%, the worst case.")).toEqual({
      text: "Early access a day before the public sale.",
      profitLimit: "Taking 10% off would take the profit margin to 13.8%, the worst case.",
    });
    expect(splitOffer("Margin stays at 61.0%. Free gift on a first order. PROFIT is protected.")).toEqual({
      text: "Free gift on a first order.",
      profitLimit: "Margin stays at 61.0%. PROFIT is protected.",
    });
  });

  it("has no profit limit when no sentence mentions margin or profit, and does not cut a sentence at a decimal or vs.", () => {
    expect(splitOffer("Free shipping on orders over $50.")).toEqual({ text: "Free shipping on orders over $50.", profitLimit: null });
    expect(splitOffer("  ")).toEqual({ text: "", profitLimit: null });
    expect(splitOffer("Taking 10% off vs. list keeps the margin at 13.8%.")).toEqual({ text: "", profitLimit: "Taking 10% off vs. list keeps the margin at 13.8%." });
  });
});

describe("CopyButton", () => {
  type ElementProps = { [key: string]: unknown; children?: ReactNode };
  function elements(node: ReactNode, found: ReactElement<ElementProps>[] = []): ReactElement<ElementProps>[] {
    if (Array.isArray(node)) {
      node.forEach((n) => elements(n, found));
    } else if (isValidElement<ElementProps>(node)) {
      found.push(node);
      elements(node.props.children, found);
    }
    return found;
  }
  const words = (node: ReactNode): string =>
    Array.isArray(node) ? node.map(words).join("") : typeof node === "string" ? node : isValidElement<ElementProps>(node) ? words(node.props.children) : "";

  const HOOK = "Don't miss the serum you loved";
  const LABEL = `Copy hook line: ${HOOK}`;
  // Draws the button again and reads it as a person would: the button's own words and the words in the live region.
  const draw = () => {
    hooks.cursor = 0;
    const tree = elements(CopyButton({ text: HOOK, label: LABEL }));
    const button = tree.find((e) => e.type === "button");
    const live = tree.find((e) => e.props["aria-live"] === "polite");
    if (!button || !live) throw new Error("the button or its live region is missing");
    return { button: button.props, shows: words(button.props.children), announced: words(live.props.children) };
  };
  const click = async () => {
    await (draw().button.onClick as () => Promise<void>)();
  };

  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("is a keyboard-reachable button named by its label, saying Copy, with a polite live region that starts empty", () => {
    const { button, shows, announced } = draw();
    expect(button["aria-label"]).toBe(LABEL);
    expect(button.type).toBe("button");
    expect(button.disabled).toBeUndefined();
    expect(button.tabIndex).toBeUndefined();
    expect(shows).toBe("Copy");
    expect(announced).toBe("");
  });

  it("copies exactly the text, says Copied for about 1.8 seconds, announces it, then goes back to Copy", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    await click();
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(HOOK);
    expect(draw().shows).toBe("Copied");
    expect(draw().announced).toBe("Copied to the clipboard");
    vi.advanceTimersByTime(1799);
    expect(draw().shows).toBe("Copied");
    vi.advanceTimersByTime(1);
    expect(draw().shows).toBe("Copy");
    expect(draw().announced).toBe("");
  });

  it("keeps saying Copied for a full 1.8 seconds after the latest click, not the first", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    await click();
    vi.advanceTimersByTime(1000);
    await click();
    vi.advanceTimersByTime(1000); // 2.0 s after the first click: its timer has fired and must not end the second Copied
    expect(draw().shows).toBe("Copied");
    vi.advanceTimersByTime(800);
    expect(draw().shows).toBe("Copy");
  });

  it("does nothing, and does not throw, when there is no clipboard or the clipboard refuses", async () => {
    vi.stubGlobal("navigator", {});
    await expect(click()).resolves.toBeUndefined();
    expect(draw().shows).toBe("Copy");
    const refuse = vi.fn().mockRejectedValue(new Error("denied"));
    vi.stubGlobal("navigator", { clipboard: { writeText: refuse } });
    await expect(click()).resolves.toBeUndefined();
    expect(refuse).toHaveBeenCalledWith(HOOK);
    expect(draw().shows).toBe("Copy");
  });
});
