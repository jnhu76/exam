import { config as loadEnv } from "dotenv";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseAppMode } from "@exam/db";

/**
 * Resolve candidate paths for the `.env` file relative to this module's
 * location. Checks both the immediate parent (monorepo root) and the
 * grandparent directory, deduplicating identical resolved paths.
 *
 * @returns Array of candidate `.env` file system paths.
 */
export function resolveRootEnvPaths(): string[] {
  return [
    fileURLToPath(new URL("../../.env", import.meta.url)),
    fileURLToPath(new URL("../../../../.env", import.meta.url)),
  ].filter((path, index, paths) => paths.indexOf(path) === index);
}

/**
 * Whether `env` selects a MANAGED runtime profile (test/e2e/ci/production).
 *
 * OWNERSHIP (#565): the developer root `.env` is the DEV-profile authority.
 * Managed profiles receive their configuration from their owner — the test
 * runtime (TEST_RUNTIME_ENV + the turbo env contract), the E2E runners'
 * topology projection (run-wsl.sh launch_api / docker-compose.test.yml), the
 * CI workflow, or the deployment environment — and must not import
 * developer-local files as a second authority. The PR #565 failure class was
 * exactly this pollution: a developer `.env` APP_PORT hijacking the
 * runner-owned WSL E2E shard bind port. dotenv never overrides already-set
 * variables, but every value the runner does NOT export would still flow in
 * from the file.
 *
 * An unparseable APP_MODE is deliberately NOT treated as managed here: the
 * loader must not turn a config-resolution error into a loading decision —
 * getRuntimeConfig() fails fast on the same env, unchanged.
 *
 * Boundary note: a profile identity that exists ONLY inside the `.env` file
 * (e.g. APP_MODE=e2e with nothing exported) is still loaded, because at load
 * time the process looks unmanaged. That is the documented law — the file is
 * the DEV-profile authority; a managed run is launched by an owner that
 * exports the mode into the process environment.
 */
export function isManagedProfileEnv(env: NodeJS.ProcessEnv): boolean {
  try {
    return parseAppMode(env) !== "development";
  } catch {
    return false;
  }
}

/**
 * Load environment variables from the first existing `.env` file found by
 * {@link resolveRootEnvPaths}. No-op when none of the candidate paths exist,
 * or when `env` selects a managed profile (see {@link isManagedProfileEnv} —
 * only a bare development process imports the developer `.env`).
 *
 * Existing `process.env` values are NOT overwritten by `dotenv` (the
 * library's default behavior).
 */
export function loadRootEnv(env: NodeJS.ProcessEnv = process.env): void {
  if (isManagedProfileEnv(env)) return;

  const paths = resolveRootEnvPaths().filter((path) => existsSync(path));

  if (paths.length === 0) return;

  loadEnv({
    path: paths,
    quiet: true,
  });
}
