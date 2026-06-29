import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

// Worker count is configurable so E2E can run serially (local default) or in
// parallel via run-script sharding (E2E_WORKERS>1). NOTE: parallel execution
// is NOT enabled by raising Playwright `workers` here — that would share one
// DB/server across workers and collide on candidate1/audit-log state. Parallel
// mode instead launches N independent Playwright shards (run-wsl.sh), each with
// its own exam_e2e_w{i} DB + API server. `workers` stays 1 per shard so each
// shard's files run in their declared order (file-level serial respected).
const workers = Number(process.env.E2E_WORKERS_PER_SHARD) || 1;
const shardTotal = Number(process.env.E2E_SHARD_TOTAL) || 0;

// Reporter selection:
//   E2E_SHARD_TOTAL > 1  → blob (per-shard, merged later by merge-reports)
//   CI                   → list
//   otherwise            → list + html (local development)

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers,
  retries: 0,
  reporter:
    shardTotal > 1
      ? [
          [
            "blob",
            {
              outputDir:
                process.env.PLAYWRIGHT_BLOB_OUTPUT_DIR ?? "blob-report",
            },
          ],
        ]
      : process.env.CI
        ? [["list"]]
        : [["list"], ["html", { open: "never" }]],
  outputDir: "test-results",

  use: {
    baseURL,
    trace: process.env.E2E_TRACE === "1" ? "retain-on-failure" : "off",
    screenshot: "only-on-failure",
    video: "off",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
