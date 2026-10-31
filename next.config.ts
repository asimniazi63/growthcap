import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The seed scripts, fixtures and docs aren't part of the app bundle.
  outputFileTracingExcludes: { "*": ["fixtures/**", "scripts/**", "docs/**"] },
  // Theme Check and the PDF reader load their own files at run time, so they stay outside the bundle; Theme Check reads its bundled docs.
  serverExternalPackages: ["@shopify/theme-check-node", "@shopify/theme-check-docs-updater", "unpdf"],
  outputFileTracingIncludes: { "/api/chat": ["./node_modules/@shopify/theme-check-docs-updater/data/**", "./node_modules/@shopify/theme-check-node/configs/**", "./node_modules/@shopify/theme-check-node/dist/**"] },
};

export default nextConfig;
