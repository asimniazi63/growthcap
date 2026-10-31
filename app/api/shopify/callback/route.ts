import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { shopifyGraphql } from "@/lib/shopify/client";
import { connectShop } from "@/lib/shopify/connect";
import { shopify } from "@/lib/shopify/oauth";
import { getTenantContext } from "@/lib/tenancy/context";

// Public route in proxy.ts: Shopify redirects here. The library verifies the state cookie, the HMAC and the shop
// domain; the tenant still comes from the Clerk session, never from the query string.
export async function GET(request: Request) {
  const finish = (error: string | null, headers?: Headers) => {
    const response = NextResponse.redirect(new URL(error ? `/connect?error=${error}` : "/connect?connected=1", request.url));
    headers?.forEach((value, key) => response.headers.append(key, value));
    return response;
  };

  let grant;
  try {
    grant = await shopify().auth.callback({ rawRequest: request });
  } catch {
    return finish("oauth_failed");
  }
  const { session, headers } = grant;
  const cookies = headers as Headers;

  let ctx;
  try {
    ctx = await getTenantContext();
  } catch {
    return finish("no_tenant", cookies);
  }
  if (ctx.role !== "gc_admin") return finish("forbidden", cookies);

  const conn = { shopDomain: session.shop, accessToken: session.accessToken ?? "" };
  let info;
  try {
    const data = await shopifyGraphql<{ shop: { ianaTimezone: string; currencyCode: string } }>(conn, "{ shop { ianaTimezone currencyCode } }");
    info = { timezone: data.shop.ianaTimezone, currency: data.shop.currencyCode };
  } catch {
    return finish("shop_unreachable", cookies);
  }

  const result = await connectShop({
    db: getDb(),
    tenantId: ctx.tenantId,
    shopDomain: session.shop,
    accessToken: conn.accessToken,
    scope: session.scope ?? "",
    shopInfo: info,
  });
  return finish(result.ok ? null : result.reason, cookies);
}
