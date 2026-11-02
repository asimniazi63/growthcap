import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";
import type { ProvenanceEntry } from "@/lib/agent/run";
import type { TracedFigure } from "@/lib/agent/traced";
import { drawerReducer, returnTarget, type DrawerView, type FigureListTarget, type ProofTarget } from "./proof-drawer";
import { CARD_WIDTH, figureKey, placeCard } from "./traced-figure";
import { badgeText, figureLabel, figureSentence, figureSource } from "./traced-format";
import { rehypeTraced, splitTraced, tracedMatcher, type TracedPart } from "./traced-text";
import { finalVerification, tracedSummary, type Verification } from "./verification";

const figure = (text: string, over: Partial<TracedFigure> = {}): TracedFigure => ({ text, queryId: "q_0123456789ab", source: "Sales metrics", range: { from: "2026-09-01", to: "2026-09-30" }, asOf: "2026-10-31T10:34:00.000Z", count: 1, ...over });
const NOW = new Date("2026-11-02T12:00:00Z");

describe("splitTraced", () => {
  const split = (value: string, figures: TracedFigure[]): TracedPart[] => splitTraced(value, tracedMatcher(figures)!, new Map());

  it("returns the text untouched when no figure is in it", () => {
    expect(split("No numbers here, or 7.", [figure("$12")])).toEqual(["No numbers here, or 7."]);
  });

  it("cuts the text around each figure, keeping every character", () => {
    const parts = split("Sales were $12,340 and 18.4% up.", [figure("$12,340"), figure("18.4%")]);
    expect(parts).toEqual(["Sales were ", { text: "$12,340", figure: 0 }, " and ", { text: "18.4%", figure: 1 }, " up."]);
    expect(parts.map((p) => (typeof p === "string" ? p : p.text)).join("")).toBe("Sales were $12,340 and 18.4% up.");
  });

  it("finds a figure that starts or ends the text", () => {
    expect(split("41", [figure("41")])).toEqual([{ text: "41", figure: 0 }]);
  });

  it("matches the longest figure first", () => {
    expect(split("$1,200.50", [figure("$1,200"), figure("$1,200.50")])).toEqual([{ text: "$1,200.50", figure: 1 }]);
  });

  it("escapes a figure's text, so no figure can act as a pattern", () => {
    expect(split("a (1.5) b 1x5", [figure("1.5")])).toEqual(["a (", { text: "1.5", figure: 0 }, ") b 1x5"]);
    expect(splitTraced("x", tracedMatcher([figure("1+")])!, new Map())).toEqual(["x"]);
  });

  it("hands out a figure no more often than it was traced, across nodes", () => {
    const matcher = tracedMatcher([figure("41", { count: 2 })])!;
    const used = new Map<string, number>();
    expect(splitTraced("41 and 41", matcher, used)).toEqual([{ text: "41", figure: 0 }, " and ", { text: "41", figure: 0 }]);
    expect(splitTraced("and 41 more", matcher, used)).toEqual(["and 41 more"]);
  });

  it("has nothing to match for no figures", () => {
    expect(tracedMatcher([])).toBeNull();
    expect(tracedMatcher([figure("")])).toBeNull();
  });
});

