import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./src/e2e",
  fullyParallel: false,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: "list",
  use: {
    baseURL: "http://localhost:5173",
    headless: true,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [
    {
      command: "pnpm --filter @exam/api dev",
      port: 3000,
      reuseExistingServer: true,
      timeout: 15_000,
    },
    {
      command: "pnpm --filter @exam/web dev",
      port: 5173,
      reuseExistingServer: true,
      timeout: 15_000,
    },
  ],
});
