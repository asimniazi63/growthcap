import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SEGMENT_RULES } from "@/lib/segments/definitions";
import type { MapPoint } from "@/lib/segments/map";
import { CustomerMap } from "./customer-map";
import { CustomerSelectionProvider } from "./customer-selection";
import { TopCustomers } from "./top-customers";

// The repo has no browser-like DOM for tests, so the chart is rendered to markup in its starting state, with the state a click or a key would
// reach passed in (the filter and the selection). What a click or a key does to that state is checked on the pieces it is made of:
// map-state.test.ts (the reducer, the legend click) and lib/segments/map.test.ts (the nearest dot, the arrow keys, the scales).
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const p = (over: Partial<MapPoint>): MapPoint => ({ id: "CUST_a", orders: 2, ltvCents: 15_000, daysSinceLast: 133, churnRisk: 0.724, segment: "at_risk", ...over });

const points: MapPoint[] = [
  p({ id: "CUST_champ1", segment: "champions", orders: 7, ltvCents: 99_900, daysSinceLast: 12, churnRisk: 0.04 }),
  p({ id: "CUST_champ2", segment: "champions", orders: 4, ltvCents: 40_000, daysSinceLast: 40, churnRisk: 0.1 }),
  p({ id: "CUST_risk1", segment: "at_risk", ltvCents: 12_345 }),
  p({ id: "CUST_due1", segment: "due_to_reorder", daysSinceLast: 75, ltvCents: 8_000, churnRisk: 0.2 }),
  p({ id: "CUST_one1", segment: "one_and_done", orders: 1, daysSinceLast: 200, ltvCents: 3_500, churnRisk: 0.5 }),
  p({ id: "CUST_act1", segment: "active", orders: 1, daysSinceLast: 20, ltvCents: 2_000, churnRisk: 0 }),
  p({ id: "CUST_act2", segment: "active", orders: 1, daysSinceLast: 25, ltvCents: 2_200, churnRisk: 0 }),
];

const html = (props: Partial<Parameters<typeof CustomerMap>[0]> = {}, selected: string | null = null) =>
  renderToStaticMarkup(
    <CustomerSelectionProvider initialId={selected}>
      <CustomerMap points={points} currency="USD" listed="champions" {...props} />
    </CustomerSelectionProvider>,
  );

// How many dots of each segment are drawn: each carries its segment's fill class.
const FILL = { champions: "fill-ahead/50", at_risk: "fill-behind/50", due_to_reorder: "fill-warn/50", one_and_done: "fill-ink/40", active: "fill-none stroke-ink-3/70" } as const;
const drawn = (out: string, segment: keyof typeof FILL) => out.split(`class="${segment === "active" ? FILL.active : FILL[segment]}`).length - 1;

describe("CustomerMap, all segments showing", () => {
  const out = html();

  it("draws one dot for every customer, in the colour and shape of its segment", () => {
    expect(drawn(out, "champions")).toBe(2);
    expect(drawn(out, "at_risk")).toBe(1);
    expect(drawn(out, "due_to_reorder")).toBe(1);
    expect(drawn(out, "one_and_done")).toBe(1);
    expect(drawn(out, "active")).toBe(2);
    const shapes = new Set([...out.matchAll(/<path d="([^"]+)" class="(?:fill-|stroke-)/g)].map((m) => m[1]!.replace(/[-\d.]+/g, "").replace(/\s+/g, "")));
    expect(shapes.size).toBeGreaterThanOrEqual(5); // circle, triangle, diamond, square and cross are all different outlines
  });

  it("has a legend of five buttons with the count of each segment, none pressed", () => {
    const chips = [...out.matchAll(/<button type="button" aria-pressed="(true|false)"[^>]*>(.*?)<\/button>/g)].map((m) => ({ pressed: m[1], text: m[2]!.replace(/<[^>]+>/g, "") }));
    expect(chips).toEqual([
      { pressed: "false", text: "Champions2" },
      { pressed: "false", text: "At risk1" },
      { pressed: "false", text: "Due to reorder1" },
      { pressed: "false", text: "One and done1" },
      { pressed: "false", text: "Active2" },
    ]);
    expect(out).toContain("Showing all 7 customers.");
  });

  it("is one tab stop, with no dot a tab stop of its own", () => {
    expect(out.match(/tabindex="0"/g)).toHaveLength(1);
    expect(out).toMatch(/<svg[^>]*role="group"[^>]*aria-label="Customer map: 7 customers[^"]*Champions 2, At risk 1, Due to reorder 1, One and done 1, Active 2\.[^"]*"/);
    expect(out).toMatch(/<svg[^>]*aria-describedby="/);
  });

  it("says in text, for assistive technology, how to use it and where the full list is", () => {
    expect(out).toContain("Use the arrow keys to move between customers");
    expect(out).toContain("The Top customers table below lists the highest value customers of each segment as text");
    expect(out).toMatch(/aria-live="polite"/);
  });

  it("labels the axes in words and prints round dollar ticks", () => {
    expect(out).toContain("Days since last order");
    expect(out).toContain("Ordered more recently");
    expect(out).toContain("Ordered longer ago");
    expect(out).toContain("Lifetime value");
    expect(out).toMatch(/>\$0</);
    expect(out).toMatch(/>\$1,000</);
  });

  it("draws the segment rule lines from the rules and names them in the caption, for the days the chart reaches", () => {
    const { oneAndDone, champions, atRisk } = SEGMENT_RULES;
    const lines = (o: string) => o.match(/<line [^>]*class="stroke-line-strong"/g)?.length ?? 0;
    expect(out).toContain(`${oneAndDone.minDaysSinceLast} days (one and done starts)`);
    expect(out).toContain(`${champions.maxDaysSinceLast} days (champions end)`);
    expect(out).not.toContain(`${atRisk.maxDaysSinceLast} days (at risk ends)`); // the oldest of these customers is 200 days: that line is off the chart
    expect(lines(out)).toBe(2);
    const long = html({ points: [...points, p({ id: "CUST_old", segment: "at_risk", daysSinceLast: atRisk.maxDaysSinceLast + 100 })] });
    expect(long).toContain(`${atRisk.maxDaysSinceLast} days (at risk ends)`);
    expect(lines(long)).toBe(3);
  });

  it("explains the scale and says it predicts nothing", () => {
    expect(out).toContain("stretched near zero");
    expect(out).toContain("compressed toward the top");
    expect(out).toContain("Due to reorder has no line");
  });

  it("uses only theme tokens for colour", () => {
    expect(out).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
  });

  it("shows no hover card and no selection until something is chosen", () => {
    expect(out).not.toContain("bg-inverse");
    expect(out).toContain("Hover a dot, or tab to the chart");
    expect(out).not.toContain("Clear");
  });
});

