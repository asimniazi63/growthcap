import { ROLES, type Role } from "../tenancy/context";

// The brands a person can see on the portfolio are the organisations they belong to, with the role they hold in each. The
// list comes from Clerk's backend API for the signed-in user; no request ever supplies it. Tests inject their own.
export interface OrgRole {
  orgId: string;
  role: Role;
}
export type MembershipsFn = (userId: string) => Promise<OrgRole[]>;

// Clerk sends the role as "org:<key>". The built-in org:admin and org:member give no access here.
export function roleFromClerk(orgRole: string): Role | null {
  const key = orgRole.startsWith("org:") ? orgRole.slice("org:".length) : null;
  return ROLES.find((r) => r === key) ?? null;
}

const PAGE = 100;

export const clerkMemberships: MembershipsFn = async (userId) => {
  // Loaded lazily so that code and tests that inject their own list never pull in Clerk.
  const { clerkClient } = await import("@clerk/nextjs/server");
  const client = await clerkClient();
  const out: OrgRole[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const page = await client.users.getOrganizationMembershipList({ userId, limit: PAGE, offset });
    for (const m of page.data) {
      const role = roleFromClerk(m.role);
      if (role) out.push({ orgId: m.organization.id, role });
    }
    if (page.data.length === 0 || offset + page.data.length >= page.totalCount) return out;
  }
};
