import { config as loadEnv } from "dotenv";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

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
 * Load environment variables from the first existing `.env` file found by
 * {@link resolveRootEnvPaths}. No-op when none of the candidate paths exist.
 *
 * Existing `process.env` values are NOT overwritten by `dotenv` (the
 * library's default behavior).
 */
export function loadRootEnv(): void {
  const paths = resolveRootEnvPaths().filter((path) => existsSync(path));

  if (paths.length === 0) return;

  loadEnv({
    path: paths,
    quiet: true,
  });
}
