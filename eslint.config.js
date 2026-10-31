import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["node_modules", ".next", "fixtures", "coverage", ".seed-journal"] },
  ...tseslint.configs.recommended,
);
