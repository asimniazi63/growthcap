import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CAPABILITIES } from "@/lib/team/permissions";
import type { Team } from "@/lib/team/team";
import { TeamView } from "./team-view";

const TEAM: Team = {
  members: [
    { userId: "user_a", name: "Asim Hameed Khan", role: "gc_admin" },
    { userId: "user_p1", name: "Priya Nair", role: "gc_partner" },
    { userId: "user_c1", name: "Sofia Marin", role: "client_viewer" },
  ],
  total: 3,
  counts: { gc_admin: 1, gc_partner: 1, client_viewer: 1 },
  noAccess: 0,
};

const html = (team: Team, me = "user_other") => renderToStaticMarkup(<TeamView team={team} me={me} />);
const plain = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const rowOf = (markup: string, text: string) => markup.slice(markup.lastIndexOf("<tr", markup.indexOf(text)), markup.indexOf("</tr>", markup.indexOf(text)));

describe("TeamView", () => {
  it("shows the number of users, in total and for each role", () => {
    const out = html({ ...TEAM, members: [...TEAM.members, { userId: "user_p2", name: "Daniel Okoye", role: "gc_partner" }], total: 4, counts: { gc_admin: 1, gc_partner: 2, client_viewer: 1 } });
    const counts = out.slice(out.indexOf('<div class="grid'), out.indexOf("</section>"));
    expect(plain(counts)).toBe("Users 4 GC admins 1 GC partners 2 Client viewers 1");
  });

  it("lists every person with their name and a role badge", () => {
    const out = html(TEAM);
    expect(plain(rowOf(out, "Asim Hameed Khan"))).toBe("Asim Hameed Khan GC admin");
    expect(plain(rowOf(out, "Priya Nair"))).toBe("Priya Nair GC partner");
    expect(plain(rowOf(out, "Sofia Marin"))).toBe("Sofia Marin Client viewer");
    expect(out).toContain("badge-brand"); // the admin's badge
  });

  it("marks the signed-in person", () => {
    expect(plain(rowOf(html(TEAM, "user_p1"), "Priya Nair"))).toBe("Priya Nair You GC partner");
    expect(html(TEAM)).not.toContain(">You<");
  });

  it("says no name is set, and keeps the end of the id so two such people can be told apart", () => {
    const out = html({ ...TEAM, members: [{ userId: "user_2abcdefghTL6tT", name: null, role: "gc_partner" }], total: 1, counts: { gc_admin: 0, gc_partner: 1, client_viewer: 0 } });
    expect(plain(out)).toContain("No name set user …hTL6tT GC partner");
  });

  it("shows No access for a member the app gives no access, with a note, and counts them", () => {
    const out = html({ ...TEAM, members: [...TEAM.members, { userId: "user_n", name: "Sam Builtin", role: null }], total: 4, noAccess: 1 });
    expect(plain(rowOf(out, "Sam Builtin"))).toBe("Sam Builtin No access");
    expect(plain(out)).toContain("No access 1");
    expect(plain(out)).toContain("cannot open this app");
  });

  it("leaves the No access count and note out when everyone has a role", () => {
    const out = plain(html(TEAM));
    expect(out).not.toContain("No access");
    expect(out).not.toContain("cannot open this app");
  });

  it("draws the permission grid: a tick or a dash for each role, with words for a screen reader", () => {
    const out = html(TEAM);
    const grid = out.slice(out.indexOf('aria-labelledby="team-can-do"'));
    expect(plain(grid)).toContain("Can they Admin Partner Viewer");
    for (const c of CAPABILITIES) expect(plain(grid)).toContain(c.label);
    const team = rowOf(grid, "See this Team page");
    expect(team.match(/>Yes</g)).toHaveLength(1);
    expect(team.match(/>No</g)).toHaveLength(2);
    expect(rowOf(grid, "Chat, Pace, EBITDA").match(/>Yes</g)).toHaveLength(3);
  });

  it("says so when the brand has no one, instead of drawing an empty table", () => {
    const out = html({ members: [], total: 0, counts: { gc_admin: 0, gc_partner: 0, client_viewer: 0 }, noAccess: 0 });
    expect(plain(out)).toContain("No one is in this brand yet");
    expect(out.slice(0, out.indexOf('aria-labelledby="team-can-do"'))).not.toContain("<thead");
  });

  it("writes a name as text: markup in it is escaped", () => {
    const out = html({ ...TEAM, members: [{ userId: "user_x", name: "<img src=x onerror=alert(1)>", role: "gc_partner" }], total: 1, counts: { gc_admin: 0, gc_partner: 1, client_viewer: 0 } });
    expect(out).not.toContain("<img");
    expect(out).toContain("&lt;img");
  });
});
