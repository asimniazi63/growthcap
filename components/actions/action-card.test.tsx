import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { LedgerView } from "@/lib/actions/ledger";
import { ActionCard, personLabel } from "./action-card";

const base: LedgerView = {
  id: "a1",
  kind: "landing_page",
  status: "proposed",
  title: "Add a spring page",
  diff: {
    summary: "Create the page /pages/spring",
    rows: [{ label: "Page", before: "(none)", after: "spring" }],
    files: [{ path: "templates/page.spring.liquid", content: "<h1>{{ page.title }}</h1>" }],
    notes: ["Theme Check passed"],
    mutations: [{ name: "pageCreate", query: "mutation { pageCreate }", variables: { title: "Spring" } }],
  },
  hypothesis: "A page for the spring range should lift conversion.",
  metric: "conversion_rate",
  checkOn: "2026-11-14",
  owner: "user_2abcdefghij",
  dryRun: false,
  createdAt: "2026-11-01T10:00:00.000Z",
};

const html = (over: Partial<LedgerView> = {}, canDecide = true) => renderToStaticMarkup(<ActionCard action={{ ...base, ...over }} canDecide={canDecide} />);

describe("ActionCard", () => {
  it("shows the change, the files collapsed, the checks and the reasoning, with Approve and Reject for a person who can decide", () => {
    const out = html();
    expect(out).toContain("Add a spring page");
    expect(out).toContain("Create the page /pages/spring");
    expect(out).toContain("Theme Check passed");
    expect(out).toContain("conversion_rate");
    expect(out).toContain("2026-11-14");
    expect(out).toContain("<details");
    expect(out).not.toContain("<details open");
    expect(out).toContain("Approve");
    expect(out).toContain("Reject");
  });

  it("shows no buttons to someone who can't decide, only that it is waiting", () => {
    const out = html({}, false);
    expect(out).not.toContain("<button");
    expect(out).toContain("Waiting for a Growth Capital admin or partner");
  });

  it("escapes markup in the diff, the files and the title, which came from the model", () => {
    const out = html({
      title: "<img src=x onerror=alert(1)>",
      diff: { summary: "<script>alert(1)</script>", rows: [{ label: "<b>x</b>", after: "<i>y</i>" }], files: [{ path: "a.liquid", content: "<script>steal()</script>" }] },
    });
    expect(out).not.toContain("<script>");
    expect(out).not.toContain("<img");
    expect(out).not.toContain("<i>y</i>");
    expect(out).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(out).toContain("&lt;script&gt;steal()&lt;/script&gt;");
  });

  it("says a dry run sent nothing to Shopify and shows the exact mutations and variables", () => {
    const out = html({ status: "done", dryRun: true, decidedBy: "user_2reviewer00", result: { dryRun: true, mutations: [{ name: "pageCreate", query: "mutation { pageCreate(page: $page) }", variables: { page: { title: "Spring" } } }] } });
    expect(out).toContain("Dry run: nothing was sent to Shopify");
    expect(out).toContain("pageCreate(page: $page)");
    expect(out).toContain("&quot;title&quot;: &quot;Spring&quot;");
    expect(out).not.toContain("<button");
  });

  it("shows a failure and a rejection without buttons", () => {
    expect(html({ status: "failed", error: "Title is too long" })).toContain("Failed: Title is too long");
    const rejected = html({ status: "rejected", decidedBy: "user_2abcdefghij" });
    expect(rejected).toContain("Rejected by");
    expect(rejected).not.toContain("<button");
  });
});

// Who proposed and who decided. A ledger row keeps the Clerk user ids; the Actions page looks the names up and passes them in, so the
// card says "Asim Hameed Khan" instead of "user …4abcde", in bold. Names are text a person typed in their own profile, so they are
// escaped like everything else on the card.
describe("who proposed and who decided", () => {
  const people = { user_2abcdefghij: "Asim Hameed Khan", user_2reviewer00: "Reviewer Partner" };
  const card = (over: Partial<LedgerView>, me?: string, names?: Record<string, string>) => renderToStaticMarkup(<ActionCard action={{ ...base, ...over }} canDecide me={me} names={names} />);
  const plain = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const done = { status: "done" as const, decidedBy: "user_2reviewer00", decidedAt: "2026-11-01T11:00:00.000Z" };

  it("shows each person's name in bold, for who proposed and who approved, not the end of their id", () => {
    const out = card(done, undefined, people);
    expect(out).toMatch(/Proposed by <strong[^>]*>Asim Hameed Khan<\/strong>/);
    expect(out).toMatch(/Approved by <strong[^>]*>Reviewer Partner<\/strong>/);
    expect(plain(out)).toContain("Proposed by Asim Hameed Khan on 2026-11-01 · Approved by Reviewer Partner on 2026-11-01");
    expect(out).not.toContain("user …");
  });

  it("says you, in bold, for the signed-in person, even when their name is known", () => {
    const out = card(done, "user_2abcdefghij", people);
    expect(out).toMatch(/Proposed by <strong[^>]*>you<\/strong>/);
    expect(out).not.toContain("Asim Hameed Khan");
  });

  it("falls back to the end of the id, still in bold, when no name is known", () => {
    const out = card(done, undefined, { user_2abcdefghij: "Asim Hameed Khan" });
    expect(out).toMatch(/Approved by <strong[^>]*>user …ewer00<\/strong>/);
    const none = card(done);
    expect(none).toMatch(/Proposed by <strong[^>]*>user …efghij<\/strong>/);
  });

  it("names the approver in the dry-run note too", () => {
    const out = card({ ...done, dryRun: true, result: { dryRun: true, mutations: [] } }, undefined, people);
    expect(plain(out)).toContain("Approved by Reviewer Partner on a reviewer login");
  });

  it("writes a name as text: markup in it is escaped", () => {
    const out = card(done, undefined, { user_2abcdefghij: "<img src=x onerror=alert(1)>", user_2reviewer00: "<b>x</b>" });
    expect(out).not.toContain("<img");
    expect(out).not.toContain("<b>x</b>");
    expect(out).toContain("&lt;img");
  });
});

describe("personLabel", () => {
  it("says you for the signed-in person, a known name for anyone else, and the end of the id when there is no name", () => {
    expect(personLabel("user_2abcdefghij", "user_2abcdefghij", { user_2abcdefghij: "Asim" })).toBe("you");
    expect(personLabel("user_2abcdefghij", "someone_else", { user_2abcdefghij: "Asim Hameed Khan" })).toBe("Asim Hameed Khan");
    expect(personLabel("user_2abcdefghij", "someone_else", {})).toBe("user …efghij");
    expect(personLabel("user_2abcdefghij")).toBe("user …efghij");
    expect(personLabel("short")).toBe("short");
    expect(personLabel(null)).toBe("—");
    expect(personLabel(undefined, "me", { x: "y" })).toBe("—");
  });

  it("does not read a name off the prototype for an id like constructor", () => {
    expect(personLabel("constructor", "me", {})).toBe("constructor");
    expect(personLabel("__proto__", "me", {})).toBe("__proto__");
  });
});
