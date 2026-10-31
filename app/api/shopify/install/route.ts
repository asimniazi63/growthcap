import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/tenancy/context";
import { CALLBACK_PATH, shopify } from "@/lib/shopify/oauth";

// Starts the OAuth install. Only a gc_admin can do this, and the tenant comes from the Clerk session.
export async function GET(request: Request) {
  const back = (error: string) => NextResponse.redirect(new URL(`/connect?error=${error}`, request.url));

  let role: string;
  try {
    role = (await getTenantContext()).role;
  } catch {
    return back("no_tenant");
  }
  if (role !== "gc_admin") return back("forbidden");

  const shop = shopify().utils.sanitizeShop(new URL(request.url).searchParams.get("shop") ?? "", false);
  if (!shop) return back("invalid_shop");

  return shopify().auth.begin({ shop, callbackPath: CALLBACK_PATH, isOnline: false, rawRequest: request });
}
