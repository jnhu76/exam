/**
 * #885 research harness config — NOT a product config.
 *
 * Deliberately narrow: no globalSetup (no PostgreSQL is opened by these
 * in-process fake-db experiments), no coverage, one include glob. It reuses
 * the repository's single workspace-resolution plugin so every @exam/*
 * import resolves to SOURCE, exactly like apps/api/vitest.config.ts (#794).
 *
 * Run from the worktree root:
 *   apps/api/node_modules/.bin/vitest run --config apps/api/vitest.885.config.ts
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
      // A syntactically valid, name-safe test URL for resolveTestBranchUrl.
      // NO connection is ever opened: the harness injects a fake fastify.db.
      TEST_DATABASE_URL:
        "postgres://exam:exam@127.0.0.1:5432/exam_test_885_inprocess",
      JWT_SECRET: "research-only-not-a-real-secret-885",
    },
    include: ["research/issue-885/harness/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
