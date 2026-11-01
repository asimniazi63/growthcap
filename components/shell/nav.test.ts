import { describe, expect, it } from "vitest";
import { navGroups } from "./nav";
import { GC_ONLY_PAGES } from "./pages";

const hrefs = (gc: boolean) => navGroups(gc).flatMap((g) => g.items.map((i) => i.href));

describe("navGroups: the sidebar only links to pages the person may open", () => {
  it("shows Growth Capital staff every page, including the ones that are theirs alone", () => {
    expect(hrefs(true)).toEqual(["/overview", "/chat", "/pace", "/portfolio", "/briefs", "/audit", "/plan", "/actions"]);
  });

  it("hides Portfolio, Audit, Plan and Actions from everyone else, and drops the group that would be empty", () => {
    expect(hrefs(false)).toEqual(["/overview", "/chat", "/pace", "/briefs"]);
    expect(navGroups(false).map((g) => g.label)).toEqual(["", "Ask", "Track"]);
  });

  it("hides exactly the pages in the shared Growth-Capital-only list, which the command palette also reads", () => {
    const hidden = hrefs(true).filter((h) => !hrefs(false).includes(h));
    expect(hidden.sort()).toEqual([...GC_ONLY_PAGES].sort());
  });
});
