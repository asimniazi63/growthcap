import { ShieldCheck } from "lucide-react";
import type { GrantState, PermissionGroups, PermissionRow } from "@/lib/health/permissions";
import { HealthRow, type IconTone } from "./status-icon";

const TONE: Record<GrantState, IconTone> = { granted: "ok", limited: "warn", not_granted: "none" };

// The existing "Update permissions" form: a GET to the install route for this store, which Shopify answers with what is new.
function UpdatePermissionsForm({ shopDomain, size, label }: { shopDomain: string; size: "sm" | "md"; label?: string }) {
  return (
    <form action="/api/shopify/install" method="get">
      <input type="hidden" name="shop" value={shopDomain} />
      <button type="submit" aria-label={label} className={`btn btn-secondary ${size === "sm" ? "btn-sm" : ""}`}>
        <ShieldCheck className="size-4" aria-hidden />
        Update permissions
      </button>
    </form>
  );
}

function GroupRows({ rows, shopDomain, isAdmin }: { rows: PermissionRow[]; shopDomain: string; isAdmin: boolean }) {
  return (
    <ul className="mt-1">
      {rows.map((r) => (
        <HealthRow key={r.id} tone={TONE[r.state]} label={r.label} detail={r.detail}>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <span className={`badge ${r.state === "limited" ? "badge-warn" : r.state === "not_granted" ? "badge-behind" : ""}`}>
              {r.state === "granted" ? "Granted" : r.state === "limited" ? "Granted, limited" : "Not granted"}
            </span>
            {r.state === "not_granted" && isAdmin ? <UpdatePermissionsForm shopDomain={shopDomain} size="sm" label={`Update permissions to grant ${r.label.toLowerCase()}`} /> : null}
          </div>
        </HealthRow>
      ))}
    </ul>
  );
}

export function PermissionsCard({ groups, shopDomain, isAdmin }: { groups: PermissionGroups | null; shopDomain: string; isAdmin: boolean }) {
  return (
    <section className="card card-pad" aria-labelledby="permissions-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="permissions-title" className="section-title">
          What this app can do in the store
        </h2>
        {isAdmin ? <UpdatePermissionsForm shopDomain={shopDomain} size="sm" /> : null}
      </div>
      {groups ? (
        <div className="mt-3 grid gap-x-8 gap-y-5 md:grid-cols-2">
          <div>
            <h3 className="faint text-[0.8125rem] font-semibold">Reads, always</h3>
            <GroupRows rows={groups.reads} shopDomain={shopDomain} isAdmin={isAdmin} />
          </div>
          <div>
            <h3 className="faint text-[0.8125rem] font-semibold">Writes, only after a person approves</h3>
            <GroupRows rows={groups.writes} shopDomain={shopDomain} isAdmin={isAdmin} />
          </div>
        </div>
      ) : (
        <p className="muted mt-3 text-sm">Couldn&apos;t read the granted permissions.</p>
      )}
      {isAdmin ? (
        <p className="muted mt-4 text-sm">Use Update permissions after a new version of the app asks for more access. Shopify shows what is new, and the store stays connected.</p>
      ) : null}
    </section>
  );
}
