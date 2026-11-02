import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { BundlePair, ViewData } from "@/lib/views/types";
import { LIFT_CAP, LIFT_FLOOR, liftFill, liftStrength } from "./bundle-shading";
import { BundleMatrix } from "./bundle-matrix";
import { ViewRenderer } from "./view-renderer";

const basis = { queryIds: ["q_aaaaaaaaaaaa"], range: { from: "2025-09-01", to: "2026-10-31" }, asOf: "2026-10-31T10:34:26.000Z" };
type Matrix = Extract<ViewData, { component: "bundle_matrix" }>;
const pair = (a: number, b: number, ordersTogether: number, lift: number, over: Partial<BundlePair> = {}): BundlePair => ({ a, b, ordersTogether, confidenceAtoB: 0.25, confidenceBtoA: 0.4, lift, thin: ordersTogether < 8, ...over });
const data: Matrix = {
  component: "bundle_matrix",
  ordersInRange: 1024,
  products: [
    { title: "Hero Vitamin C Serum", orders: 354, sharedOrders: 82 },
    { title: "Barrier Cream", orders: 284, sharedOrders: 77 },
    { title: "Lip Tint", orders: 152, sharedOrders: 20 },
    { title: "Eye Cream", orders: 40, sharedOrders: 6 },
  ],
  pairs: [pair(0, 1, 70, 1.35), pair(0, 2, 12, 0.72, { confidenceAtoB: 0.034, confidenceBtoA: 0.079 }), pair(1, 2, 8, 1.02), pair(1, 3, 6, 1.8)],
  ...basis,
};
const html = (d: ViewData) => renderToStaticMarkup(<ViewRenderer data={d} title="What gets bought together" currency="USD" />);

describe("liftFill", () => {
  const mix = (css: string) => Number(/ ([\d.]+)%,/.exec(css)?.[1] ?? NaN);
  it("is neutral at a lift of 1.0, brand above it and ink below it", () => {
    expect(liftFill(1)).toBe("var(--color-surface)");
    expect(liftFill(1.5)).toContain("var(--color-brand)");
    expect(liftFill(0.7)).toContain("var(--color-ink)");
  });
  it("gets stronger the further from 1.0, and stops at the cap and the floor so a big lift is not stretched", () => {
    expect(mix(liftFill(1.2))).toBeLessThan(mix(liftFill(1.6)));
    expect(mix(liftFill(0.9))).toBeLessThan(mix(liftFill(0.6)));
    expect(liftFill(LIFT_CAP)).toBe(liftFill(5));
    expect(liftFill(LIFT_FLOOR)).toBe(liftFill(0));
    expect(liftStrength(LIFT_CAP)).toBe(1);
    expect(liftStrength(1)).toBe(0);
  });
  it("keeps the strongest colour well short of solid, so the text stays readable and a weak link never looks strong", () => {
    expect(mix(liftFill(LIFT_CAP))).toBeLessThanOrEqual(45);
    expect(mix(liftFill(LIFT_FLOOR))).toBeLessThanOrEqual(20);
    // the seeded data's lifts (0.7 to 1.9) stay below full strength at the top and mild at the bottom
    expect(mix(liftFill(1.9))).toBeLessThan(mix(liftFill(LIFT_CAP)));
  });
});

