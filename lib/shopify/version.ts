// The Admin API version every call uses. shopify.app.toml pins the same value under [webhooks] api_version,
// and version.test.ts fails if the two drift apart.
export const SHOPIFY_API_VERSION = "2026-10";
