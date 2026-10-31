import { formatInZone, formatUtcSlot } from "@/lib/health/format";
import type { Freshness } from "@/lib/health/freshness";
import { HealthRow } from "./status-icon";

export function FreshnessCard({ freshness, timezone }: { freshness: Freshness; timezone: string }) {
  const { asOf, lastOrderWebhookAt, webhookFailed, nextSyncAt, stale } = freshness;
  return (
    <section className="card card-pad" aria-labelledby="freshness-title">
      <div className="flex items-center justify-between gap-3">
        <h2 id="freshness-title" className="section-title">
          Freshness
        </h2>
        <span className={`badge ${stale ? "badge-warn" : "badge-ahead"}`}>{asOf ? (stale ? "Out of date" : "Up to date") : "Not synced yet"}</span>
      </div>
      <ul className="mt-2">
        <HealthRow tone={stale ? "warn" : "ok"} label="Data as of" detail="Last sync or new order">
          {asOf ? formatInZone(asOf, timezone) : "Not synced yet"}
        </HealthRow>
        <HealthRow tone={lastOrderWebhookAt ? "ok" : "off"} label="Last new order received" detail="orders/create webhook">
          {webhookFailed ? <span className="font-normal text-ink-2">Couldn&apos;t load</span> : lastOrderWebhookAt ? formatInZone(lastOrderWebhookAt, timezone) : "None yet"}
        </HealthRow>
        <HealthRow tone="off" label="Next daily sync" detail="Runs for every connected store">
          {nextSyncAt ? formatUtcSlot(nextSyncAt) : "Not scheduled"}
        </HealthRow>
      </ul>
    </section>
  );
}
