import { describe, expect, it } from "vitest";
import { CSV_COLUMNS, type SegmentCustomer } from "./definitions";
import { csvField, dollars, exportFilename, exportUrl, segmentCsv } from "./csv";

const customer = (over: Partial<SegmentCustomer> = {}): SegmentCustomer => ({
  customerId: "CUST_aaaa",
  orders: 3,
  firstOrderDate: "2026-01-02",
  lastOrderDate: "2026-09-20",
  daysSinceLast: 30,
  ltvCents: 12345,
  medianGapDays: 40,
  r: 5,
  f: 4,
  m: 4,
  churnRisk: 0.1,
  segment: "champions",
  ...over,
});

const lines = (csv: string) => csv.split("\n");

describe("dollars: integer cents to a dollar amount with two decimals, no float noise", () => {
  it.each([
    [12345, "123.45"],
    [5, "0.05"],
    [0, "0.00"],
    [100, "1.00"],
    [99, "0.99"],
    [1_000_000_07, "1000000.07"],
    [-250, "-2.50"],
    [-5, "-0.05"],
    [29, "0.29"], // 0.29 * 100 is 28.999999999999996 in floats; the cents are never divided as floats
  ])("%d cents is %s", (cents, out) => {
    expect(dollars(cents)).toBe(out);
  });
});

describe("csvField: quotes what needs it and neutralises spreadsheet formulas", () => {
  it("leaves a plain field alone", () => {
    expect(csvField("CUST_00ab12")).toBe("CUST_00ab12");
  });

  it("quotes a field with a comma, a quote or a line break, doubling inner quotes", () => {
    expect(csvField("a,b")).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField("a\nb")).toBe('"a\nb"');
    expect(csvField("a\rb")).toBe('"a\rb"');
  });

  it.each(["=SUM(A1)", "+1", "-1+2", "@cmd", "\tx"])("puts a leading space in front of %j so a spreadsheet reads it as text", (s) => {
    expect(csvField(s).replace(/^"/, "").startsWith(" ")).toBe(true);
  });

  it("does not touch a plain negative number, which is a number and not a formula", () => {
    expect(csvField("-2.50")).toBe("-2.50");
    expect(csvField("-7")).toBe("-7");
  });
});

describe("segmentCsv", () => {
  it("is just the header, with a trailing newline, for no customers", () => {
    expect(segmentCsv([])).toBe(`${CSV_COLUMNS.join(",")}\n`);
    expect(segmentCsv([], "at_risk")).toBe("customer_id,segment,orders,ltv,days_since_last_order,r,f,m\n");
  });

  it("writes one row per customer in column order, with ltv in dollars, LF line endings and a trailing newline", () => {
    const csv = segmentCsv([customer()]);
    expect(csv).toBe("customer_id,segment,orders,ltv,days_since_last_order,r,f,m\nCUST_aaaa,champions,3,123.45,30,5,4,4\n");
    expect(csv).not.toContain("\r");
    expect(csv.endsWith("\n")).toBe(true);
  });

  it("rounds nothing: cents become exact dollars and cents", () => {
    const rows = lines(segmentCsv([customer({ customerId: "CUST_a", ltvCents: 12345 }), customer({ customerId: "CUST_b", ltvCents: 5 })]));
    expect(rows[1]?.split(",")[3]).toBe("123.45");
    expect(rows[2]?.split(",")[3]).toBe("0.05");
  });

  it("with no segment given, writes the four segments and leaves the active customers out", () => {
    const csv = segmentCsv([
      customer({ customerId: "CUST_1", segment: "champions" }),
      customer({ customerId: "CUST_2", segment: "active" }),
      customer({ customerId: "CUST_3", segment: "at_risk" }),
      customer({ customerId: "CUST_4", segment: "due_to_reorder" }),
      customer({ customerId: "CUST_5", segment: "one_and_done" }),
    ]);
    const ids = lines(csv).slice(1, -1).map((l) => l.split(",")[0]);
    expect(ids.sort()).toEqual(["CUST_1", "CUST_3", "CUST_4", "CUST_5"]);
  });

  it("with a segment given, writes only that segment", () => {
    const customers = [customer({ customerId: "CUST_1", segment: "champions" }), customer({ customerId: "CUST_2", segment: "at_risk" }), customer({ customerId: "CUST_3", segment: "at_risk" })];
    const rows = lines(segmentCsv(customers, "at_risk")).slice(1, -1);
    expect(rows.map((l) => l.split(",")[0]).sort()).toEqual(["CUST_2", "CUST_3"]);
    expect(rows.every((l) => l.split(",")[1] === "at_risk")).toBe(true);
    expect(segmentCsv(customers, "one_and_done")).toBe(`${CSV_COLUMNS.join(",")}\n`);
  });

  it("orders by ltv, highest first, then by customer id, and leaves the input as it was", () => {
    const customers = [
      customer({ customerId: "CUST_c", ltvCents: 500 }),
      customer({ customerId: "CUST_b", ltvCents: 9000 }),
      customer({ customerId: "CUST_a", ltvCents: 500 }),
      customer({ customerId: "CUST_d", ltvCents: 70_000 }),
    ];
    const before = customers.map((c) => c.customerId);
    const ids = lines(segmentCsv(customers)).slice(1, -1).map((l) => l.split(",")[0]);
    expect(ids).toEqual(["CUST_d", "CUST_b", "CUST_a", "CUST_c"]);
    expect(customers.map((c) => c.customerId)).toEqual(before);
  });

  it("writes every field through the escape, so an odd id cannot break out of its cell or become a formula", () => {
    const csv = segmentCsv([customer({ customerId: '=HYPERLINK("x","y")' }), customer({ customerId: "a,b", ltvCents: 1 })]);
    const rows = lines(csv).slice(1, -1);
    expect(rows[0]?.startsWith('" =HYPERLINK(""x"",""y"")",')).toBe(true);
    expect(rows[1]?.startsWith('"a,b",')).toBe(true);
  });
});

describe("the export URL and file name are built from the validated segment id and the as-of date only", () => {
  it("links to the route with a segment, or without one for all", () => {
    expect(exportUrl()).toBe("/api/segments/export");
    expect(exportUrl("at_risk")).toBe("/api/segments/export?segment=at_risk");
  });

  it("names the file segments-<segment|all>-<asOf>.csv", () => {
    expect(exportFilename("2026-10-31", "at_risk")).toBe("segments-at_risk-2026-10-31.csv");
    expect(exportFilename("2026-10-31")).toBe("segments-all-2026-10-31.csv");
  });

  it("never puts anything but a date in the file name", () => {
    expect(exportFilename('x"; filename=evil', "champions")).toBe("segments-champions-undated.csv");
  });
});