describe("CustomerMap, getting from the chart to the table", () => {
  it("links to the Top customers table once the table is on the chosen segment", () => {
    const out = html({ initialSolo: "champions", listed: "champions" });
    expect(out).toMatch(/<a href="#top-customers"[^>]*>See the top customers of Champions in the table<\/a>/);
  });

  it("does not link while the table is still on another segment", () => {
    expect(html({ initialSolo: "at_risk", listed: "champions" })).not.toContain("#top-customers");
  });

  it("does not link for Active, which has no table, or when no segment is chosen", () => {
    expect(html({ initialSolo: "active", listed: "champions" })).not.toContain("#top-customers");
    expect(html({ listed: "champions" })).not.toContain("#top-customers");
  });
});

describe("CustomerMap with one segment chosen", () => {
  const out = html({ initialSolo: "at_risk" });

  it("draws only that segment's dots and presses its chip", () => {
    expect(drawn(out, "at_risk")).toBe(1);
    expect(drawn(out, "champions")).toBe(0);
    expect(drawn(out, "active")).toBe(0);
    expect(out).toMatch(/aria-pressed="true"[^>]*>(?:(?!<\/button>).)*At risk/);
    expect(out.match(/aria-pressed="true"/g)).toHaveLength(1);
  });

  it("says how many of the customers are showing, and offers the way back", () => {
    expect(out).toContain("Showing 1 of 7 customers, only At risk.");
    expect(out).toContain("Show every segment");
  });

  it("keeps the counts of the other segments in the legend, so they can be chosen next", () => {
    expect(out).toContain(">2</span>"); // champions and active still say 2
  });

  it("keeps every dot where it was: the axes come from all customers, not the ones showing", () => {
    const place = (o: string) => /<path d="([^"]+)" class="fill-behind\/50/.exec(o)![1];
    expect(place(out)).toBe(place(html()));
  });
});

describe("CustomerMap with a customer selected", () => {
  it("shows a detail strip with the customer's figures and a ring on the dot", () => {
    const out = html({}, "CUST_champ1");
    expect(out).toContain("CUST_champ1");
    expect(out).toContain("Champions</span>");
    expect(out).toContain(">7</dd>"); // orders
    expect(out).toContain("$999.00");
    expect(out).toContain("12 days");
    expect(out).toContain(">4%</dd>"); // churn risk as a percentage
    expect(out).toContain("Clear");
    expect(out).toMatch(/<circle [^>]*class="stroke-ink"/); // the highlight ring
  });

  it("offers to go to the row when the customer is in the table for the listed segment", () => {
    expect(html({ listed: "champions" }, "CUST_champ1")).toContain("Show in table below");
  });

  it("does not, when the table is on another segment, but still shows the strip", () => {
    const out = html({ listed: "at_risk" }, "CUST_champ1");
    expect(out).not.toContain("Show in table below");
    expect(out).toContain("CUST_champ1");
  });

  it("does not, when the customer is outside the table's top 15", () => {
    const many: MapPoint[] = Array.from({ length: 20 }, (_, i) => p({ id: `CUST_m${String(i).padStart(2, "0")}`, segment: "champions", ltvCents: 1_000 + i * 100 }));
    const out = html({ points: many, listed: "champions" }, "CUST_m00"); // the lowest value of 20
    expect(out).toContain("CUST_m00");
    expect(out).not.toContain("Show in table below");
    expect(html({ points: many, listed: "champions" }, "CUST_m19")).toContain("Show in table below");
  });

  it("ignores an id that is not on the map", () => {
    const out = html({}, "CUST_gone");
    expect(out).not.toContain("CUST_gone");
    expect(out).toContain("Hover a dot");
  });

  it("writes a customer id as text, never as markup", () => {
    const hostile = [p({ id: '"><img src=x onerror=alert(1)>', segment: "champions" })];
    const out = html({ points: hostile }, hostile[0]!.id);
    expect(out).not.toContain("<img");
    expect(out).toContain("&lt;img");
  });
});

