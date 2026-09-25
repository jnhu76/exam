import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";
import { TEST_RUNTIME_ENV } from "../../vitest.shared.js";
import { resolveParallelism } from "./vitest.parallelism.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(__dirname, "../..");

// Seed process.env from .env files so worker threads inherit them.
const envVars = loadEnv("test", workspaceRoot, "");
for (const [key, value] of Object.entries(envVars)) {
  if (process.env[key] === undefined) process.env[key] = value;
}

// DB dependency + parallelism contract (implementation: ./vitest.parallelism.ts).
//
// Default is SERIAL (fileParallelism: false). Cross-file parallelism under
// coverage still produces the BUG-FLAKE-001 5s-timeout family (the attempts
// background-scanner cases in routes/attempts/*.test.ts), and auth.test.ts
// flakes under default parallelism too (concurrent buildTestApp() + audit
// polling), so serial stays the safety net. DB-heavy tasks are ordered db→api
// by turbo (turbo.json) so two PG-heavy suites never stack.
// History: docs/standards/test-flakes.md §BUG-FLAKE-001.
//
// vitest constraint: fileParallelism: false forces maxWorkers to 1, so a
// maxWorkers value is only meaningful together with fileParallelism.
//
// Parallel is env-gated opt-in, fail-fast in resolveParallelism before any
// test starts: TEST_DB_ISOLATION=worker-database AND a positive-integer
// API_TEST_MAX_WORKERS (>= 1). A set-but-invalid value, or the value without
// worker-database isolation, THROWS — it never degrades to serial; an
// unset/empty API_TEST_MAX_WORKERS is the only serial path, in CI as well.
//
// INVARIANT: in parallel mode TEST_WORKER_ID must NEVER be set. resolveWorkerId()
// gives TEST_WORKER_ID the highest precedence, so a fixed value collapses every
// concurrent worker onto exam_test_w1 and destroys per-worker isolation.
// Parallel relies solely on vitest's injected VITEST_POOL_ID (execution slot,
// 1..maxWorkers); serial mode (the default here) may set TEST_WORKER_ID=1 by
// hand, and CI shards never set it at all (same reason as local parallel).
const parallelism = resolveParallelism(process.env);

export default defineConfig(({ mode }) => ({
  test: {
    // Fail-fast DB availability pre-check. Runs once before any test file;
    // aborts the run with a clear "run pnpm db:up" message if the test DB is
    // unreachable, instead of letting every integration test file cascade with
    // misleading `undefined` TypeErrors. See ./vitest.globalSetup.ts for the
    // full rationale (flake safety, e2e isolation, cache-hit zero-cost).
    globalSetup: ["./vitest.globalSetup.ts"],
    exclude: ["dist/**", "node_modules/**"],
    // Force test runtime mode via the monorepo-shared constant so every
    // package's vitest config agrees (see ../../vitest.shared.ts for why).
    env: {
      ...loadEnv(mode, workspaceRoot, ""),
      ...TEST_RUNTIME_ENV,
    },
    fileParallelism: parallelism.fileParallelism,
    ...(parallelism.maxWorkers !== undefined
      ? { maxWorkers: parallelism.maxWorkers }
      : {}),
    coverage: {
      thresholds: {
        lines: 60,
        branches: 50,
        functions: 50,
      },
    },
  },
}));
