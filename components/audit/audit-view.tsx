import { AlertTriangle, CheckCircle2, PencilLine, ShieldAlert } from "lucide-react";
import { SafeMarkdown } from "@/components/chat/safe-markdown";
import type { AuditCheckId, AuditFinding } from "@/lib/audit/checks";
import type { AuditItemView } from "@/lib/audit/store";
import { formatCents } from "@/lib/health/format";
import { figureRows, healthLine, itemRows, severityLabel } from "./format";

const day = (d: Date) => new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(d) + " UTC";

function OpportunityCard({ rank, finding, currency }: { rank: number; finding: AuditFinding; currency: string }) {
  const rows = figureRows(finding, currency);
  return (
    <li className="card card-pad">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid size-7 shrink-0 place-items-center rounded-full bg-brand-tint text-sm font-semibold text-brand-strong" aria-hidden>
            {rank}
          </span>
          <h3 className="section-title">{finding.title}</h3>
        </div>
        <span className={`badge ${finding.flagged ? "badge-warn" : ""}`}>{severityLabel(finding)}</span>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-paper-2" role="img" aria-label={`Impact score ${finding.severity} of 100`}>
        <div className={`h-full rounded-full ${finding.flagged ? "bg-warn" : "bg-ink-3"}`} style={{ width: `${Math.max(2, finding.severity)}%` }} />
      </div>
      <p className="muted mt-3 text-sm leading-6">{finding.summary}</p>
      {rows.length > 0 ? (
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
          {rows.map((r) => (
            <div key={r.label}>
              <dt className="faint text-xs">{r.label}</dt>
              <dd className="stat mt-0.5 text-lg">{r.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {finding.items && finding.items.length > 0 ? (
        <div className="mt-4 overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Product</th>
                {itemRows(finding.items[0]!, currency).map((r) => (
                  <th key={r.label} className="num">
                    {r.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {finding.items.map((item) => (
                <tr key={item.id}>
                  <td className="font-medium">{item.untrusted.product}</td>
                  {itemRows(item, currency).map((r) => (
                    <td key={r.label} className="num">
                      {r.value}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </li>
  );
}

// The newest audit of a brand: the model's write-up beside the findings the code computed. The write-up goes through the same
// allow-listed markdown as the chat. Product names are store text and are only ever shown as text.
export function AuditView({ audit, currency }: { audit: AuditItemView; currency: string }) {
  const report = audit.report;
  const byId = new Map<AuditCheckId, AuditFinding>((report?.findings ?? []).map((f) => [f.id, f]));
  const top = (report?.opportunities ?? []).map((id) => byId.get(id)).filter((f): f is AuditFinding => !!f);
  const draft = audit.status === "draft";
  return (
    <div className="space-y-8">
      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3.5 sm:px-6">
          <h2 className="section-title">Audit of {day(audit.createdAt)}</h2>
          <span className={`badge ${draft ? "badge-warn" : "badge-behind"}`}>
            {draft ? <PencilLine className="size-3.5" aria-hidden /> : <ShieldAlert className="size-3.5" aria-hidden />}
            {draft ? "Draft" : "Blocked"}
          </span>
        </div>
        <div className="px-5 py-5 sm:px-6 [&_p]:text-[0.9375rem] [&_p]:leading-7">
          <div className="max-w-[68ch]">
            <SafeMarkdown text={audit.body} />
          </div>
          {audit.status === "blocked" ? (
            <div role="alert" className="mt-5 flex items-start gap-3 rounded-xl bg-behind-tint px-4 py-3.5 text-sm text-behind">
              <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
              <div>
                <p className="font-semibold">The number checker could not find these figures in the data, so treat this write-up as unchecked. The findings below come straight from the data.</p>
                <ul className="mt-1.5 list-disc space-y-0.5 pl-5">
                  {audit.unmatched.map((u, i) => (
                    <li key={`${i}-${u}`}>{u}</li>
                  ))}
                </ul>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {report ? (
        <>
          {report.headline ? (
            <section aria-labelledby="audit-headline" className="space-y-3">
              <h2 id="audit-headline" className="section-title">
                Last 30 days
              </h2>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                {[
                  ["Net sales", formatCents(report.headline.netSalesCents, currency)],
                  ["Orders", new Intl.NumberFormat("en-US").format(report.headline.orders)],
                  ["Average order value", formatCents(report.headline.aovCents, currency)],
                ].map(([label, value]) => (
                  <div key={label} className="card card-pad">
                    <p className="faint text-sm">{label}</p>
                    <p className="stat mt-1 text-3xl">{value}</p>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          <section aria-labelledby="audit-opps" className="space-y-3">
            <h2 id="audit-opps" className="section-title">
              Top opportunities
            </h2>
            <ol className="space-y-4">
              {top.map((f, i) => (
                <OpportunityCard key={f.id} rank={i + 1} finding={f} currency={currency} />
              ))}
            </ol>
            <p className="faint text-sm">Found by fixed checks over the store&apos;s synced data and ranked by an impact score worked out in code. The model only writes them up.</p>
          </section>

          <section aria-labelledby="audit-health" className="space-y-3">
            <h2 id="audit-health" className="section-title">
              Data health
            </h2>
            <ul className="card divide-y divide-line">
              {report.health.map((h) => (
                <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
                  <span className="flex items-center gap-2">
                    {h.status === "warn" ? <AlertTriangle className="size-4 text-warn" aria-hidden /> : <CheckCircle2 className="size-4 text-ahead" aria-hidden />}
                    {h.label}
                  </span>
                  <span className={h.status === "warn" ? "font-medium text-warn" : "muted"}>{healthLine(h, currency)}</span>
                </li>
              ))}
            </ul>
          </section>
        </>
      ) : (
        <p className="muted text-sm">The findings for this audit are in an older format and can&apos;t be shown. Run the audit again.</p>
      )}
    </div>
  );
}
