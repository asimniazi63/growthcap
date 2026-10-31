import { describe, expect, it } from "vitest";
import { isAllowedLink, linkClaims, provenanceId } from "./links";

describe("isAllowedLink: where an answer may link to", () => {
  it("allows the app's own pages and the Shopify admin, over https", () => {
    for (const ok of ["/connect", "/chat?q=1", "/", "https://admin.shopify.com/store/solenne/orders/123", "https://solenne-cmlzfrsf.myshopify.com/admin/orders/1"]) {
      expect(isAllowedLink(ok), ok).toBe(true);
    }
  });

  it("refuses everything else, including look-alike hosts and non-http schemes", () => {
    for (const bad of [
      "https://evil.test/",
      "http://admin.shopify.com/x",
      "//evil.test/path",
      "/\\evil.test",
      "javascript:alert(1)",
      "data:text/html,<script>1</script>",
      "mailto:a@b.co",
      "https://admin.shopify.com.evil.test/",
      "https://evil.test/admin.shopify.com",
      "https://x.myshopify.com.evil.test/admin",
      "https://x.myshopify.com/not-admin",
      "https://user:pw@admin.shopify.com/",
      "",
      "relative/path",
    ]) {
      expect(isAllowedLink(bad), bad).toBe(false);
    }
  });
});

describe("linkClaims", () => {
  const text = "Net sales were $12,340 on 41 orders.";
  it("wraps each matched number in a link the page turns into a provenance button", () => {
    const out = linkClaims(text, [
      { span: [15, 22], value: 12340, queryId: "q_aaaaaaaaaaaa" },
      { span: [26, 28], value: 41, queryId: "q_bbbbbbbbbbbb" },
    ]);
    expect(out).toBe("Net sales were [$12,340](provenance:q_aaaaaaaaaaaa) on [41](provenance:q_bbbbbbbbbbbb) orders.");
  });
  it("leaves the text alone when nothing matched, and skips overlapping spans", () => {
    expect(linkClaims(text, [])).toBe(text);
    const out = linkClaims(text, [
      { span: [15, 22], value: 1, queryId: "q_aaaaaaaaaaaa" },
      { span: [17, 20], value: 2, queryId: "q_bbbbbbbbbbbb" },
    ]);
    expect(out).toBe("Net sales were [$12,340](provenance:q_aaaaaaaaaaaa) on 41 orders.");
  });
});

describe("provenanceId", () => {
  it("reads a query id from a provenance link, and nothing else", () => {
    expect(provenanceId("provenance:q_0123456789ab")).toBe("q_0123456789ab");
    expect(provenanceId("provenance:../../x")).toBeNull();
    expect(provenanceId("https://evil.test")).toBeNull();
  });
});
