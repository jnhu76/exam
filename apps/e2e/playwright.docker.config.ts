import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./src/e2e",
  fullyParallel: false,
  retries: 1,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: "list",
  use: {
    baseURL: "http://host.docker.internal:5173",
    headless: true,
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
  },
  projects: [
    {
      name: "setup",
      testMatch: /auth\.setup\.ts/,
    },
    {
      name: "auth-tests",
      testMatch: /auth\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "admin-tests",
      dependencies: ["setup"],
      testMatch: /browser\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        storageState: "src/e2e/.auth/admin.json",
      },
    },
  ],
});
