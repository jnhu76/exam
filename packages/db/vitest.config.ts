import path from "node:path";
import { availableParallelism } from "node:os";
import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";
import { TEST_RUNTIME_ENV } from "../../vitest.shared.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(__dirname, "../..");

// Seed process.env from .env files so worker threads inherit them.
// vitest's config.env makes vars available on import.meta.env but worker
// threads may not see them on process.env; pushing here ensures inheritance.
const envVars = loadEnv("test", workspaceRoot, "");
for (const [key, value] of Object.entries(envVars)) {
  if (process.env[key] === undefined) process.env[key] = value;
}

// Worker cap — Issue #463, calibrated 2026-09-05 (resource cap = 3):
// @exam/db retains file parallelism but caps concurrent workers because
// DB-backed tests share a single test-infra lifecycle advisory lane.
// Issue #463 measurements showed the throughput knee remains approximately
// flat as machine CPU count rises (2–20 CPU profiles), while CPU-derived
// worker counts deepen the lifecycle queue and cause 5s test-body timeouts.
// The cap is resource admission control, not package serialization.
// Reserving one scheduling unit (availableParallelism - 1) leaves room for
// PostgreSQL and the OS on low-core hosts.
const DB_TEST_WORKER_CAP = 3;
const maxWorkers = Math.min(
  DB_TEST_WORKER_CAP,
  Math.max(1, availableParallelism() - 1),
);
export default defineConfig(({ mode }) => ({
  test: {
    maxWorkers,
    exclude: ["dist/**", "node_modules/**"],
    // Test-database readiness (ownership contract + implicit-local
    // self-provisioning of exam_test). Soft-skips when the server is down so
    // the mixed pure/PG suite keeps its self-skip semantics. See
    // ./vitest.globalSetup.ts.
    globalSetup: ["./vitest.globalSetup.ts"],
    // Force test runtime mode via the monorepo-shared constant so every
    // package's vitest config agrees (see ../../vitest.shared.ts for why).
    env: {
      ...loadEnv(mode, workspaceRoot, ""),
      ...TEST_RUNTIME_ENV,
    },
    // Deliberately NO package-wide hookTimeout raise. Vitest's per-describe
    // `{ timeout }` applies to TEST bodies only — hooks default to the 10s
    // global hookTimeout. Every lifecycle hook that queues on the shared
    // test-infra DDL advisory lock declares its own explicit numeric timeout
    // at the call site (PR #242 rule): 30_000 for repository bootstrap,
    // 120_000 for full-migration beforeAll (enforced by scripts/check-db-config.mjs
    // Guard 5); an unrelated broken hook must still surface at the 10s default
    // instead of being masked by a raised budget.
  },
}));
