import Link from "next/link";
import type { SegmentCustomer, SegmentId } from "@/lib/segments/definitions";
import { SEGMENTS } from "@/lib/segments/definitions";
import { count, days, money, topCustomers, TOP_N, wholePct } from "./format";
import { TopCustomerRow } from "./top-customer-row";

// The segment picker and the biggest customers of the chosen segment. Plain links with ?segment=, so it is rendered on the server.
export function SegmentPicker({ selected }: { selected: SegmentId }) {
  return (
    <nav aria-label="Choose a segment">
      <ul className="flex flex-wrap gap-2">
        {SEGMENTS.map((s) => (
          <li key={s.id}>
            <Link
              href={`/segments?segment=${s.id}#top-customers`}
              scroll={false}
              aria-current={selected === s.id ? "true" : undefined}
              className={`inline-flex items-center rounded-full border px-3.5 py-1.5 text-sm font-medium ${selected === s.id ? "border-transparent bg-brand-tint text-brand-strong" : "border-line-strong bg-surface text-ink-2 hover:bg-paper-2"}`}
            >
              {s.title}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

// Customers are shown by their pseudonymous id only. Churn risk is the segment maths' rule-based score, a fraction shown as a percentage.
// A row is marked when its customer is the one selected on the customer map.
export function TopCustomers({ customers, segment, currency }: { customers: SegmentCustomer[]; segment: SegmentId; currency: string }) {
  const title = SEGMENTS.find((s) => s.id === segment)?.title ?? segment;
  const rows = topCustomers(customers, segment, TOP_N);
  if (rows.length === 0) {
    return <p className="muted rounded-xl border border-dashed border-line-strong px-4 py-6 text-center text-sm">Nobody is in {title} right now.</p>;
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-line">
      <table className="data-table min-w-[34rem]">
        <caption className="sr-only">
          Customers in {title} with the highest lifetime value, up to {TOP_N}
        </caption>
        <thead>
          <tr>
            <th scope="col">Customer</th>
            <th scope="col" className="num">
              Orders
            </th>
            <th scope="col" className="num">
              Lifetime value
            </th>
            <th scope="col" className="num">
              Since last order
            </th>
            <th scope="col" className="num">
              Churn risk
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <TopCustomerRow key={c.customerId} customerId={c.customerId}>
              <td className="font-mono text-[0.8125rem]">{c.customerId}</td>
              <td className="num">{count(c.orders)}</td>
              <td className="num">{money(c.ltvCents, currency)}</td>
              <td className="num">{days(c.daysSinceLast)}</td>
              <td className="num">{wholePct(c.churnRisk)}</td>
            </TopCustomerRow>
          ))}
        </tbody>
      </table>
    </div>
  );
}
