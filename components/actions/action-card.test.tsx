import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { LedgerView } from "@/lib/actions/ledger";
import { ActionCard } from "./action-card";

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
