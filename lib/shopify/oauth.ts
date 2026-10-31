import "@shopify/shopify-api/adapters/web-api";
import { ApiVersion, shopifyApi } from "@shopify/shopify-api";
import { REQUIRED_SCOPES } from "./connect";
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
    scopes: [...REQUIRED_SCOPES],
    hostName: new URL(env("SHOPIFY_APP_URL")).host,
    hostScheme: "https",
    apiVersion: SHOPIFY_API_VERSION as ApiVersion,
    isEmbeddedApp: false,
  });
  return cached;
}

export const CALLBACK_PATH = "/api/shopify/callback";
