import type { MonthCount } from "@/lib/health/coverage";
import { formatMonthLabel, plural } from "@/lib/health/format";
import type { SyncStatus } from "@/lib/sync/status";

const number = new Intl.NumberFormat("en-US");

// The counts the page already showed, the order date range, and orders per month as a small bar strip.
export function CoverageCard({ status, months }: { status: SyncStatus; months: MonthCount[] | null }) {
  const { counts } = status;
  const tiles: [string, number][] = [
    ["Orders", counts.orders],
    ["Customers", counts.customers],
    ["Products", counts.products],
    ["Variants", counts.variants],
    ["Refunds", counts.refunds],
  ];
  const peak = months ? Math.max(...months.map((m) => m.orders), 0) : 0;
  const firstMonth = months?.[0]?.month;
  const lastMonth = months?.[months.length - 1]?.month;
  return (
    <section className="card card-pad" aria-labelledby="coverage-title">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="coverage-title" className="section-title">
          What is in the data
        </h2>
        <p className="muted text-sm">
          {status.firstOrderDate && status.lastOrderDate ? `Orders from ${status.firstOrderDate} to ${status.lastOrderDate}` : "No orders synced yet"}
        </p>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {tiles.map(([label, value]) => (
          <div key={label} className="inset px-3.5 py-3">
            <dt className="faint text-xs">{label}</dt>
            <dd className="stat num mt-1 text-xl">{number.format(value)}</dd>
          </div>
        ))}
      </dl>
      {months && months.length > 0 && firstMonth && lastMonth ? (
        <figure className="mt-5">
          <div role="img" aria-label={`Orders per month, ${plural(months.length, "month")}, from ${formatMonthLabel(firstMonth)} to ${formatMonthLabel(lastMonth)}`} className="flex h-14 items-end gap-1">
            {months.map((m) => (
              <div
                key={m.month}
                title={`${formatMonthLabel(m.month)}: ${plural(m.orders, "order")}`}
                className={`min-w-0 flex-1 rounded-t border-t-2 ${m.orders > 0 ? "border-brand bg-brand-tint" : "border-line bg-transparent"}`}
                style={{ height: m.orders > 0 && peak > 0 ? `${Math.max(6, (m.orders / peak) * 100)}%` : "2px" }}
              />
            ))}
          </div>
          <figcaption className="faint mt-1.5 flex justify-between text-xs">
            <span>{formatMonthLabel(firstMonth)}</span>
            <span>Orders per month, cancelled left out</span>
            <span>{formatMonthLabel(lastMonth)}</span>
          </figcaption>
        </figure>
      ) : months === null ? (
        <p className="muted mt-4 text-sm">Couldn&apos;t load orders per month.</p>
      ) : null}
    </section>
  );
}
