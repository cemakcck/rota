import { defineConfig, devices } from "@playwright/test";
import { E2E_DATABASE_URL, E2E_PORT, E2E_URL } from "./tests/e2e/env";

// A production build behind the real custom server: the service worker (offline) registers only in
// production, and pages do not wait on dev compilation.
export default defineConfig({
  testDir: "tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 }, baseURL: E2E_URL, trace: "retain-on-failure" },
  webServer: {
    // CI builds once before the test steps and sets ROTA_REUSE_BUILD=1; locally each run builds.
    command: process.env.ROTA_REUSE_BUILD === "1" ? "npx tsx server.ts" : "npx next build && npx tsx server.ts",
    url: `${E2E_URL}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
    env: {
      NODE_ENV: "production",
      NEXT_TELEMETRY_DISABLED: "1",
      PORT: String(E2E_PORT),
      DATABASE_URL: E2E_DATABASE_URL,
      BETTER_AUTH_SECRET: "e2e-only-secret-e2e-only-secret-123456",
      BETTER_AUTH_URL: E2E_URL,
      IP_HASH_SECRET: "e2e-ip-secret",
      FRIEND_DELAY_MS: "1000",
    },
  },
});
