import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { LaunchCard, ViewData } from "@/lib/views/types";
import { ViewRenderer } from "./view-renderer";

const basis = { queryIds: ["q_aaaaaaaaaaaa"], range: { from: "2025-10-01", to: "2026-10-31" }, asOf: "2026-10-31T10:34:26.000Z" };
type Curves = Extract<ViewData, { component: "launch_curves" }>;
const week = (n: number, daysObserved: number, units: number, cumulativeUnits: number) => ({ week: n, daysObserved, units, cumulativeUnits });
const card = (title: string, over: Partial<LaunchCard> = {}): LaunchCard => ({ title, launchDate: "2026-05-04", daysObserved: 21, fullyObserved: true, totalUnits: 9, weeks: [week(1, 7, 5, 5), week(2, 7, 2, 7), week(3, 7, 2, 9)], ...over });
const data = (launches: LaunchCard[], over: Partial<Curves> = {}): Curves => ({
  component: "launch_curves",
  benchmark: [{ week: 1, medianCumulativeUnits: 4, launches: 6 }, { week: 2, medianCumulativeUnits: 6, launches: 6 }, { week: 3, medianCumulativeUnits: 6.5, launches: 5 }],
  launches,
  ...basis,
  ...over,
});
const html = (d: ViewData, title = "How the new products sold") => renderToStaticMarkup(<ViewRenderer data={d} title={title} currency="USD" />);

describe("launch_curves", () => {
  it("draws a card for each launch with its title, first sale and total units, a curve, and the median behind it", () => {
    const out = html(data([card("Cedar Candle"), card("Elm Essence", { launchDate: "2026-04-01", totalUnits: 1, weeks: [week(1, 7, 1, 1), week(2, 7, 0, 1), week(3, 7, 0, 1)] })]));
    expect(out).toContain("Cedar Candle");
    expect(out).toContain("First sale May 4");
    expect(out).toContain("First sale Apr 1");
    expect(out).toContain(">9<"); // the total
    expect(out).toContain("units in 21 days");
    expect(out).toContain("1</span><span class=\"muted\"> unit in 21 days");
    expect(out.match(/<svg role="img"/g)?.length).toBe(2); // one curve per card
    expect(out).toContain("<polygon"); // the median
    expect(out).toMatch(/aria-label="Cedar Candle: 9 units in 21 days since its first sale on May 4\. After week 3 the median launch had 6\.5"/);
    expect(out).toContain("The median launch in this store");
    expect(out).toContain("The median rests on 6 launches in week 1 and 5 by week 3");
  });

  it("draws a week that is not over yet dashed, and ending early with a hollow mark", () => {
    const partial = card("Hazel Hand Cream", { daysObserved: 10, fullyObserved: false, totalUnits: 7, weeks: [week(1, 7, 5, 5), week(2, 3, 2, 7)] });
    const out = html(data([partial]));
    expect(out).toContain('stroke-dasharray="4 3"');
    expect(out).toContain("bg-surface"); // the hollow end mark
    expect(out).toContain("units in 10 days so far");
    expect(out).toContain("the last week not over yet");
    const whole = html(data([card("Whole")]));
    expect(whole).not.toContain("units in 21 days so far");
    // the legend explains the dash, so it is in the markup of the legend and in the curve
    expect(whole.match(/stroke-dasharray="4 3"/g)?.length).toBe(1); // the legend's own sample
  });

  it("draws a launch with only a partial first week as a dashed line from the start", () => {
    const out = html(data([card("Brand new", { daysObserved: 3, fullyObserved: false, totalUnits: 2, weeks: [week(1, 3, 2, 2)] })]));
    expect(out).toContain("units in 3 days so far");
    expect(out.match(/stroke-dasharray="4 3"/g)?.length).toBe(2); // the curve and the legend
  });

  it("gives the cards in a row one scale, and says what it is", () => {
    const four = [card("A", { totalUnits: 3, weeks: [week(1, 7, 3, 3)] }), card("B", { totalUnits: 40, weeks: [week(1, 7, 40, 40)] }), card("C"), card("D")];
    const out = html(data(four, { benchmark: [{ week: 1, medianCumulativeUnits: 4, launches: 6 }] }));
    expect(out.match(/Same scale across this row: 0 to 40 units/g)?.length).toBe(1);
    const five = html(data([...four, card("E")], { benchmark: [{ week: 1, medianCumulativeUnits: 4, launches: 6 }] }));
    expect(five).toContain("Same scale across this row: 0 to 40 units");
    expect(five).toContain("Same scale across this row: 0 to 9 units"); // the fifth card is a row of its own
  });

  it("says so when there are no launches, with the caveat, and draws no chart", () => {
    const out = html(data([], { benchmark: [], caveats: ["No product launched in the data: a launch is a product whose first sale comes at least 14 days after the store's first order."] }));
    expect(out).toContain("No launches to draw");
    expect(out).toContain("No product launched in the data");
    expect(out).not.toContain("<svg role=\"img\"");
    expect(out).not.toContain("Show the numbers");
  });

  it("has a text alternative: Show the numbers, with a column for each week and the median row", () => {
    const out = html(data([card("Cedar Candle")]));
    expect(out).toContain("Show the numbers");
    expect(out).toContain("Week 3");
    expect(out).toContain("Median launch");
    expect(out).toContain("Launches behind the median");
    expect(out).toContain("6.5");
  });

  it("notes a partial week in the table, and says when it shows part of the launches and what the caveats say", () => {
    const out = html(data([card("Hazel", { daysObserved: 10, fullyObserved: false, totalUnits: 7, weeks: [week(1, 7, 5, 5), week(2, 3, 2, 7)] })], { truncated: { shown: 12, total: 30 }, caveats: ["14 products were left out."] }));
    expect(out).toContain("7 (3 of 7 days)");
    expect(out).toContain("Showing 12 of 30 launches, newest first.");
    expect(out).toContain("14 products were left out.");
  });

  it("renders a product title as text, never markup, and as a tooltip only through an escaped attribute", () => {
    const out = html(data([card('<img src=x onerror=alert(1)> "quoted"')]));
    expect(out).not.toContain("<img");
    expect(out).toContain("&lt;img");
  });

  it("copes with no benchmark, and with all zeros", () => {
    const out = html(data([card("Flat", { totalUnits: 0, weeks: [week(1, 7, 0, 0)] })], { benchmark: [] }));
    expect(out).not.toContain("NaN");
    expect(out).not.toContain("The median launch in this store");
  });

  it("uses only design tokens for colour", () => {
    expect(html(data([card("A")]))).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
  });
});
