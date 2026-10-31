import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The seed scripts, fixtures and docs aren't part of the app bundle.
  outputFileTracingExcludes: { "*": ["fixtures/**", "scripts/**", "docs/**"] },
};

export default nextConfig;
