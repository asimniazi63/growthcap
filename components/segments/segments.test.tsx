import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { summarizeSegments } from "@/lib/metrics/segments";
import { SEGMENTS, type SegmentCustomer } from "@/lib/segments/definitions";
import { RfmGrid } from "./rfm-grid";
import { CreateInShopifyLink, DownloadCsvLink } from "./segment-actions";
import { SegmentCards } from "./segment-cards";
import { SegmentPicker, TopCustomers } from "./top-customers";

const customer = (over: Partial<SegmentCustomer> = {}): SegmentCustomer => ({
  customerId: "CUST_a",
  orders: 2,
  firstOrderDate: "2026-01-02",
  lastOrderDate: "2026-06-20",
  daysSinceLast: 133,
  ltvCents: 12_345,
  medianGapDays: 40,
  r: 2,
  f: 3,
  m: 4,
  churnRisk: 0.724,
  segment: "at_risk",
  ...over,
});

const customers = [
  customer({ customerId: "CUST_a", ltvCents: 12_345 }),
  customer({ customerId: "CUST_b", ltvCents: 99_900, r: 5, f: 5, segment: "champions", orders: 7, daysSinceLast: 12, churnRisk: 0.04 }),
  customer({ customerId: "CUST_c", ltvCents: 4_000, r: 5, f: 5, segment: "champions" }),
  customer({ customerId: "CUST_d", ltvCents: 2_000, r: 4, f: 1, segment: "active", orders: 1 }),
];

describe("SegmentCards", () => {
  const html = (connected = true) => renderToStaticMarkup(<SegmentCards summaries={summarizeSegments(customers)} currency="USD" connected={connected} selected="at_risk" />);

  it("has one card per segment with its title, its plain description, and the customer count", () => {
    const out = html();
    for (const s of SEGMENTS) {
      expect(out).toContain(`>${s.title}</h3>`);
      expect(out).toContain(s.description);
    }
    expect(out.match(/<article /g)).toHaveLength(4);
    expect(out).toMatch(/<p class="stat[^"]*">2<span[^>]*>customers<\/span>/); // champions
  });

  it("shows the share, the average LTV in dollars and the average days since the last order", () => {
    const out = html();
    expect(out).toContain("50.0%"); // 2 of 4 customers are champions
    expect(out).toContain("$519.50"); // champions: (99,900 + 4,000) / 2 cents
    expect(out).toContain("$123.45"); // the one at-risk customer
    expect(out).toContain(">133<"); // days since last order for the at-risk customer
  });

  it("shows n/a, not a zero average, for a segment nobody is in", () => {
    const out = html();
    expect(out.match(/>n\/a</g)).toHaveLength(4); // due to reorder and one and done: average LTV and average days each
  });

  it("links every card to its own CSV, to its top customers and to the chat that asks for the Shopify segment", () => {
    const out = html();
    for (const s of SEGMENTS) {
      expect(out).toContain(`href="/api/segments/export?segment=${s.id}"`);
      expect(out).toContain(`href="/segments?segment=${s.id}#top-customers"`);
      expect(out).toContain(`href="/chat?q=${encodeURIComponent(`Create the ${s.title} segment in Shopify`)}"`);
    }
  });

  it("makes the whole card a way to its top customers, with the CSV and Shopify controls still clickable above that", () => {
    const out = html();
    expect(out.match(/<article[^>]*class="[^"]*\brelative\b/g)).toHaveLength(4);
    const links = [...out.matchAll(/<a [^>]*>/g)].map((m) => m[0]).filter((tag) => tag.includes("#top-customers"));
    expect(links).toHaveLength(4);
    expect(links.every((tag) => tag.includes("after:absolute") && tag.includes("after:inset-0"))).toBe(true);
    expect(out.match(/class="relative z-10 inline-flex"/g)?.length).toBe(8); // CSV and Shopify, for each of the four cards
  });

  it("switches the CSV and Shopify controls off, with the reason, when the store is not connected", () => {
    const out = html(false);
    expect(out).not.toContain("/api/segments/export");
    expect(out).not.toContain("/chat?q=");
    expect(out.match(/aria-disabled="true"/g)).toHaveLength(8);
    expect(out).toContain('title="Reconnect the store first."');
  });
});

