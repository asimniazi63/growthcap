import { CookieNotFound } from "@shopify/shopify-api";
import { after, NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { shopifyGraphql } from "@/lib/shopify/client";
import { connectShop } from "@/lib/shopify/connect";
import { shopify } from "@/lib/shopify/oauth";
import { startSync } from "@/lib/sync/run";
import { getTenantContext } from "@/lib/tenancy/context";

export const maxDuration = 300; // the first sync runs after the redirect, in this same invocation

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
  } catch (e) {
    // The reason is a class name or a short code, never a token or a query value.
    console.error("[shopify] the OAuth callback failed:", e instanceof Error ? (e.constructor?.name ?? e.name) : "unknown");
    return finish(e instanceof CookieNotFound ? "oauth_expired" : "oauth_failed");
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
  if (result.ok) {
    // The first sync starts as soon as the store is connected. A failure to start it must not undo the connection.
    await startSync(getDb(), ctx.tenantId, (work) => after(work)).catch(() => undefined);
  }
  return finish(result.ok ? null : result.reason, cookies);
}
