import "@shopify/shopify-api/adapters/web-api";
import { ApiVersion, shopifyApi } from "@shopify/shopify-api";
import { REQUESTED_SCOPES } from "./connect";
import { SHOPIFY_API_VERSION } from "./version";

type ShopifyApi = ReturnType<typeof shopifyApi>;
let cached: ShopifyApi | undefined;

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

// @shopify/shopify-api checks the OAuth state, the HMAC and the shop domain. Not embedded; offline (non-expiring) token.
export function shopify(): ShopifyApi {
  cached ??= shopifyApi({
    apiKey: env("SHOPIFY_API_KEY"),
    apiSecretKey: env("SHOPIFY_API_SECRET"),
    scopes: [...REQUESTED_SCOPES],
    hostName: new URL(env("SHOPIFY_APP_URL")).host,
    hostScheme: "https",
    apiVersion: SHOPIFY_API_VERSION as ApiVersion,
    isEmbeddedApp: false,
  });
  return cached;
}

export const CALLBACK_PATH = "/api/shopify/callback";

// The library's state cookie lives for 60 seconds. That is enough when Shopify redirects straight back, but not when it shows
// a permission screen the person has to read (a new scope), and then the callback finds no cookie. This gives the same signed
// cookie a longer life; nothing else about it changes.
export const STATE_COOKIE_LIFETIME_SECONDS = 600;

export function extendStateCookie(response: Response, now: number = Date.now()): Response {
  const headers = new Headers();
  response.headers.forEach((value, key) => {
    if (key.toLowerCase() !== "set-cookie") headers.append(key, value);
  });
  const expires = new Date(now + STATE_COOKIE_LIFETIME_SECONDS * 1000).toUTCString();
  for (const cookie of response.headers.getSetCookie()) {
    headers.append("set-cookie", `${cookie.replace(/;\s*expires=[^;]*/i, `; expires=${expires}`).replace(/;\s*max-age=[^;]*/i, "")}; max-age=${STATE_COOKIE_LIFETIME_SECONDS}`);
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
