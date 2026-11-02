import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ProvenanceEntry } from "@/lib/agent/run";
import type { TracedFigure } from "@/lib/agent/traced";
import { DRAWER_ID, ProofDrawerContext, ProofDrawerPanel, type FigureListTarget, type ProofDrawerApi } from "./proof-drawer";
import { SafeMarkdown } from "./safe-markdown";
import { FigureCard, InspectContext } from "./traced-figure";
import { listTarget, VerifiedBadge, type BadgeProps } from "./verified-badge";

const entry: ProvenanceEntry = { queryId: "q_0123456789ab", tool: "query_metric", input: { metrics: ["net_sales"], period: "last_month" }, range: { from: "2026-09-01", to: "2026-09-30" }, asOf: "2026-10-31T10:34:00.000Z", definitions: { net_sales: "Sales after discounts and refunds." } };
const figure = (text: string, over: Partial<TracedFigure> = {}): TracedFigure => ({ text, queryId: entry.queryId, source: "Sales metrics", range: entry.range, asOf: entry.asOf, count: 1, ...over });

const drawerApi = (over: Partial<ProofDrawerApi> = {}): ProofDrawerApi => ({ current: null, list: null, open: vi.fn(), openList: vi.fn(), back: vi.fn(), close: vi.fn(), ...over });
const withDrawer = (api: ProofDrawerApi | null, node: ReactNode) => renderToStaticMarkup(<ProofDrawerContext.Provider value={api}>{node}</ProofDrawerContext.Provider>);

const props = (over: Partial<BadgeProps> = {}): BadgeProps => ({ traced: 27, total: 27, figures: [figure("$12,340")], provenance: { [entry.queryId]: entry }, unmatched: [], ...over });

describe("VerifiedBadge", () => {
  it("says all figures were traced, as a button that opens the list", () => {
    const out = withDrawer(drawerApi(), <VerifiedBadge {...props()} />);
    expect(out).toMatch(/<button[^>]*type="button"[^>]*>/);
    expect(out).toContain("27 of 27 figures traced");
    expect(out).toContain('aria-expanded="false"');
    expect(out).not.toContain("not found");
    expect(out).not.toContain('role="status"');
    expect(out).toMatch(/<svg[^>]*aria-hidden="true"/); // the tick is decoration; the words carry the meaning
  });

  it("says how many were not found, in the warning style, and names them", () => {
    const out = withDrawer(drawerApi(), <VerifiedBadge {...props({ traced: 24, total: 27, unmatched: ["$999", "12%", "7"] })} />);
    expect(out).toContain("24 of 27 figures traced, 3 not found");
    expect(out).toContain('role="status"');
    expect(out).toContain("bg-warn-tint");
    expect(out).toContain("Couldn&#x27;t verify: $999, 12%, 7. Treat those numbers with care.");
    expect(out).toMatch(/<button[^>]*>24 of 27 figures traced, 3 not found<\/button>/);
  });

  it("uses the singular for one number not found", () => {
    const out = withDrawer(drawerApi(), <VerifiedBadge {...props({ traced: 1, total: 2, unmatched: ["$9"] })} />);
    expect(out).toContain("Treat that number with care.");
  });

  it("shows nothing for an answer with no figures", () => {
    expect(withDrawer(drawerApi(), <VerifiedBadge {...props({ traced: 0, total: 0, figures: [] })} />)).toBe("");
  });

  it("is plain text where there is no drawer to open", () => {
    const out = withDrawer(null, <VerifiedBadge {...props()} />);
    expect(out).toContain("27 of 27 figures traced");
    expect(out).not.toContain("<button");
  });

  it("shows itself as expanded only while its own list is open", () => {
    const p = props();
    const mine = withDrawer(drawerApi({ list: { ...listTarget(p, null) } }), <VerifiedBadge {...p} />);
    expect(mine).toContain('aria-expanded="true"');
    expect(mine).toContain(`aria-controls="${DRAWER_ID}"`);
    const other = withDrawer(drawerApi({ list: { ...listTarget(props({ figures: [figure("$1")] }), null) } }), <VerifiedBadge {...p} />);
    expect(other).toContain('aria-expanded="false"');
  });

  it("hands the drawer the answer's figures, counts and unmatched text, with the badge to return focus to", () => {
    const p = props({ traced: 2, total: 3, unmatched: ["$9"] });
    const badge = {} as HTMLElement;
    expect(listTarget(p, badge)).toEqual({ figures: p.figures, provenance: p.provenance, traced: 2, total: 3, unmatched: ["$9"], trigger: badge });
  });
});

