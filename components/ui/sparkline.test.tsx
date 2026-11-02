import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { sparkGeometry } from "./spark-geometry";
import { Sparkline } from "./sparkline";

const opts = { width: 100, height: 40, pad: 4 };

describe("sparkGeometry", () => {
  it("runs left to right across the padded width and up for bigger values", () => {
    const g = sparkGeometry([0, 50, 100], opts)!;
    expect(g.line).toBe("M4.0 36.0 L50.0 20.0 L96.0 4.0");
    expect(g.last).toEqual({ x: 96, y: 4 });
    expect(g.plan).toBeNull();
  });

  it("starts the scale at 0, so a small rise on a big base does not look like a swing", () => {
    const g = sparkGeometry([1000, 1010], opts)!;
    expect(g.last.y).toBeCloseTo(4 + (1 - 1010 / 1010) * 32, 5);
    const first = Number(g.line.split(" ")[1]);
    expect(first).toBeLessThan(5); // 1000 of 1010 is nearly the top, not the bottom
  });

  it("puts the plan on the same scale as the line", () => {
    const g = sparkGeometry([0, 50], { ...opts, plan: [0, 100] })!;
    expect(g.plan).toBe("M4.0 36.0 L96.0 4.0");
    expect(g.last.y).toBe(20); // 50 against a shared top of 100
  });

  it("ignores a plan of the wrong length", () => {
    expect(sparkGeometry([1, 2, 3], { ...opts, plan: [1, 2] })!.plan).toBeNull();
  });

  it("draws a flat run of zeros along the bottom", () => {
    const g = sparkGeometry([0, 0, 0], opts)!;
    expect(g.line).toBe("M4.0 36.0 L50.0 36.0 L96.0 36.0");
  });

  it("gives nothing for fewer than two points or a broken number", () => {
    expect(sparkGeometry([], opts)).toBeNull();
    expect(sparkGeometry([5], opts)).toBeNull();
    expect(sparkGeometry([1, Number.NaN], opts)).toBeNull();
    expect(sparkGeometry([1, 2], { ...opts, plan: [1, Number.POSITIVE_INFINITY] })).toBeNull();
  });
});

describe("Sparkline", () => {
  it("is an image with the label, the line, the last-point ring, and no hard-coded colours", () => {
    const out = renderToStaticMarkup(<Sparkline values={[1, 3, 2, 5]} plan={[2, 2, 3, 4]} label="Net sales, from $1.00 on October 1 to $5.00 on October 4." />);
    expect(out).toContain('role="img"');
    expect(out).toContain('aria-label="Net sales, from $1.00 on October 1 to $5.00 on October 4."');
    expect(out).toContain("spark-line");
    expect(out).toContain("spark-dot");
    expect(out).toContain("stroke-plan");
    expect(out).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(/i);
  });

  it("leaves the plan line out when there is none", () => {
    expect(renderToStaticMarkup(<Sparkline values={[1, 2]} label="x" />)).not.toContain("stroke-plan");
  });

  it("renders nothing when there is nothing to draw", () => {
    expect(renderToStaticMarkup(<Sparkline values={[4]} label="x" />)).toBe("");
  });
});
