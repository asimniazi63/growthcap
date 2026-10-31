import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { SHOPIFY_API_VERSION } from "./version";

// The value of `api_version` inside the [webhooks] table of shopify.app.toml.
function webhooksApiVersion(toml: string): string | undefined {
  let table = "";
  for (const raw of toml.split("\n")) {
    const line = raw.trim();
    const header = line.match(/^\[\[?([^\]]+)\]\]?$/);
    if (header) {
      table = header[1]!.trim();
      continue;
    }
    const value = line.match(/^api_version\s*=\s*"([^"]+)"/);
    if (value && table === "webhooks") return value[1];
  }
  return undefined;
}

describe("Shopify API version", () => {
  it("is pinned to 2026-10", () => {
    expect(SHOPIFY_API_VERSION).toBe("2026-10");
  });

  it("matches the webhooks api_version in shopify.app.toml", () => {
    const toml = readFileSync(resolve(__dirname, "../../shopify.app.toml"), "utf8");
    expect(webhooksApiVersion(toml)).toBe(SHOPIFY_API_VERSION);
  });

  it("reads only the [webhooks] table, ignoring an api_version elsewhere", () => {
    const toml = ['[other]', 'api_version = "1999-01"', "", "[webhooks]", 'api_version = "2026-10"'].join("\n");
    expect(webhooksApiVersion(toml)).toBe("2026-10");
  });
});
