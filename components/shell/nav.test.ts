import { describe, expect, it } from "vitest";
import { FOOTER_ITEMS, navGroups } from "./nav";
import { GC_ONLY_PAGES } from "./pages";

const hrefs = (gc: boolean) => navGroups(gc).flatMap((g) => g.items.map((i) => i.href));

describe("navGroups: the sidebar only links to pages the person may open", () => {
  it("shows Growth Capital staff every page, including the ones that are theirs alone", () => {
    expect(hrefs(true)).toEqual(["/overview", "/chat", "/pace", "/ebitda", "/portfolio", "/briefs", "/audit", "/playbooks", "/segments", "/plan", "/actions"]);
  });

  it("hides Portfolio, Audit, Playbooks, Segments, Plan and Actions from everyone else, and drops the group that would be empty", () => {
    expect(hrefs(false)).toEqual(["/overview", "/chat", "/pace", "/ebitda", "/briefs"]);
    expect(navGroups(false).map((g) => g.label)).toEqual(["", "Ask", "Track"]);
  });

  it("offers EBITDA to every role, straight after Pace: a client viewer can read the page, and only the cost sheet on it is locked", () => {
    for (const gc of [true, false]) {
      const list = hrefs(gc);
      expect(list.indexOf("/ebitda")).toBe(list.indexOf("/pace") + 1);
    }
    expect(GC_ONLY_PAGES).not.toContain("/ebitda");
  });

  it("hides exactly the pages in the shared Growth-Capital-only list, which the command palette also reads", () => {
    const hidden = hrefs(true).filter((h) => !hrefs(false).includes(h));
    expect(hidden.sort()).toEqual([...GC_ONLY_PAGES].sort());
  });

  it("keeps Connect and Settings at the foot for everyone, and Settings is not one of the Growth-Capital-only pages", () => {
    expect(FOOTER_ITEMS.map((i) => i.href)).toEqual(["/connect", "/settings"]);
    expect(GC_ONLY_PAGES).not.toContain("/settings");
    expect(hrefs(false)).not.toContain("/settings");
    expect(hrefs(true)).not.toContain("/settings");
  });
});
