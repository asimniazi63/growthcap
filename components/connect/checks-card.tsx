import { checksToLookAt, type HealthCheck } from "@/lib/health/checks";
import { HealthRow } from "./status-icon";

export function ChecksCard({ checks }: { checks: HealthCheck[] | null }) {
  const toLookAt = checks ? checksToLookAt(checks) : 0;
  return (
    <section className="card card-pad" aria-labelledby="checks-title">
      <div className="flex items-center justify-between gap-3">
        <h2 id="checks-title" className="section-title">
          Data checks
        </h2>
        {checks ? <span className={`badge ${toLookAt > 0 ? "badge-warn" : "badge-ahead"}`}>{toLookAt > 0 ? `${toLookAt} to look at` : "All clear"}</span> : null}
      </div>
      {checks ? (
        <ul className="mt-2">
          {checks.map((c) => (
            <HealthRow key={c.id} tone={c.status} label={c.label} detail={c.failed ? undefined : c.detail}>
              {c.failed ? <span className="font-normal text-ink-2">{c.value}</span> : c.value}
            </HealthRow>
          ))}
        </ul>
      ) : (
        <p className="muted mt-3 text-sm">Couldn&apos;t run these checks. Try again in a minute.</p>
      )}
    </section>
  );
}
