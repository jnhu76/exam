/**
 * Repository env-file source policy — the single POLICY DATA authority
 * (#741, ROOT_ONLY_ENV_FILE_POLICY).
 *
 * Every physical `.env`-style configuration source lives at the repository
 * root. Readers (this module's consumers) may sit in any package; physical
 * sources may not — no nested `.env` file under apps/, packages/, or
 * scripts/ is a supported source for runtime, build, test, or tooling
 * configuration. Enforced fail-loud by
 * `scripts/check-env-surface.mjs` (wired into `pnpm verify:static`), which
 * also rejects unsupported root filenames — so an unsupported file cannot
 * silently become configuration authority even though git ignores it.
 *
 * This module is intentionally dependency-free: it is imported by TS configs
 * AND by the plain-Node guard script (Node type stripping), so it must stay
 * erasable-syntax-only with no runtime imports. It carries policy DATA and
 * filename classification only — semantic configuration resolution
 * (APP_MODE, DATABASE_URL, ports, …) stays with its existing owners.
 */

/**
 * The complete set of root env-file names the repository supports, with one
 * owner each. Anything else that looks like an env file at the root
 * (`.env.local`, `.env.development*`, `.env.test`, `.env.production.local`,
 * other `.env.<mode>*`) is unsupported: fail-loud at verify, provably
 * ignored by every reader mechanism.
 */
export const SUPPORTED_ROOT_ENV_FILES: readonly string[] = [
  ".env", // local development source (cp .env.example .env)
  ".env.test.local", // optional developer test override (vitest only)
  ".env.production", // deployment source (docker compose --env-file only)
  ".env.example", // tracked development template — NOT a runtime source
  ".env.production.example", // tracked deployment template — NOT a runtime source
] as const;

/**
 * Files the vitest harness may admit as test env sources: the shared
 * development `.env` plus the optional `.env.test.local` override (later
 * file wins at file level; shell exports still win overall via the
 * only-if-undefined seeding). Fixed for every vitest run regardless of
 * `--mode`: unsupported mode files have no code path into test
 * configuration.
 */
export const SUPPORTED_TEST_ENV_FILES: readonly string[] = [
  ".env",
  ".env.test.local",
] as const;

/**
 * The single file the web/Vite Node-side config may admit — development
 * mode only. Production builds read no env file: `VITE_PORT` /
 * `DEV_API_PORT` are development configuration, and `.env.production`
 * stays deployment-owned (Compose `--env-file` only).
 */
export const SUPPORTED_DEV_ENV_FILE = ".env" as const;

/** Whether a bare file name is a supported root env-file source/template. */
export function isSupportedRootEnvFileName(name: string): boolean {
  return SUPPORTED_ROOT_ENV_FILES.includes(name);
}