describe("RfmGrid", () => {
  const out = renderToStaticMarkup(<RfmGrid customers={customers} />);

  it("is a table with recency rows 5 to 1 and frequency columns 1 to 5", () => {
    expect(out).toContain("<table");
    expect(out.match(/scope="col"/g)).toHaveLength(5);
    const rows = [...out.matchAll(/scope="row"[^>]*><span aria-hidden="true">R(\d)<\/span>/g)].map((m) => m[1]);
    expect(rows).toEqual(["5", "4", "3", "2", "1"]);
  });

  it("gives every cell its count in words as well as digits, so colour is never the only signal", () => {
    expect(out).toContain("Recency 5, frequency 5: 2 customers");
    expect(out).toContain("Recency 4, frequency 1: 1 customer<");
    expect(out).toContain("Recency 2, frequency 3: 1 customer<");
    expect(out).toContain("Recency 1, frequency 1: 0 customers");
    expect(out.match(/Recency \d, frequency \d: /g)).toHaveLength(25);
  });

  it("shades a cell from the theme tokens only, and leaves empty cells unfilled and dashed", () => {
    expect(out).toContain("color-mix(in oklab, var(--color-brand) 40%, var(--color-surface))"); // the fullest cell
    expect(out).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
    expect(out.match(/border-dashed/g)).toHaveLength(22); // 25 cells, 3 with customers
  });

  it("copes with no customers", () => {
    const empty = renderToStaticMarkup(<RfmGrid customers={[]} />);
    expect(empty).toContain("Recency 3, frequency 3: 0 customers");
    expect(empty).not.toContain("color-mix");
  });
});

describe("TopCustomers and SegmentPicker", () => {
  it("lists the segment's customers by lifetime value with orders, LTV, days since the last order and churn risk as a percentage", () => {
    const out = renderToStaticMarkup(<TopCustomers customers={customers} segment="champions" currency="USD" />);
    expect(out.indexOf("CUST_b")).toBeGreaterThan(-1);
    expect(out.indexOf("CUST_b")).toBeLessThan(out.indexOf("CUST_c"));
    expect(out).not.toContain("CUST_a"); // at risk, not champions
    expect(out).toContain("$999.00");
    expect(out).toContain("12 days");
    expect(out).toContain("4%");
    expect(out).toContain(">7<");
  });

  it("shows at most 15 rows", () => {
    const many = Array.from({ length: 30 }, (_, i) => customer({ customerId: `CUST_${String(i).padStart(2, "0")}`, ltvCents: i * 100 }));
    const out = renderToStaticMarkup(<TopCustomers customers={many} segment="at_risk" currency="USD" />);
    expect(out.match(/font-mono/g)).toHaveLength(15);
    expect(out).toContain("CUST_29");
    expect(out).not.toContain("CUST_00");
  });

  it("says so when nobody is in the segment", () => {
    expect(renderToStaticMarkup(<TopCustomers customers={customers} segment="one_and_done" currency="USD" />)).toContain("Nobody is in One and done right now.");
  });

  it("marks the chosen segment in the picker for assistive technology", () => {
    const out = renderToStaticMarkup(<SegmentPicker selected="due_to_reorder" />);
    expect(out.match(/aria-current="true"/g)).toHaveLength(1);
    expect(out).toMatch(/aria-current="true"[^>]*>Due to reorder</);
  });
});

describe("the two controls", () => {
  it("download the file for one segment or for all of them", () => {
    expect(renderToStaticMarkup(<DownloadCsvLink label="Download CSV for Klaviyo" connected primary />)).toContain('href="/api/segments/export"');
    expect(renderToStaticMarkup(<DownloadCsvLink segment="at_risk" label="Download CSV" hidden="for Klaviyo: At risk" connected />)).toContain('href="/api/segments/export?segment=at_risk"');
  });

  it("ask the agent for the Shopify segment through the chat, which is the only place a proposal can be made", () => {
    const out = renderToStaticMarkup(<CreateInShopifyLink segment="at_risk" title="At risk" connected />);
    expect(out).toContain('href="/chat?q=Create%20the%20At%20risk%20segment%20in%20Shopify"');
    expect(out).toContain("approval");
  });
});
