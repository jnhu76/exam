/**
 * #885 control: run the THREE EXISTING plugin test suites unchanged at
 * BASE_SHA, with no DB (no globalSetup), to prove the frozen #547/#862/#886
 * contract is intact in this worktree. Not a product config.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { workspaceSourceResolutionPlugin } from "../../config/workspace-resolution.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(__dirname, "../..");

export default defineConfig({
  root: workspaceRoot,
  // #741: package-local implicit env-file admission stays OFF; the `test.env`
  // block below is the only environment this harness gets.
  envDir: false,
  plugins: [workspaceSourceResolutionPlugin()],
  test: {
    env: {
      APP_MODE: "test",
      NODE_ENV: "test",
      TEST_DATABASE_URL:
        "postgres://exam:exam@127.0.0.1:5432/exam_test_885_inprocess",
      JWT_SECRET: "research-only-not-a-real-secret-885",
    },
    include: [
      "apps/api/src/plugins/heartbeat.test.ts",
      "apps/api/src/plugins/deadlineScanner.test.ts",
      "apps/api/src/plugins/operabilityMonitor.test.ts",
    ],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
