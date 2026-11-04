import type { Role } from "../tenancy/context";

// What each role can do, for the grid on the Team page. These are the rows of the access table in the product plan, written as the
// checks the app really makes (the can* helpers in lib/, and the page lists in components/shell/pages.ts). Change a check, change a row.

export const ROLE_LABEL: Record<Role, string> = {
  gc_admin: "GC admin",
  gc_partner: "GC partner",
  client_viewer: "Client viewer",
};

export const ROLE_SHORT: Record<Role, string> = {
  gc_admin: "Admin",
  gc_partner: "Partner",
  client_viewer: "Viewer",
};

export interface Capability {
  label: string;
  roles: readonly Role[]; // the roles that can do it
}

const ALL: readonly Role[] = ["gc_admin", "gc_partner", "client_viewer"];
const GC: readonly Role[] = ["gc_admin", "gc_partner"];
const ADMIN: readonly Role[] = ["gc_admin"];

export const CAPABILITIES: readonly Capability[] = [
  { label: "Chat, Pace, EBITDA and approved Briefs", roles: ALL },
  { label: "Portfolio, Audit, Playbooks, Segments, Plan and Actions", roles: GC },
  { label: "Add call notes and confirm remembered facts", roles: GC },
  { label: "Edit plan targets and the EBITDA cost sheet", roles: GC },
  { label: "Approve changes to Shopify and weekly briefs", roles: GC },
  { label: "Resync a store", roles: GC },
  { label: "Connect or reconnect a store", roles: ADMIN },
  { label: "See this Team page", roles: ADMIN },
];
