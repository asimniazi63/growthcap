import Link from "next/link";
import type { SegmentSummary } from "@/lib/metrics/segments";
import { SEGMENTS, type SegmentId } from "@/lib/segments/definitions";
import { count, money, sharePct } from "./format";
import { CreateInShopifyLink, DownloadCsvLink } from "./segment-actions";

const NONE = "n/a"; // an average over nobody

// One card for each of the four segments. The figures are exactly what summarizeSegments returned; this only formats them.
export function SegmentCards({ summaries, currency, connected, selected }: { summaries: SegmentSummary[]; currency: string; connected: boolean; selected: SegmentId }) {
  return (
    <ul className="grid gap-4 sm:grid-cols-2">
      {SEGMENTS.map((s) => {
        const row = summaries.find((x) => x.segment === s.id);
        const empty = (row?.customers ?? 0) === 0;
        const headingId = `segment-${s.id}`;
        return (
          <li key={s.id}>
            <article aria-labelledby={headingId} className={`card card-pad flex h-full flex-col ${selected === s.id ? "ring-2 ring-brand/40" : ""}`}>
              <h3 id={headingId} className="section-title">
                {s.title}
              </h3>
              <p className="muted mt-1 text-sm">{s.description}</p>
              <p className="stat mt-4 text-3xl">
                {count(row?.customers ?? 0)}
                <span className="muted ml-2 text-sm font-normal tracking-normal">{(row?.customers ?? 0) === 1 ? "customer" : "customers"}</span>
              </p>
              <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                <div>
                  <dt className="faint text-xs">Share of customers</dt>
                  <dd className="num font-medium">{sharePct(row?.shareOfCustomers ?? 0)}</dd>
                </div>
                <div>
                  <dt className="faint text-xs">Average LTV</dt>
                  <dd className="num font-medium">{empty ? NONE : money(row?.avgLtvCents ?? 0, currency)}</dd>
                </div>
                <div className="col-span-2">
                  <dt className="faint text-xs">Average days since last order</dt>
                  <dd className="num font-medium">{empty ? NONE : count(Math.round(row?.avgDaysSinceLast ?? 0))}</dd>
                </div>
              </dl>
              <div className="mt-auto flex flex-wrap items-center gap-x-1 gap-y-1.5 pt-4">
                <Link href={`/segments?segment=${s.id}#top-customers`} aria-current={selected === s.id ? "true" : undefined} className="btn btn-ghost btn-sm">
                  Top customers<span className="sr-only"> in {s.title}</span>
                </Link>
                <DownloadCsvLink segment={s.id} connected={connected} label="Download CSV" hidden={`for Klaviyo: ${s.title}`} />
                <CreateInShopifyLink segment={s.id} title={s.title} connected={connected} />
              </div>
            </article>
          </li>
        );
      })}
    </ul>
  );
}
