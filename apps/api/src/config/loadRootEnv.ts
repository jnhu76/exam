import { config as dotenvConfig } from "dotenv";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseAppMode } from "@exam/db";

/**
 * The one supported application env-file source (#741): the repository-root
 * `.env`, resolved module-relative so the source (`apps/api/src/config/`) and
 * dist (`apps/api/dist/config/`) layouts find the same file without depending
 * on the caller's cwd. Package-local `.env*` files are not admission
 * candidates — they are an unsupported surface rejected by
 * scripts/check-env-surface.mjs.
 */
export function resolveRootEnvPath(): string {
  return fileURLToPath(new URL("../../../../.env", import.meta.url));
}

/**
 * Whether `env` selects a MANAGED runtime profile (test/e2e/ci/production).
 *
 * OWNERSHIP (#565): the developer root `.env` is the DEV-profile authority.
 * Managed profiles receive their configuration from their owner — the test
 * runtime (TEST_RUNTIME_ENV + the turbo env contract), the E2E runner's
 * topology projection (run.sh launch_api), the CI workflow, or the
 * deployment environment — and must not import
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
 * MECHANISM (#741): parse exactly one env file into `process.env`, never
 * overriding pre-set values (dotenv's default). Accepting a path here does
 * NOT make that path a supported source — the AUTHORITY for which path is
 * admissible is {@link loadRootEnv} (the repository-root `.env` only). This
 * seam exists so tests can prove the physical admission half against
 * throwaway temp fixtures instead of writing a repository env-file authority.
 */
export function admitEnvFile(path: string): void {
  dotenvConfig({ path, quiet: true });
}

/**
 * Load the supported repository-root `.env` ({@link resolveRootEnvPath}).
 * No-op when the file does not exist, or when `env` selects a managed
 * profile (see {@link isManagedProfileEnv} — only a bare development process
 * imports the developer `.env`).
 *
 * Existing `process.env` values are NOT overwritten by `dotenv` (the
 * library's default behavior).
 */
export function loadRootEnv(env: NodeJS.ProcessEnv = process.env): void {
  if (isManagedProfileEnv(env)) return;

  const path = resolveRootEnvPath();

  if (!existsSync(path)) return;

  admitEnvFile(path);
}
