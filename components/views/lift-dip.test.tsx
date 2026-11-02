import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ViewData } from "@/lib/views/types";
import { ViewRenderer } from "./view-renderer";

const basis = { queryIds: ["q_aaaaaaaaaaaa"], range: { from: "2025-11-28", to: "2025-12-01" }, asOf: "2026-10-31T10:34:26.000Z" };
type Lift = Extract<ViewData, { component: "lift_dip" }>;
const dip: Lift = {
  component: "lift_dip",
  code: "BFCM25",
  baseline: { from: "2025-11-01", to: "2025-11-27", days: 27, netSalesCents: 48_300, perDayCents: 1_789 },
  window: { from: "2025-11-28", to: "2025-12-01", days: 4, netSalesCents: 28_200, perDayCents: 7_050, expectedNetSalesCents: 7_156 },
  after: { from: "2025-12-02", to: "2025-12-29", daysObserved: 28, fullyObserved: true, netSalesCents: 31_440, perDayCents: 1_123, expectedNetSalesCents: 50_089 },
  extraNetSalesCents: 21_044,
  pulledForwardNetSalesCents: 18_649,
  netLiftNetSalesCents: 2_395,
  customers: { repeatWindowDays: 30, promo: { cohortCustomers: 26, customers: 26, repeatRate: 0 }, comparison: { cohortCustomers: 40, customers: 40, repeatRate: 0.125 }, repeatRateGap: -0.125 },
  ...basis,
};
const html = (data: ViewData, title = "BFCM25 was it worth it") => renderToStaticMarkup(<ViewRenderer data={data} title={title} currency="USD" />);

describe("lift_dip", () => {
  it("labels the chart with the result's three figures, a dashed baseline, the hatched estimates and the customer strip", () => {
    const out = html(dip);
    expect(out).toContain("Extra sales");
    expect(out).toContain("$210.44");
    expect(out).toContain("Pulled forward");
    expect(out).toContain("$186.49");
    expect(out).toContain("Net lift");
    expect(out).toContain("$23.95");
    expect(out).toContain("border-dashed"); // the baseline
    expect(out).toContain("repeating-linear-gradient"); // the hatch on the extra and on the dip
    expect(out).toContain("12.5 points lower");
    expect(out).toContain("0.0%");
    expect(out).toContain("12.5%");
    expect(out).toContain("Customers who came back within 30 days");
    expect(out).toContain("BFCM25");
    expect(out).toContain("q_aaaaaaaaaaaa");
    expect(out).not.toContain("-$");
  });

  it("gives each bar's average day and its days under it, and a label for a screen reader with the whole story", () => {
    const out = html(dip);
    expect(out).toContain("$17.89");
    expect(out).toContain("$70.50");
    expect(out).toContain("$11.23");
    expect(out).toMatch(/aria-label="Average day of net sales before, during and after the BFCM25 promotion; before: \$17\.89 a day over 27 days; during: \$70\.50 a day over 4 days, extra sales \$210\.44; after: \$11\.23 a day over 28 days, \$186\.49 of sales pulled forward; net lift \$23\.95"/);
    expect(out).toContain('role="img"');
  });

  it("has a text alternative: a Show the numbers toggle with the periods, the lift and the customers", () => {
    const out = html(dip);
    expect(out).toContain("Show the numbers");
    expect(out).toContain("<table");
    expect(out).toContain("Before (baseline)");
    expect(out).toContain("Expected after the window");
    expect(out).toContain("Comparison customers");
    expect(out).toContain("Repeat within 30 days");
  });

  it("says no dip, instead of an empty band, when nothing was pulled forward", () => {
    const out = html({ ...dip, pulledForwardNetSalesCents: 0, netLiftNetSalesCents: 21_044, after: { ...dip.after, netSalesCents: 60_000, perDayCents: 2_143 } });
    expect(out).toContain("No dip after the window");
    expect(out).not.toContain('font-medium">Pulled forward'); // no label on the chart (the table still has its row)
    expect(out).toMatch(/after: \$21\.43 a day over 28 days, no dip after the window/);
    // the only hatched part left is the extra above the baseline
    expect(out.match(/repeating-linear-gradient/g)?.length).toBe(1);
  });

  it("says the dip so far when the days after are only partly in the data", () => {
    const out = html({ ...dip, after: { ...dip.after, daysObserved: 12, fullyObserved: false, perDayCents: 1_000 }, caveats: ["Only 12 days of the 28 days after the window are in the data."] });
    expect(out).toContain("Pulled forward so far");
    expect(out).toContain("12 days so far");
    expect(out).toContain("Only 12 days of the 28 days after the window are in the data.");
    expect(out).toContain('role="note"');
  });

  it("does not draw a bar or claim a dip when no day after the window is in the data", () => {
    const out = html({ ...dip, pulledForwardNetSalesCents: 0, netLiftNetSalesCents: 21_044, after: { ...dip.after, daysObserved: 0, fullyObserved: false, netSalesCents: 0, perDayCents: 0, expectedNetSalesCents: 0 } });
    expect(out).toContain("No days after the window in the data yet");
    expect(out).not.toContain("No dip after the window");
    expect(out).toContain("Not in the data yet");
  });

  it("describes a window that sold below the baseline in words, never with a minus sign", () => {
    const out = html({ ...dip, extraNetSalesCents: -5_000, netLiftNetSalesCents: -23_649, window: { ...dip.window, perDayCents: 800 } });
    expect(out).toContain("Below baseline");
    expect(out).toContain("$50.00");
    expect(out).toContain("net lift down $236.49");
    expect(out).not.toContain("-$");
    expect(out).not.toContain('font-medium">Extra sales');
  });

  it("copes with no sales at all, and with customers who have no repeat rate yet", () => {
    const flat: Lift = {
      ...dip,
      baseline: { ...dip.baseline, netSalesCents: 0, perDayCents: 0 },
      window: { ...dip.window, netSalesCents: 0, perDayCents: 0, expectedNetSalesCents: 0 },
      after: { ...dip.after, netSalesCents: 0, perDayCents: 0, expectedNetSalesCents: 0 },
      extraNetSalesCents: 0,
      pulledForwardNetSalesCents: 0,
      netLiftNetSalesCents: 0,
      customers: { ...dip.customers, promo: { cohortCustomers: 3, customers: 0, repeatRate: null }, comparison: { cohortCustomers: 0, customers: 0, repeatRate: null }, repeatRateGap: null },
    };
    const out = html(flat);
    expect(out).not.toContain("NaN");
    expect(out).toContain("no net lift");
    expect(out).toContain("no rate yet");
  });

  it("renders a discount code and every caveat as text, never as markup", () => {
    const out = html({ ...dip, code: "<img src=x onerror=alert(1)>", caveats: ["No order used <script>alert(1)</script> inside this window."] });
    expect(out).not.toContain("<img");
    expect(out).not.toContain("<script");
    expect(out).toContain("&lt;img");
  });

  it("uses only design tokens for colour", () => {
    expect(html(dip)).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
  });
});
