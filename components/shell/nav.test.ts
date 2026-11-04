import { describe, expect, it } from "vitest";
import { footerItems, navGroups } from "./nav";
import { ADMIN_ONLY_PAGES, canOpenPage, GC_ONLY_PAGES } from "./pages";

const hrefs = (gc: boolean) => navGroups(gc).flatMap((g) => g.items.map((i) => i.href));

describe("navGroups: the sidebar only links to pages the person may open", () => {
  it("shows Growth Capital staff every page, including the ones that are theirs alone", () => {
    expect(hrefs(true)).toEqual(["/overview", "/chat", "/pace", "/portfolio", "/briefs", "/audit", "/playbooks", "/segments", "/ebitda", "/plan", "/actions"]);
  });

  it("hides Portfolio, Audit, Playbooks, Segments, Plan and Actions from everyone else, and drops the group that would be empty", () => {
    expect(hrefs(false)).toEqual(["/overview", "/chat", "/pace", "/briefs", "/ebitda"]);
    expect(navGroups(false).map((g) => g.label)).toEqual(["", "Ask", "Track"]);
  });

  it("offers EBITDA to every role, last in Track (below Segments for Growth Capital staff): a client viewer can read the page, and only the cost sheet on it is locked", () => {
    for (const gc of [true, false]) {
      const track = navGroups(gc).find((g) => g.label === "Track")!.items.map((i) => i.href);
      expect(track.at(-1), String(gc)).toBe("/ebitda");
    }
    expect(hrefs(true).indexOf("/ebitda")).toBe(hrefs(true).indexOf("/segments") + 1);
    expect(GC_ONLY_PAGES).not.toContain("/ebitda");
  });

  it("hides exactly the pages in the shared Growth-Capital-only list, which the command palette also reads", () => {
    const hidden = hrefs(true).filter((h) => !hrefs(false).includes(h));
    expect(hidden.sort()).toEqual([...GC_ONLY_PAGES].sort());
  });

  it("keeps Connect and Settings at the foot for everyone, and Settings is not one of the Growth-Capital-only pages", () => {
    for (const admin of [true, false]) {
      const foot = footerItems(admin).map((i) => i.href);
      expect(foot[0]).toBe("/connect");
      expect(foot.at(-1)).toBe("/settings");
    }
    expect(GC_ONLY_PAGES).not.toContain("/settings");
    expect(hrefs(false)).not.toContain("/settings");
    expect(hrefs(true)).not.toContain("/settings");
  });

  it("puts Team straight above Settings for a Growth Capital admin, and offers it to no one else", () => {
    expect(footerItems(true).map((i) => i.href)).toEqual(["/connect", "/team", "/settings"]);
    expect(footerItems(false).map((i) => i.href)).toEqual(["/connect", "/settings"]);
    expect(footerItems(true).find((i) => i.href === "/team")?.label).toBe("Team");
  });

  it("keeps the admin-only pages out of the main groups, and out of the Growth-Capital-only list (a partner is Growth Capital staff too)", () => {
    for (const href of ADMIN_ONLY_PAGES) {
      expect(hrefs(true)).not.toContain(href);
      expect(GC_ONLY_PAGES).not.toContain(href);
      expect(footerItems(true).map((i) => i.href)).toContain(href);
      expect(footerItems(false).map((i) => i.href)).not.toContain(href);
    }
  });
});

describe("canOpenPage: the command palette lists a page only for a person who may open it", () => {
  it("offers Team to a GC admin only", () => {
    expect(canOpenPage("/team", true, true)).toBe(true);
    expect(canOpenPage("/team", true, false)).toBe(false); // a GC partner
    expect(canOpenPage("/team", false, false)).toBe(false); // a client viewer
  });

  it("offers a Growth-Capital-only page to a partner and an admin, and not to a client viewer", () => {
    for (const href of GC_ONLY_PAGES) {
      expect(canOpenPage(href, true, true), href).toBe(true);
      expect(canOpenPage(href, true, false), href).toBe(true);
      expect(canOpenPage(href, false, false), href).toBe(false);
    }
  });

  it("offers every other page to everyone", () => {
    for (const href of ["/overview", "/chat", "/pace", "/ebitda", "/briefs", "/connect", "/settings"]) expect(canOpenPage(href, false, false), href).toBe(true);
  });
});
