import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CountUp } from "./count-up";

// The server HTML is what a reader sees before any script runs, and what runs under reduced motion: it must be the final figure.
describe("CountUp, server HTML", () => {
  it("shows the final money value, in the same format as the static text, and never a zero", () => {
    const out = renderToStaticMarkup(<CountUp value={1_234_567} unit="money" currency="USD" />);
    expect(out).toContain("$12,345.67");
    expect(out).not.toContain("$0.00");
  });

  it("keeps rates as percentages and counts as counts", () => {
    expect(renderToStaticMarkup(<CountUp value={0.4321} unit="rate" />)).toContain("43.2%");
    expect(renderToStaticMarkup(<CountUp value={1234} unit="count" />)).toContain("1,234");
  });

  it("uses the currency it is given", () => {
    expect(renderToStaticMarkup(<CountUp value={50_000} unit="money" currency="GBP" />)).toContain("£500.00");
  });

  it("gives assistive tech the final value once, and hides the visual copies from it", () => {
    const out = renderToStaticMarkup(<CountUp value={1_234_567} unit="money" currency="USD" />);
    expect(out.match(/<span class="sr-only">\$12,345\.67<\/span>/g)).toHaveLength(1);
    // The reserved-width copy and the animated copy are both aria-hidden.
    expect(out.match(/<span aria-hidden="true"/g)).toHaveLength(2);
    expect(out).toContain("invisible");
  });

  it("uses tabular figures and does not wrap, so the width holds", () => {
    const out = renderToStaticMarkup(<CountUp value={1_234_567} unit="money" />);
    expect(out).toContain("num");
    expect(out).toContain("whitespace-nowrap");
  });

  it("aligns to the end for right-aligned columns", () => {
    expect(renderToStaticMarkup(<CountUp value={5} unit="count" align="end" />)).toContain("justify-items-end");
    expect(renderToStaticMarkup(<CountUp value={5} unit="count" />)).toContain("justify-items-start");
  });
});
