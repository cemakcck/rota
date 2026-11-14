import { defineConfig } from "vitest/config";

// Each workspace owns its project config; `npm test` runs them all from the root.
export default defineConfig({
  test: { projects: ["packages/trip", "apps/web"] },
});
