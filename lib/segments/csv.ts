import { CSV_COLUMNS, type SegmentCustomer, type SegmentId } from "./definitions";

// The segment export (T17): one row per customer, for a Klaviyo list import. Customers are pseudonymous ids, so there is no email column;
// matching them to Klaviyo profiles needs customer data this app does not have. Pure: the route supplies the customers.

// Integer cents to dollars with two decimals. Done on the integers, so there is no float noise (0.29 * 100 is 28.999999999999996).
export function dollars(cents: number): string {
  const whole = Math.round(cents);
  const abs = Math.abs(whole);
  const text = `${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
  return whole < 0 ? `-${text}` : text;
}

const NUMBER = /^-?\d+(\.\d+)?$/;
// Excel, Sheets and LibreOffice read a cell that starts with one of these as a formula.
const FORMULA_START = /^[=+\-@\t\r]/;

// One CSV field. A field with a comma, a quote or a line break is quoted, and a quote inside it is doubled. A text field that starts
// with = + - @ (or a tab or return) gets one leading space, so a spreadsheet reads it as text and never runs it. (A space, not the
// apostrophe some guides use: an apostrophe would show up in the cell in a plain-text viewer.) A plain number such as -2.50 is
// left alone, because it can't be a formula. Our ids are CUST_ plus hex and never need this; it is here so no field ever can.
export function csvField(value: string): string {
  const safe = FORMULA_START.test(value) && !NUMBER.test(value) ? ` ${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

// The Klaviyo file: the header, then the customers of `segment` (or, with none given, of the four segments, which leaves out the
// "active" customers), highest lifetime value first and then by id, so the same data always gives the same file.
export function segmentCsv(customers: SegmentCustomer[], segment?: SegmentId): string {
  const rows = customers
    .filter((c) => (segment ? c.segment === segment : c.segment !== "active"))
    .sort((a, b) => b.ltvCents - a.ltvCents || cmp(a.customerId, b.customerId))
    .map((c) => [c.customerId, c.segment, String(c.orders), dollars(c.ltvCents), String(c.daysSinceLast), String(c.r), String(c.f), String(c.m)].map(csvField).join(","));
  return `${[CSV_COLUMNS.join(","), ...rows].join("\n")}\n`;
}

// The route and the page both build these from a validated segment id and the as-of date; no store text goes into a URL or a file name.
export const exportUrl = (segment?: SegmentId): string => (segment ? `/api/segments/export?segment=${segment}` : "/api/segments/export");
export const exportFilename = (asOf: string, segment?: SegmentId): string => `segments-${segment ?? "all"}-${/^\d{4}-\d{2}-\d{2}$/.test(asOf) ? asOf : "undated"}.csv`;
