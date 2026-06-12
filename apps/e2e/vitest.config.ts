import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 15_000,
    include: ["src/**/*.test.ts"],
    // E2E tests share a single PostgreSQL test database/schema. Multiple test
    // files invoking migratePostgres() concurrently in beforeAll triggers
    // Drizzle migration races (pg_class/pg_type unique constraint violations).
    // Disable file parallelism so each e2e test file runs sequentially.
    // This only affects @exam/e2e — unit/db/api packages keep their own configs
    // and continue to run in parallel.
    fileParallelism: false,
  },
});
