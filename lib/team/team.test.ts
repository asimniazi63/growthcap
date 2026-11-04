import { describe, expect, it, vi } from "vitest";
import { canAudit } from "../audit/store";
import { canManageNotes } from "../call-notes/access";
import { canEditCostSheet } from "../ebitda/access";
import { canManagePlan } from "../plan-in/store";
import { canRunPlaybooks } from "../playbooks/store";
import { canViewSegments } from "../segments/access";
import { canResync } from "../sync/run";
import { ROLES, type Role, type TenantContext } from "../tenancy/context";
import { GC_ONLY_PAGES } from "../../components/shell/pages";
import { CAPABILITIES, ROLE_LABEL, ROLE_SHORT } from "./permissions";
import { canViewTeam, getTeam, TeamAccessError, type RawMember } from "./team";

const ctxOf = (role: Role): TenantContext => ({ tenantId: "t1", orgId: "org_solenne", userId: "user_me", role, shop: null });
const member = (userId: string, role: string, firstName: string | null = null, lastName: string | null = null): RawMember => ({ userId, firstName, lastName, role });

const SAMPLE: RawMember[] = [
  member("user_c", "org:client_viewer", "Sofia", "Marin"),
  member("user_a", "org:gc_admin", "Asim", "Hameed Khan"),
  member("user_p2", "org:gc_partner", "Daniel", "Okoye"),
  member("user_p1", "org:gc_partner", "Priya", "Nair"),
  member("user_n", "org:member", "Sam", "Builtin"),
  member("user_c2", "org:client_viewer", "Tom", "Reyes"),
];

describe("getTeam", () => {
  it("lists the brand's people, the most access first and then by name, and counts them by role", async () => {
    const team = await getTeam(ctxOf("gc_admin"), { fetchMembers: async () => SAMPLE });
    expect(team.members.map((m) => [m.name, m.role])).toEqual([
      ["Asim Hameed Khan", "gc_admin"],
      ["Daniel Okoye", "gc_partner"],
      ["Priya Nair", "gc_partner"],
      ["Sofia Marin", "client_viewer"],
      ["Tom Reyes", "client_viewer"],
      ["Sam Builtin", null],
    ]);
    expect(team.total).toBe(6);
    expect(team.counts).toEqual({ gc_admin: 1, gc_partner: 2, client_viewer: 2 });
    expect(team.noAccess).toBe(1);
    expect(Object.values(team.counts).reduce((a, b) => a + b, 0) + team.noAccess).toBe(team.total);
  });

  it("asks Clerk about the organisation in the session, never one from anywhere else", async () => {
    const fetchMembers = vi.fn(async () => SAMPLE);
    await getTeam(ctxOf("gc_admin"), { fetchMembers });
    expect(fetchMembers).toHaveBeenCalledExactlyOnceWith("org_solenne");
  });

  it("refuses a GC partner and a client viewer without calling Clerk", async () => {
    for (const role of ["gc_partner", "client_viewer"] as const) {
      const fetchMembers = vi.fn(async () => SAMPLE);
      await expect(getTeam(ctxOf(role), { fetchMembers })).rejects.toBeInstanceOf(TeamAccessError);
      expect(fetchMembers).not.toHaveBeenCalled();
    }
  });

  it("lets a failed Clerk call through, so the page can say it could not load", async () => {
    await expect(
      getTeam(ctxOf("gc_admin"), {
        fetchMembers: async () => {
          throw new Error("Clerk is down");
        },
      }),
    ).rejects.toThrow("Clerk is down");
  });

  it("shows no name for a person who has set none, last in their role, and keeps the id so the row can be told apart", async () => {
    const team = await getTeam(ctxOf("gc_admin"), { fetchMembers: async () => [member("user_z", "org:gc_partner"), member("user_y", "org:gc_partner", "Ana", null), member("user_x", "org:gc_partner", "  ", " ")] });
    expect(team.members.map((m) => [m.userId, m.name])).toEqual([
      ["user_y", "Ana"],
      ["user_x", null],
      ["user_z", null],
    ]);
  });

  it("copes with an empty organisation", async () => {
    const team = await getTeam(ctxOf("gc_admin"), { fetchMembers: async () => [] });
    expect(team).toEqual({ members: [], total: 0, counts: { gc_admin: 0, gc_partner: 0, client_viewer: 0 }, noAccess: 0 });
  });

  it("carries nothing but an id, a name and a role: no email address", async () => {
    const withEmail = [{ ...member("user_a", "org:gc_admin", "Asim", "Khan"), identifier: "asim@example.com" }] as unknown as RawMember[];
    const team = await getTeam(ctxOf("gc_admin"), { fetchMembers: async () => withEmail });
    expect(Object.keys(team.members[0]!).sort()).toEqual(["name", "role", "userId"]);
    expect(JSON.stringify(team)).not.toContain("example.com");
  });
});

describe("canViewTeam", () => {
  it("is for a GC admin alone", () => {
    expect(ROLES.filter((role) => canViewTeam({ role }))).toEqual(["gc_admin"]);
  });
});

// The grid on the page must say what the code does. Each row below is checked against the helper that makes the real decision.
describe("CAPABILITIES: the permission grid matches the checks the app makes", () => {
  const rolesOf = (label: string) => CAPABILITIES.find((c) => c.label === label)?.roles ?? null;
  const allowed = (check: (role: Role) => boolean) => ROLES.filter(check);

  it("gives every role a label, and no role is missing from the grid's columns", () => {
    expect(Object.keys(ROLE_LABEL).sort()).toEqual([...ROLES].sort());
    expect(Object.keys(ROLE_SHORT).sort()).toEqual([...ROLES].sort());
  });

  it.each([
    ["Add call notes and confirm remembered facts", (role: Role) => canManageNotes({ role })],
    ["Edit plan targets and the EBITDA cost sheet", (role: Role) => canManagePlan(ctxOf(role)) && canEditCostSheet({ role })],
    ["Resync a store", (role: Role) => canResync(role)],
    ["Portfolio, Audit, Playbooks, Segments, Plan and Actions", (role: Role) => canAudit({ role }) && canRunPlaybooks({ role }) && canViewSegments({ role })],
    ["See this Team page", (role: Role) => canViewTeam({ role })],
  ])("%s", (label, check) => {
    expect(rolesOf(label)).toEqual(allowed(check));
  });

  it("names every page the sidebar keeps from a client viewer in the Growth Capital pages row", () => {
    const row = CAPABILITIES.find((c) => c.roles.length === 2 && c.label.startsWith("Portfolio"))!;
    for (const href of GC_ONLY_PAGES) expect(row.label.toLowerCase(), href).toContain(href.slice(1));
  });

  it("lists each capability once, and never a role that is not real", () => {
    expect(new Set(CAPABILITIES.map((c) => c.label)).size).toBe(CAPABILITIES.length);
    for (const c of CAPABILITIES) for (const r of c.roles) expect(ROLES).toContain(r);
  });
});
