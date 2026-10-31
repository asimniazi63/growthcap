import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  test: {
    include: ["**/*.test.{ts,tsx}"],
    exclude: ["node_modules", ".next"],
    // Each database test boots an in-memory Postgres (PGlite) and applies the migrations, which takes seconds
    // when the machine is busy. The default 5 s timeout made that flaky.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