describe("CustomerMap, the table row it marks", () => {
  it("marks the selected customer's row in the table and no other", () => {
    const customers = [
      { customerId: "CUST_champ1", orders: 7, firstOrderDate: "2026-01-01", lastOrderDate: "2026-10-01", daysSinceLast: 12, ltvCents: 99_900, medianGapDays: 30, r: 5, f: 5, m: 5, churnRisk: 0.04, segment: "champions" as const },
      { customerId: "CUST_champ2", orders: 4, firstOrderDate: "2026-01-01", lastOrderDate: "2026-09-01", daysSinceLast: 40, ltvCents: 40_000, medianGapDays: 30, r: 4, f: 4, m: 4, churnRisk: 0.1, segment: "champions" as const },
    ];
    const withSelection = (id: string | null) =>
      renderToStaticMarkup(
        <CustomerSelectionProvider initialId={id}>
          <TopCustomers customers={customers} segment="champions" currency="USD" />
        </CustomerSelectionProvider>,
      );
    const marked = withSelection("CUST_champ2");
    expect(marked.match(/aria-current="true"/g)).toHaveLength(1);
    expect(marked).toMatch(/<tr id="customer-row-CUST_champ2" aria-current="true"/);
    expect(marked).toMatch(/<tr id="customer-row-CUST_champ1"(?! aria-current)/);
    expect(withSelection(null)).not.toContain("aria-current");
    expect(renderToStaticMarkup(<TopCustomers customers={customers} segment="champions" currency="USD" />)).not.toContain("aria-current"); // outside a provider
  });
});

describe("CustomerMap, the sizes of data", () => {
  it("says so when there are no customers", () => {
    const out = html({ points: [] });
    expect(out).toContain("No customers to plot yet.");
    expect(out).not.toContain("<svg");
  });

  it("draws a lone customer", () => {
    const out = html({ points: [p({ id: "CUST_only", segment: "champions", ltvCents: 50_000, daysSinceLast: 0 })] });
    expect(drawn(out, "champions")).toBe(1);
    expect(out).toContain("1 customer by days");
    expect(out).toContain("Showing all 1 customer.");
  });

  it("switches off the chips of segments nobody is in when everyone is in one", () => {
    const out = html({ points: points.filter((x) => x.segment === "champions") });
    expect(out.match(/<button type="button" aria-pressed="false" disabled=""/g)).toHaveLength(4);
    expect(drawn(out, "champions")).toBe(2);
  });

  it("draws the whole brand, about 700 customers with one very large outlier, in one go", () => {
    const many: MapPoint[] = Array.from({ length: 700 }, (_, i) =>
      p({ id: `CUST_${i}`, segment: (["champions", "at_risk", "due_to_reorder", "one_and_done", "active"] as const)[i % 5]!, ltvCents: i === 0 ? 676_000 : 7_000 + (i % 40) * 600, daysSinceLast: (i * 7) % 800 }),
    );
    const out = html({ points: many });
    const dots = [FILL.champions, FILL.at_risk, FILL.due_to_reorder, FILL.one_and_done].reduce((n, c) => n + (out.split(`class="${c}`).length - 1), 0) + drawn(out, "active");
    expect(dots).toBe(700);
    // the outlier does not flatten the rest: the 699 typical customers ($70 to $400) still use more than a fifth of the 318 pixel plot, where a straight axis gives them about 4%
    const ys = [...out.matchAll(/<path d="M[-\d.]+ ([-\d.]+)[^"]*" class="(?:fill-[a-z]+\/\d\d|fill-none stroke-ink-3\/70)/g)].map((m) => Number(m[1])).sort((a, b) => a - b);
    expect(ys).toHaveLength(700);
    expect(ys[0]).toBeLessThan(80); // the outlier is near the top
    const typical = ys.slice(1);
    expect(typical.at(-1)! - typical[0]!).toBeGreaterThan(0.2 * 318);
  });
});