describe("the list in the proof drawer", () => {
  const target = (over: Partial<FigureListTarget> = {}): FigureListTarget => ({
    figures: [figure("$12,340"), figure("18.4%", { queryId: "q_unknown00000", source: "Orders" }), figure("41", { count: 2 })],
    provenance: { [entry.queryId]: entry },
    traced: 4,
    total: 4,
    unmatched: [],
    ...over,
  });
  const panel = (api: Partial<ProofDrawerApi>) => withDrawer(drawerApi(api), <ProofDrawerPanel />);

  it("lists every traced figure with its source, dates and sync time", () => {
    const out = panel({ list: target() });
    expect(out).toContain('aria-label="Figures traced in this answer"');
    expect(out).toContain("4 of 4 figures traced");
    for (const text of ["$12,340", "18.4%", "41"]) expect(out).toContain(text);
    expect(out).toContain("Sales metrics, September 1 to 30, 2026");
    expect(out).toContain("Synced October 31, 10:34 UTC");
    expect(out).toContain("(2 times)");
  });

  it("offers See the query only for a figure whose query is known", () => {
    const out = panel({ list: target() });
    expect(out.match(/See the query/g)).toHaveLength(2); // $12,340 and 41; 18.4% points at a query this answer does not have
  });

  it("says how many traced figures are not listed when the server cut the list", () => {
    expect(panel({ list: target({ traced: 70, total: 70 }) })).toContain("And 66 more traced figures, not listed here.");
    expect(panel({ list: target() })).not.toContain("not listed here");
  });

  it("names the figures that were not found", () => {
    const out = panel({ list: target({ traced: 4, total: 6, unmatched: ["$999", "7%"] }) });
    expect(out).toContain("4 of 6 figures traced, 2 not found");
    expect(out).toContain("Not found in the store data");
    expect(out).toContain("$999, 7%");
  });

  it("shows a figure's query with a way back to the list only when it was opened from the list", () => {
    const current = { claim: "$12,340", entry, key: "k" };
    const fromList = panel({ current, list: target() });
    expect(fromList).toContain("All figures in this answer");
    expect(fromList).toContain('aria-label="Where this number came from"');
    expect(fromList).toContain("q_0123456789ab");
    const alone = panel({ current });
    expect(alone).not.toContain("All figures in this answer");
    expect(alone).toContain("Sales metrics");
  });

  it("renders nothing while closed", () => {
    expect(panel({})).toBe("");
  });
});

describe("a traced figure in the text: keyboard and screen reader basics", () => {
  const render = (opts: { inspect?: boolean; drawer?: ProofDrawerApi | null; figures?: TracedFigure[] } = {}) =>
    renderToStaticMarkup(
      <ProofDrawerContext.Provider value={opts.drawer === undefined ? drawerApi() : opts.drawer}>
        <InspectContext.Provider value={opts.inspect ?? false}>
          <SafeMarkdown text="Net sales were $12,340 and 41 orders." provenance={{ [entry.queryId]: entry }} traced={opts.figures ?? [figure("$12,340"), figure("41")]} />
        </InspectContext.Provider>
      </ProofDrawerContext.Provider>,
    );

  it("adds no tab stops while focus is outside the answer, and keeps the figures plain text to a screen reader", () => {
    const out = render();
    expect(out.match(/tabindex="-1"/g)).toHaveLength(2);
    expect(out).not.toContain('tabindex="0"');
    expect(out).not.toContain('role="button"');
    expect(out).not.toContain("aria-label");
  });

  it("draws a dotted underline, so the mark is not colour alone", () => {
    expect(render()).toMatch(/<span[^>]*data-traced[^>]*class="[^"]*\bunderline\b[^"]*\bdecoration-dotted\b/);
  });

  it("makes each figure a focusable button that names its source once focus is inside the answer", () => {
    const out = render({ inspect: true });
    expect(out.match(/tabindex="0"/g)).toHaveLength(2);
    expect(out.match(/role="button"/g)).toHaveLength(2);
    expect(out).toContain('aria-label="$12,340, from Sales metrics, September 1 to 30, 2026, synced October 31, 10:34 UTC. See the query."');
    expect(out).toContain('aria-expanded="false"');
  });

  it("is not a button when nothing can open the query, even with focus inside the answer", () => {
    const out = render({ inspect: true, drawer: null });
    expect(out).not.toContain('role="button"');
    expect(out).not.toContain("cursor-pointer");
    expect(out).toContain("data-traced");
  });

  it("is not a button when its query is not among this answer's", () => {
    const out = render({ inspect: true, figures: [figure("$12,340", { queryId: "q_unknown00000" })] });
    expect(out).not.toContain('role="button"');
  });

  it("does not show the card until it is asked for", () => {
    expect(render()).not.toContain('role="dialog"');
  });
});

describe("the card on a figure", () => {
  const card = (over: Partial<Parameters<typeof FigureCard>[0]> = {}) =>
    renderToStaticMarkup(<FigureCard id="c1" figure={figure("$12,340")} place={{ left: 24, top: 100 }} viewportWidth={1000} onOpen={() => undefined} {...over} />);

  it("says the figure, where it came from, its dates and when the data was synced", () => {
    const out = card();
    expect(out).toContain('role="dialog"');
    expect(out).toContain('aria-label="Where $12,340 came from"');
    expect(out).toContain("$12,340");
    expect(out).toContain("From Sales metrics, September 1 to 30, 2026");
    expect(out).toContain("Synced October 31, 10:34 UTC");
  });

  it("leaves out the dates and the sync time it was not given", () => {
    const out = card({ figure: figure("41", { range: undefined, asOf: undefined }) });
    expect(out).toContain("From Sales metrics");
    expect(out).not.toContain("Synced");
    expect(out).not.toContain("September");
  });

  it("has a See the query button for the mouse that is not a tab stop, and none when nothing can open the query", () => {
    expect(card()).toMatch(/<button[^>]*tabindex="-1"[^>]*>See the query<\/button>/);
    expect(card({ onOpen: undefined })).not.toContain("<button");
  });

  it("is placed where it was told and stays inside a narrow screen", () => {
    expect(card({ place: { left: 24, top: 100 } })).toMatch(/style="[^"]*position:fixed;left:24px;top:100px;width:288px/);
    expect(card({ place: { left: 8, bottom: 40 }, viewportWidth: 280 })).toMatch(/left:8px;bottom:40px;width:264px/);
  });
});