describe("rehypeTraced", () => {
  type Node = { type: string; value?: string; tagName?: string; properties?: Record<string, unknown>; children?: Node[] };
  const text = (value: string): Node => ({ type: "text", value });
  const el = (tagName: string, ...children: Node[]): Node => ({ type: "element", tagName, properties: {}, children });
  const run = (tree: Node, figures: TracedFigure[]) => {
    rehypeTraced({ figures })(tree);
    return tree;
  };
  const kinds = (n: Node): string[] => (n.children ?? []).map((c) => (c.type === "text" ? c.value! : `<${c.tagName}>${(c.children ?? []).map((k) => k.value).join("")}`));

  it("replaces a traced figure in a paragraph with a marked element and keeps the rest as text", () => {
    const p = el("p", text("Net sales: $12"));
    run({ type: "root", children: [p] }, [figure("$12")]);
    expect(kinds(p)).toEqual(["Net sales: ", "<traced-figure>$12"]);
    expect(p.children![1]!.properties).toEqual({ dataFigure: "0" });
  });

  it("walks into bold text and table cells, but not into code, pre or links", () => {
    const strong = el("strong", text("$12"));
    const td = el("td", text("$12"));
    const code = el("code", text("$12"));
    const pre = el("pre", el("code", text("$12")));
    const a = el("a", text("$12"));
    run({ type: "root", children: [el("p", strong, code, a), el("table", el("tbody", el("tr", td))), pre] }, [figure("$12", { count: 9 })]);
    expect(kinds(strong)).toEqual(["<traced-figure>$12"]);
    expect(kinds(td)).toEqual(["<traced-figure>$12"]);
    expect(kinds(code)).toEqual(["$12"]);
    expect(kinds(pre.children![0]!)).toEqual(["$12"]);
    expect(kinds(a)).toEqual(["$12"]);
  });

  it("uses a fresh budget for each answer", () => {
    const plugin = rehypeTraced({ figures: [figure("$12")] });
    const make = () => ({ type: "root", children: [el("p", text("$12 and $12"))] }) as Node;
    const a = make();
    const b = make();
    plugin(a);
    plugin(b);
    expect(kinds(a.children![0]!)).toEqual(["<traced-figure>$12", " and $12"]);
    expect(kinds(b.children![0]!)).toEqual(["<traced-figure>$12", " and $12"]);
  });

  it("does nothing without figures", () => {
    const p = el("p", text("$12"));
    run({ type: "root", children: [p] }, []);
    expect(kinds(p)).toEqual(["$12"]);
  });
});

describe("the words around traced figures", () => {
  it("says how many figures were traced, and how many were not found", () => {
    expect(badgeText(27, 27)).toBe("27 of 27 figures traced");
    expect(badgeText(24, 27)).toBe("24 of 27 figures traced, 3 not found");
    expect(badgeText(1, 1)).toBe("1 of 1 figure traced");
    expect(badgeText(0, 2)).toBe("0 of 2 figures traced, 2 not found");
  });

  it("writes the source line as figure, source, dates and sync time", () => {
    expect(figureSentence(figure("$12,340"), NOW)).toBe("$12,340 — from Sales metrics, September 1 to 30, 2026, synced October 31, 10:34 UTC");
    expect(figureSource(figure("18.4%", { range: undefined, asOf: undefined }), NOW)).toEqual({ source: "Sales metrics", period: null, synced: null });
    expect(figureSentence(figure("41", { range: undefined, asOf: undefined }), NOW)).toBe("41 — from Sales metrics");
  });

  it("gives a focusable figure a name that starts with what is on screen and says what Enter does", () => {
    const label = figureLabel(figure("$12,340"), NOW);
    expect(label.startsWith("$12,340")).toBe(true);
    expect(label).toContain("Sales metrics");
    expect(label.endsWith("See the query.")).toBe(true);
  });
});

describe("placeCard", () => {
  const viewport = { width: 1000, height: 800 };
  it("puts the card under the figure, lined up with its left edge", () => {
    expect(placeCard({ left: 200, top: 100, bottom: 124 }, viewport)).toEqual({ left: 200, top: 124 });
  });
  it("puts it above when there is no room below and there is above", () => {
    expect(placeCard({ left: 200, top: 700, bottom: 724 }, viewport)).toEqual({ left: 200, bottom: 100 });
  });
  it("keeps it under the figure when there is no room either way", () => {
    expect(placeCard({ left: 200, top: 40, bottom: 64 }, { width: 1000, height: 150 })).toEqual({ left: 200, top: 64 });
  });
  it("keeps it on the screen at the right edge and the left edge", () => {
    expect(placeCard({ left: 950, top: 100, bottom: 124 }, viewport).left).toBe(1000 - CARD_WIDTH - 8);
    expect(placeCard({ left: -20, top: 100, bottom: 124 }, viewport).left).toBe(8);
  });
  it("fits a 360px screen with a gutter on both sides", () => {
    const place = placeCard({ left: 300, top: 100, bottom: 124 }, { width: 360, height: 640 });
    expect(place.left + CARD_WIDTH).toBeLessThanOrEqual(360 - 8);
    expect(place.left).toBeGreaterThanOrEqual(8);
    // On a screen narrower than the card, the card shrinks to the gutters instead.
    expect(placeCard({ left: 100, top: 100, bottom: 124 }, { width: 280, height: 640 }).left).toBe(8);
  });
});

