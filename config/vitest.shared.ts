/**
 * Shared vitest configuration constants and the supported test env-file
 * loader.
 *
 * Single source for the forced test-mode environment (APP_MODE/NODE_ENV)
 * and the test env-file admission, so no two packages drift into defining
 * their own "test mode" macro. Import this instead of re-declaring
 * APP_MODE/NODE_ENV. The projects whose suites resolve mode-dependent
 * config spread TEST_RUNTIME_ENV into `test.env` (API incl. its fixture
 * child configs, DB — plus auth, which pins a deterministic mode); pure
 * projects (web, contracts, authz, domain, exam-engine, import-export) set
 * no `test.env` and rely on vitest's own NODE_ENV=test default —
 * docs/standards/testing.md §2.4 carries the per-project matrix.
 *
 * Why these are forced (not read from .env): a local .env commonly sets
 * APP_MODE=development / NODE_ENV=development for `pnpm dev`. If vitest
 * inherited that, the single-source DB resolver (resolveDatabaseUrl) would
 * route to DATABASE_URL (the dev DB) for any code path going through
 * runtimeConfig, while test-only paths (testDb) route to TEST_DATABASE_URL —
 * two different databases in one test process. Forcing test mode here makes
 * the whole process resolve TEST_DATABASE_URL uniformly.
 *
 * Vitest merges `config.env` on top of `viteConfig.env`, so these explicit
 * keys override any .env values. See vitest serializeConfig.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseEnvFile } from "dotenv";
import { SUPPORTED_TEST_ENV_FILES } from "./envFilePolicy.js";

/** Environment that forces the test runtime mode in every vitest process. */
export const TEST_RUNTIME_ENV = {
  APP_MODE: "test",
  NODE_ENV: "test",
} as const satisfies Record<string, string>;

/**
 * Load the SUPPORTED test env files under `root` (the repository root) as a
 * plain record — exact-path reads only (#741): unsupported root mode files
 * (`.env.local`, `.env.test`, `.env.development*`, …) have no code path
 * into test configuration. Later files override earlier ones
 * (`.env.test.local` wins over `.env`) — the FILE-level precedence. The
 * overall destinations apply their own overlays on top of this record:
 *
 *   process.env seeding  — only-if-undefined, so shell exports win;
 *   config `env` spread  — `{...fileEnv, ...TEST_RUNTIME_ENV}`, so
 *                          TEST_RUNTIME_ENV owns APP_MODE/NODE_ENV.
 */
export function loadSupportedTestEnvFiles(
  root: string,
): Record<string, string> {
  const fileEnv: Record<string, string> = {};
  for (const fileName of SUPPORTED_TEST_ENV_FILES) {
    const path = join(root, fileName);
    if (!existsSync(path)) continue;
    Object.assign(fileEnv, parseEnvFile(readFileSync(path, "utf8")));
  }
  return fileEnv;
}

/**
 * Seed `process.env` from file-provided values ONLY where undefined — the
 * shell (or an upstream runner export) always wins over file sources.
 * Distinct from the config `env` projection: this mutates the live main
 * process before workers fork, the projection addresses worker
 * `process.env`/`import.meta.env`.
 */
export function seedProcessEnvFromFiles(fileEnv: Record<string, string>): void {
  for (const [key, value] of Object.entries(fileEnv)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
