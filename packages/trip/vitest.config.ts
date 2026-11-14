import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { name: "trip", environment: "node", include: ["test/**/*.test.ts"] },
});
