import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const TEST_DB = process.env.TEST_DATABASE_URL ?? "postgres://rota:rota@localhost:5434/rota_test";
const alias = { "@": fileURLToPath(new URL("./src", import.meta.url)) };

export default defineConfig({
  plugins: [react()],
  resolve: { alias },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "web-unit",
          environment: "jsdom",
          setupFiles: ["./tests/setup.ts"],
          include: ["tests/unit/**/*.test.{ts,tsx}"],
        },
      },
      {
        extends: true,
        test: {
          name: "web-integration",
          environment: "node",
          setupFiles: ["./tests/setup.ts"],
          include: ["tests/integration/**/*.test.ts"],
          globalSetup: ["./tests/integration/global-setup.ts"],
          fileParallelism: false,
          env: {
            DATABASE_URL: TEST_DB,
            BETTER_AUTH_SECRET: "test-only-secret-test-only-secret-1234",
            BETTER_AUTH_URL: "http://localhost:3400",
            IP_HASH_SECRET: "test-ip-secret",
          },
        },
      },
    ],
  },
});
