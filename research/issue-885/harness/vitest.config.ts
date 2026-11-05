/**
 * #885 research runner — belongs to this research bundle, not to the product
 * config directory. It runs the harness experiments and, for the BASE_SHA
 * regression control, the three product plugin suites. Both run with NO
 * globalSetup and NO PostgreSQL: the harness injects a fake fastify.db and
 * the plugin suites inject their own. The product suites' authority (with
 * the real test database) remains apps/api/vitest.config.ts.
 *
 * Run from the worktree root (filters select which half runs):
 *   study matrix   ... --config research/issue-885/harness/vitest.config.ts research/issue-885/harness/
 *   BASE control   ... --config research/issue-885/harness/vitest.config.ts apps/api/src/plugins/heartbeat.test.ts apps/api/src/plugins/deadlineScanner.test.ts apps/api/src/plugins/operabilityMonitor.test.ts
 * Full commands live in REPRO.md §5. In a clean-room worktree, REPRO.md §5
 * step 2 first symlinks apps/api/node_modules as harness/node_modules — this
 * config and the harness tests resolve `vitest`/`fastify` by walking up from
 * here, and pnpm's root has no top-level vitest.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { workspaceSourceResolutionPlugin } from "../../../config/workspace-resolution.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(__dirname, "../../..");

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
      // A syntactically valid, name-safe test URL for resolveTestBranchUrl.
      // NO connection is ever opened: the harness injects a fake fastify.db.
      TEST_DATABASE_URL:
        "postgres://exam:exam@127.0.0.1:5432/exam_test_885_inprocess",
      JWT_SECRET: "research-only-not-a-real-secret-885",
    },
    include: [
      "research/issue-885/harness/**/*.test.ts",
      "apps/api/src/plugins/heartbeat.test.ts",
      "apps/api/src/plugins/deadlineScanner.test.ts",
      "apps/api/src/plugins/operabilityMonitor.test.ts",
    ],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
