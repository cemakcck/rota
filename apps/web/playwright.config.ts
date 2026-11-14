import { defineConfig, devices } from "@playwright/test";

const PORT = 3401;

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  use: { ...devices["Desktop Chrome"], baseURL: `http://localhost:${PORT}` },
  webServer: {
    command: "npx tsx server.ts",
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: { PORT: String(PORT) },
  },
});
