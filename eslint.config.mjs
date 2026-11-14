import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // Next's rules locate the app's pages directory from the monorepo root.
    settings: { next: { rootDir: "apps/web" } },
  },
  globalIgnores([
    "**/.next/**",
    "**/test-results/**",
    "**/playwright-report/**",
    "**/out/**",
    "**/build/**",
    "**/next-env.d.ts",
    ".superpowers/**",
  ]),
]);