describe("figureKey", () => {
  it("opens the query on Enter or Space", () => {
    expect(figureKey("Enter", false)).toBe("open");
    expect(figureKey(" ", true)).toBe("open");
  });
  it("closes the card on Escape only while it is open, so the drawer's own Escape still works", () => {
    expect(figureKey("Escape", true)).toBe("close");
    expect(figureKey("Escape", false)).toBeNull();
  });
  it("ignores other keys, so Tab moves on", () => {
    expect(figureKey("Tab", true)).toBeNull();
    expect(figureKey("a", false)).toBeNull();
  });
});

describe("the proof drawer's views", () => {
  const entry: ProvenanceEntry = { queryId: "q_0123456789ab", tool: "query_metric", input: {}, range: { from: "2026-09-01", to: "2026-09-30" }, asOf: "2026-10-31T10:34:00.000Z", definitions: {} };
  const badge = {} as HTMLElement;
  const chip = {} as HTMLElement;
  const query = (trigger: HTMLElement): ProofTarget => ({ claim: "$12,340", entry, key: "k", trigger });
  const list: FigureListTarget = { figures: [figure("$12,340")], provenance: { [entry.queryId]: entry }, traced: 1, total: 1, unmatched: [], trigger: badge };
  const closed: DrawerView = { current: null, list: null };

  it("opens the list from the badge", () => {
    expect(drawerReducer(closed, { type: "openList", target: list })).toEqual({ current: null, list });
  });
  it("opens a figure's query on its own when it is clicked in the text, dropping any list", () => {
    expect(drawerReducer({ current: null, list }, { type: "open", target: query(chip) })).toEqual({ current: query(chip), list: null });
  });
  it("keeps the list when a query is opened from it, and goes back to it", () => {
    const opened = drawerReducer({ current: null, list }, { type: "open", target: query(chip), fromList: true });
    expect(opened).toEqual({ current: query(chip), list });
    expect(drawerReducer(opened, { type: "back" })).toEqual({ current: null, list });
  });
  it("closes everything, and hands focus back to the badge when the list was open, else to the figure", () => {
    expect(drawerReducer({ current: query(chip), list }, { type: "close" })).toEqual(closed);
    expect(returnTarget({ current: query(chip), list })).toBe(badge);
    expect(returnTarget({ current: query(chip), list: null })).toBe(chip);
    expect(returnTarget(closed)).toBeUndefined();
  });
});

describe("what the chat reads from a verification", () => {
  const parts = (...types: string[]) => types.map((type) => ({ type, ...(type === "text" ? { text: "x" } : { data: {} }) })) as unknown as UIMessage["parts"];

  it("counts from the checker's own lists, and uses the server's figure list when it has one", () => {
    const v: Verification = { attempt: 1, ok: false, matched: [{ span: [0, 3], value: 1, queryId: "q_a" }, { span: [4, 7], value: 2, queryId: "q_a" }], unmatched: [{ text: "$9", value: 9 }], figures: [figure("1")] };
    expect(tracedSummary(v, "1 2 $9", {})).toEqual({ figures: [figure("1")], traced: 2, total: 3, unmatched: ["$9"] });
  });

  it("rebuilds the figure list from the matched spans for a conversation saved before figures existed", () => {
    const entry: ProvenanceEntry = { queryId: "q_0123456789ab", tool: "get_orders", input: {}, range: { from: "2026-09-01", to: "2026-09-30" }, asOf: "2026-10-31T10:34:00.000Z", definitions: {} };
    const answer = "There were 41 orders.";
    const v: Verification = { attempt: 1, ok: true, matched: [{ span: [11, 13], value: 41, queryId: entry.queryId }], unmatched: [] };
    expect(tracedSummary(v, answer, { [entry.queryId]: entry }).figures).toEqual([{ text: "41", queryId: entry.queryId, source: "Orders", range: entry.range, asOf: entry.asOf, count: 1 }]);
  });

  it("takes a verification only when it came after the final text", () => {
    const only = parts("text", "data-verification");
    expect(finalVerification(only, 0)).toBeDefined();
    // A repaired answer: the draft, its verification, the repair notice, then the corrected text still streaming.
    expect(finalVerification(parts("text", "data-verification", "data-repair", "text"), 3)).toBeUndefined();
    expect(finalVerification(parts("text", "data-verification", "data-repair", "text", "data-verification"), 3)).toBeDefined();
    expect(finalVerification(parts("tool-query_metric"), -1)).toBeUndefined();
    expect(finalVerification(parts("text"), 0)).toBeUndefined();
  });
});
