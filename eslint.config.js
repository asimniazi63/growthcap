import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const config = [
  { ignores: ["node_modules", ".next", "fixtures", "coverage", ".seed-journal", "drizzle", "next-env.d.ts"] },
  ...nextVitals,
  ...nextTs,
];

export default config;
