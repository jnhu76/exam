/**
 * Shared vitest configuration constants.
 *
 * Single source for environment variables that EVERY vitest config in this
 * monorepo must force, so no two packages can drift into defining their own
 * "test mode" macro. Import this instead of re-declaring APP_MODE/NODE_ENV.
 *
 * Why these are forced (not read from .env): a local .env commonly sets
 * APP_MODE=development / NODE_ENV=development for `pnpm dev`. If vitest
 * inherited that, the single-source DB resolver (resolveDatabaseUrl) would
 * route to DATABASE_URL (the dev DB) for any code path going through
 * runtimeConfig, while test-only paths (testDb) route to TEST_DATABASE_URL —
 * two different databases in one test process. Forcing test mode here makes
 * the whole process resolve TEST_DATABASE_URL uniformly.
 *
 * Vitest merges `config.env` on top of `viteConfig.env` (loadEnv result), so
 * these explicit keys override any .env values. See vitest serializeConfig.
 */

/** Environment that forces the test runtime mode in every vitest process. */
export const TEST_RUNTIME_ENV = {
  APP_MODE: "test",
  NODE_ENV: "test",
} as const satisfies Record<string, string>;
