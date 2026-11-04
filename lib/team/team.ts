import { displayName } from "../actions/people";
import { roleFromClerk } from "../portfolio/memberships";
import { ROLES, type Role, type TenantContext } from "../tenancy/context";

// The Team page: everyone who belongs to the signed-in brand's Clerk organisation, with the role each one holds. Only a Growth Capital
// admin may see it (the product plan gives "manage roles" to gc_admin alone). It is read-only: roles are changed in Clerk.
// The organisation comes from the Clerk session (ctx.orgId), never from a request. Only a name is shown, never an email address.

export const canViewTeam = (ctx: Pick<TenantContext, "role">): boolean => ctx.role === "gc_admin";

// What this reads of a Clerk membership. Nothing else is taken from the user, and the email-like `identifier` is left out on purpose.
export interface RawMember {
  userId: string;
  firstName: string | null;
  lastName: string | null;
  role: string; // as Clerk sends it: "org:gc_admin", or the built-in "org:admin" / "org:member"
}
export type FetchMembers = (orgId: string) => Promise<RawMember[]>;

export interface TeamMember {
  userId: string;
  name: string | null; // null when the person has set no name
  role: Role | null; // null for a member whose Clerk role gives no access to this app
}

export interface Team {
  members: TeamMember[];
  total: number;
  counts: Record<Role, number>;
  noAccess: number; // members whose role gives no access to this app, so the counts add up to the total
}

const PAGE = 100;
const MAX_MEMBERS = 500; // the longest list the page asks Clerk for; an agency team is far smaller

// Loaded lazily, so that code and tests that inject their own list never pull in Clerk (as lib/portfolio/memberships.ts does).
export const clerkMembers: FetchMembers = async (orgId) => {
  const { clerkClient } = await import("@clerk/nextjs/server");
  const client = await clerkClient();
  const out: RawMember[] = [];
  for (let offset = 0; out.length < MAX_MEMBERS; offset += PAGE) {
    const page = await client.organizations.getOrganizationMembershipList({ organizationId: orgId, limit: PAGE, offset });
    for (const m of page.data) {
      const u = m.publicUserData;
      if (u?.userId) out.push({ userId: u.userId, firstName: u.firstName, lastName: u.lastName, role: m.role });
    }
    if (page.data.length === 0 || offset + page.data.length >= page.totalCount) break;
  }
  return out.slice(0, MAX_MEMBERS);
};

export class TeamAccessError extends Error {
  constructor() {
    super("The team list is for Growth Capital admins");
    this.name = "TeamAccessError";
  }
}

const rank = (r: Role | null) => (r === null ? ROLES.length : ROLES.indexOf(r));

// The brand's people, the most access first, then by name. Throws TeamAccessError for anyone but a gc_admin, and lets a failed Clerk
// call through, so the page can say it could not load the list.
export async function getTeam(ctx: TenantContext, deps: { fetchMembers?: FetchMembers } = {}): Promise<Team> {
  if (!canViewTeam(ctx)) throw new TeamAccessError();
  const raw = await (deps.fetchMembers ?? clerkMembers)(ctx.orgId);
  const members: TeamMember[] = raw.map((m) => ({
    userId: m.userId,
    name: displayName({ id: m.userId, firstName: m.firstName, lastName: m.lastName, username: null }),
    role: roleFromClerk(m.role),
  }));
  members.sort((a, b) => rank(a.role) - rank(b.role) || (a.name ?? "￿").localeCompare(b.name ?? "￿") || a.userId.localeCompare(b.userId));
  const counts = { gc_admin: 0, gc_partner: 0, client_viewer: 0 } satisfies Record<Role, number>;
  let noAccess = 0;
  for (const m of members) {
    if (m.role) counts[m.role] += 1;
    else noAccess += 1;
  }
  return { members, total: members.length, counts, noAccess };
}