describe("bundle_matrix", () => {
  it("prints the orders together in each cell, mirrored across the diagonal, with the products numbered on both axes", () => {
    const out = html(data);
    expect(out).toContain(">70<");
    expect(out.match(/>70</g)?.length).toBe(3); // the pair on both sides of the diagonal, and its row in the table
    expect(out).toContain("Hero Vitamin C Serum");
    expect(out).toContain("354 orders");
    expect(out).toContain('role="group"');
    expect(out).toMatch(/aria-label="Products bought together: 4 products and 4 pairs, lifts from 0\.72 to 1\.80\./);
  });

  it("shades by lift with the colour tokens, and hatches a pair of fewer than eight orders", () => {
    const out = html(data);
    expect(out).toContain("color-mix(in oklab, var(--color-brand)");
    expect(out).toContain("color-mix(in oklab, var(--color-ink)");
    // two thin pairs (6 and the 8 is not thin) -> one thin pair, drawn on both sides of the diagonal, plus the legend's sample
    expect(out.match(/repeating-linear-gradient/g)?.length).toBe(2 * 1 + 1);
    const cell = (n: number) => out.match(new RegExp(`<button[^>]*>${n}</button>`))![0];
    expect(cell(6)).toContain("repeating-linear-gradient");
    expect(cell(8)).not.toContain("repeating-linear-gradient");
    expect(cell(70)).not.toContain("repeating-linear-gradient");
    expect(cell(6)).toContain("a thin signal");
  });

  it("explains the shading and says the lifts are weak instead of stretching the scale", () => {
    const out = html(data);
    expect(out).toContain("0.5 or less, 1.0 (as often as chance), 2.0 or more");
    expect(out).toContain("Hatched: under 8 orders together, a thin signal");
    expect(out).toContain("Among the pairs drawn, lifts run from 0.72 to 1.80");
    expect(out).toContain("the shading stops getting stronger at 2.0, so a weak link is never made to look strong");
    expect(out).toContain("1 of 4 pairs are thin");
    expect(out).toContain("not proof that a bundle would sell");
  });

  it("gives every pair one keyboard stop and one screen reader label with both titles and every figure", () => {
    const out = html(data);
    expect(out.match(/<button/g)?.length).toBe(4); // one per pair; the mirrored half is aria-hidden and not focusable
    expect(out.match(/tabindex="0"/g)?.length).toBe(1); // a roving stop
    expect(out).toContain('aria-label="Hero Vitamin C Serum and Barrier Cream: 70 orders together. 25.0% of orders with Hero Vitamin C Serum also had Barrier Cream. 40.0% of orders with Barrier Cream also had Hero Vitamin C Serum. Lift 1.35"');
    expect(out).toContain("Eye Cream: 6 orders together, a thin signal");
  });

  it("starts with a hint, and shows the pair's card (both titles, orders together, both confidences, the lift) once one is chosen", () => {
    expect(html(data)).toContain("Hover over a cell, tap it, or move to it with the arrow keys");
    const out = renderToStaticMarkup(<BundleMatrix data={data} defaultActive={[0, 2]} />);
    expect(out).toContain("Hero Vitamin C Serum");
    expect(out).toContain("Lip Tint");
    expect(out).toContain("Orders together");
    expect(out).toContain(">12<");
    expect(out).toContain("3.4% of orders with Hero Vitamin C Serum also had Lip Tint");
    expect(out).toContain("7.9% of orders with Lip Tint also had Hero Vitamin C Serum");
    expect(out).toContain("0.72");
    expect(out).toContain("times as often as chance");
    expect(out).toContain('aria-pressed="true"');
    expect(out).not.toContain("Thin signal: under 8 orders"); // 12 orders is not thin
    expect(renderToStaticMarkup(<BundleMatrix data={data} defaultActive={[1, 3]} />)).toContain("Thin signal: under 8 orders");
  });

  it("has a text alternative with every pair, strongest lift first as the tool gave them", () => {
    const out = html(data);
    expect(out).toContain("Show the numbers");
    expect(out).toContain("Hero Vitamin C Serum + Barrier Cream");
    expect(out).toContain("Barrier Cream + Eye Cream");
    expect(out).toContain("Thin (under 8)");
    expect(out).toContain("(1024 orders in the period)");
  });

  it("scrolls inside its own box rather than making the page wider", () => {
    const out = html(data);
    expect(out).toContain("overflow-x-auto");
    expect(out).toContain("min-w-max");
  });

  it("says what was left out, and what the tool said", () => {
    const out = html({ ...data, omitted: { pairs: 14, products: 11 }, truncated: { shown: 42, total: 90 }, caveats: ["A caveat from the tool."] });
    expect(out).toContain("14 other pairs are not.");
    expect(out).toContain("The tool listed 42 of 90 pairs.");
    expect(out).toContain("A caveat from the tool.");
    expect(html({ ...data, omitted: { pairs: 1, products: 1 } })).toContain("1 other pair is not.");
  });

  it("says so when no pair is listed, with the caveat, and draws no matrix", () => {
    const out = html({ ...data, products: [], pairs: [], caveats: ["No pair of products appeared together in at least 5 orders in this range, so none is listed."] });
    expect(out).toContain("No pair of products appeared together often enough to draw");
    expect(out).toContain("so none is listed");
    expect(out).not.toContain("<button");
    expect(out).not.toContain("Show the numbers");
  });

  it("renders product titles as text, never markup", () => {
    const evil = { ...data, products: data.products.map((p, i) => (i === 0 ? { ...p, title: '<img src=x onerror=alert(1)>"' } : p)) };
    const out = renderToStaticMarkup(<BundleMatrix data={evil} defaultActive={[0, 1]} />);
    expect(out).not.toContain("<img");
    expect(out).toContain("&lt;img");
  });

  it("uses only design tokens for colour", () => {
    expect(html(data)).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
  });
});
