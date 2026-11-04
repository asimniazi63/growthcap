import { Check, Users } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { CAPABILITIES, ROLE_LABEL, ROLE_SHORT } from "@/lib/team/permissions";
import type { Team, TeamMember } from "@/lib/team/team";
import { ROLES, type Role } from "@/lib/tenancy/context";

// The Team page for a Growth Capital admin: how many people the brand has, who they are and what role each holds, then a grid of what
// each role can do. Names are text a person typed in their Clerk profile, so they are drawn as text, never as markup.

const ROLE_BADGE: Record<Role, string> = { gc_admin: "badge-brand", gc_partner: "", client_viewer: "" };

function RoleBadge({ role }: { role: Role | null }) {
  if (role === null) return <span className="badge badge-warn whitespace-nowrap">No access</span>;
  return <span className={`badge ${ROLE_BADGE[role]} whitespace-nowrap`}>{ROLE_LABEL[role]}</span>;
}

function Count({ label, value }: { label: string; value: number }) {
  return (
    <div className="card card-pad">
      <p className="faint text-xs font-medium">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-ink">{value}</p>
    </div>
  );
}

function Person({ member, me }: { member: TeamMember; me: string }) {
  return (
    <td className="align-middle">
      {member.name ? <span className="font-medium text-ink">{member.name}</span> : <span className="muted">No name set</span>}
      {member.userId === me ? <span className="badge badge-brand ml-2">You</span> : null}
      {member.name ? null : <span className="faint block text-xs">{member.userId.length > 12 ? `user …${member.userId.slice(-6)}` : member.userId}</span>}
    </td>
  );
}

export function TeamView({ team, me }: { team: Team; me: string }) {
  return (
    <div className="space-y-8">
      <section aria-label="Number of users">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
          <Count label="Users" value={team.total} />
          {ROLES.map((r) => (
            <Count key={r} label={`${ROLE_LABEL[r]}s`} value={team.counts[r]} />
          ))}
          {team.noAccess > 0 ? <Count label="No access" value={team.noAccess} /> : null}
        </div>
      </section>

      <section aria-labelledby="team-people">
        <h2 id="team-people" className="section-title mb-3">
          People
        </h2>
        {team.members.length === 0 ? (
          <EmptyState icon={Users} title="No one is in this brand yet">
            Add people to the brand&apos;s organisation in Clerk and they will appear here.
          </EmptyState>
        ) : (
          <div className="card overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Role</th>
                </tr>
              </thead>
              <tbody>
                {team.members.map((m) => (
                  <tr key={m.userId}>
                    <Person member={m} me={me} />
                    <td className="align-middle">
                      <RoleBadge role={m.role} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {team.noAccess > 0 ? <p className="faint mt-2 text-xs">&ldquo;No access&rdquo; means the person&apos;s Clerk role is not one of the three roles in the grid below, so they cannot open this app.</p> : null}
      </section>

      <section aria-labelledby="team-can-do">
        <h2 id="team-can-do" className="section-title mb-3">
          What each role can do
        </h2>
        <div className="card overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Can they</th>
                {ROLES.map((r) => (
                  <th key={r} scope="col" className="text-center">
                    {ROLE_SHORT[r]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {CAPABILITIES.map((c) => (
                <tr key={c.label}>
                  <th scope="row" className="whitespace-normal align-middle text-sm font-normal text-ink [tr:last-child_&]:border-b-0">
                    {c.label}
                  </th>
                  {ROLES.map((r) => (
                    <td key={r} className="text-center align-middle">
                      {c.roles.includes(r) ? (
                        <>
                          <Check className="mx-auto size-4 text-ahead" aria-hidden />
                          <span className="sr-only">Yes</span>
                        </>
                      ) : (
                        <>
                          <span aria-hidden className="text-ink-3">
                            –
                          </span>
                          <span className="sr-only">No</span>
                        </>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
