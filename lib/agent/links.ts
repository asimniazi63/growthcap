// Links in an answer. Rendered answers may link only to this app and to the Shopify admin, so a link planted in store
// text (an order note, a product description) can't send the user anywhere else. Matched numbers become links of a
// private "provenance:" kind, which the page turns into buttons that open the popover.

const SHOPIFY_ADMIN_HOST = /^(admin\.shopify\.com|[a-z0-9][a-z0-9-]*\.myshopify\.com)$/;

export function isAllowedLink(href: string): boolean {
  if (href.startsWith("/")) return !href.startsWith("//") && !href.includes("\\");
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password) return false;
  if (!SHOPIFY_ADMIN_HOST.test(url.hostname)) return false;
  return url.hostname === "admin.shopify.com" || url.pathname.startsWith("/admin");
}

export interface MatchedClaim {
  span: [number, number];
  value: number;
  queryId: string;
}

// Wraps each matched number as [text](provenance:<queryId>). Spans that overlap an earlier one are skipped.
export function linkClaims(text: string, matched: MatchedClaim[]): string {
  const ordered = [...matched].sort((a, b) => a.span[0] - b.span[0]);
  let out = "";
  let cursor = 0;
  for (const m of ordered) {
    const [start, end] = m.span;
    if (start < cursor) continue;
    out += text.slice(cursor, start) + `[${text.slice(start, end)}](provenance:${m.queryId})`;
    cursor = end;
  }
  return out + text.slice(cursor);
}

export function provenanceId(href: string | undefined): string | null {
  const m = /^provenance:(q_[0-9a-f]{12})$/.exec(href ?? "");
  return m ? m[1]! : null;
}
