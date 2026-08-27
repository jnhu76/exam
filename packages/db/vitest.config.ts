import path from "node:path";
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

// File parallelism is RESTORED to the Vitest default here (no fileParallelism
// override). packages/db is safe to parallelize for several reasons that do
// NOT apply to apps/api (see apps/api/vitest.config.ts + PR86 diagnostic):
//   - 8 test files total (vs 52 in apps/api), only 6 of which touch Postgres.
//   - No auth-style amplification: the heaviest single test is a bounded
//     repo/seed assertion, not a 6-cycle login + audit-polling loop that must
//     converge inside a single 5s testTimeout.
//   - Every DB-touching file uses the Plan B isolated-schema helper
//     (getIsolatedTestDb → setupIsolatedTestDb → migratePostgres), so cross-
//     file state pollution is eliminated at the source.
//
// Stress validation (vitest 4.1.7, 8-core WSL2, docker exam_test PG):
//   - 15x `pnpm --filter @exam/db test --reporter=verbose`  → 15/15 PASS
//   - 10x `pnpm --filter @exam/db coverage`                 → 10/10 PASS
//   -  5x `turbo run test coverage --filter=@exam/db
//          --filter=@exam/api --force`                       → 4/5 PASS
//     (run 5/5 had cross-package turbo contention:
//      demo-seed.test.ts 5032ms > 5s, BUG-FLAKE-002 family,
//      not a packages/db file-parallelism issue)
//   - `pnpm verify`                                          → PASS
// See docs/standards/test-flakes.md BUG-FLAKE-001 PR87 section.
//
// Do NOT blanket-copy apps/api's fileParallelism:false here. If a future
// packages/db test becomes heavy enough to flake under parallelism, add a
// targeted fix (semaphore around schema create/migrate, or a heavier
// testTimeout on that specific test), not a package-wide serial override.
export default defineConfig(({ mode }) => ({
  test: {
    exclude: ["dist/**", "node_modules/**"],
    // Force test runtime mode via the monorepo-shared constant so every
    // package's vitest config agrees (see ../../vitest.shared.ts for why).
    env: {
      ...loadEnv(mode, workspaceRoot, ""),
      ...TEST_RUNTIME_ENV,
    },
    // Deliberately NO package-wide hookTimeout raise. Vitest's per-describe
    // `{ timeout }` applies to TEST bodies only — hooks default to the 10s
    // global hookTimeout. The few lifecycle hooks that queue on the shared
    // test-infra DDL advisory lock declare their own explicit 30s timeout at
    // the hook call site (PR #242 rule); an unrelated broken hook must still
    // surface at the 10s default instead of being masked for 30s.
  },
}));
