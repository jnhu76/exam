import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3001";

/**
 * UI-MULTIMODAL-PATROL-1 Playwright config.
 *
 * This config is SEPARATE from the normal E2E config. It points at a
 * dedicated testDir (./patrol) so normal `npx playwright test` never
 * discovers patrol specs. Invoked via:
 *
 *   E2E_WORKERS=1 bash scripts/e2e/run-wsl.sh -- --config=playwright.patrol.config.ts
 *
 * Or directly:
 *   npx playwright test --config=playwright.patrol.config.ts
 */
export default defineConfig({
  testDir: "./patrol",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 600_000, // 10 min total per test
  expect: { timeout: 15_000 },

  reporter: [["list"], ["html", { open: "never" }]],
  outputDir: "test-results-patrol",

  use: {
    baseURL,
    trace: "off",
    screenshot: "off",
    video: "off",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    // Reduced motion removes animation nondeterminism for screenshots.
    reducedMotion: "reduce",
    // Offline to avoid external requests slowing things down.
    offline: false,
  },

  projects: [
    {
      name: "patrol",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
      },
    },
  ],
});
