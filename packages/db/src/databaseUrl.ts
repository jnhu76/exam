/**
 * Single-source database URL + runtime mode resolution.
 *
 * This module is the ONE authoritative place that decides:
 *   1. The application runtime mode (parseAppMode).
 *   2. The database connection URL for a given mode (resolveDatabaseUrl).
 *
 * Layering: this lives in `packages/db` so both `packages/db` internals and
 * `apps/api` can import it without a layering cycle (`packages/db` cannot
 * import `apps/api`). `apps/api/src/config/runtimeConfig.ts` delegates here;
 * it must NOT re-implement mode/URL resolution.
 *
 * Resolution policy:
 *   - test/ci/e2e modes → TEST_DATABASE_URL ?? TEST_DB_URL → throw if absent.
 *     Never falls back to DATABASE_URL (a test must never silently hit the dev
 *     or prod DB). The resolved DB name must contain "test" | "e2e" | "ci"
 *     unless ALLOW_UNSAFE_TEST_DATABASE_URL=1 (a manual escape hatch, never a
 *     default).
 *   - production → DATABASE_URL → throw if absent (fail fast).
 *   - development → DATABASE_URL when set (external PostgreSQL override);
 *     otherwise constructed as postgresql://exam:exam@localhost:${DB_HOST_PORT
 *     ?? 5432}/exam — derived from DB_HOST_PORT, the SAME variable that
 *     docker-compose.dev.yml publishes, so the constructed URL can never
 *     contradict the port the dev database actually listens on. The fixed
 *     exam:exam@…/exam credentials mirror the docker-compose.dev.yml dev
 *     contract. This is a derivation, not a guess: the pre-port-ownership
 *     hardcoded fallback was removed precisely because it guessed a port that
 *     did not match the published one.
 */

/** Application runtime mode. APP_MODE is authoritative; NODE_ENV is a fallback. */
export type AppMode = "development" | "test" | "e2e" | "ci" | "production";

const APP_MODES: readonly AppMode[] = [
  "development",
  "test",
  "e2e",
  "ci",
  "production",
];

/** Modes that require a dedicated test database (TEST_DATABASE_URL). */
const TEST_LIKE_MODES: ReadonlySet<AppMode> = new Set(["test", "e2e", "ci"]);

/**
 * Resolve the application runtime mode from `APP_MODE`, falling back to
 * `NODE_ENV` when `APP_MODE` is unset or empty. Throws on an invalid APP_MODE.
 *
 * @param env - Process environment to read from.
 * @returns The resolved {@link AppMode}.
 */
export function parseAppMode(env: NodeJS.ProcessEnv): AppMode {
  const appMode = env.APP_MODE;
  if (appMode === undefined || appMode === "") {
    if (env.NODE_ENV === "production") return "production";
    if (env.NODE_ENV === "test") return "test";
    return "development";
  }
  if ((APP_MODES as readonly string[]).includes(appMode)) {
    return appMode as AppMode;
  }
  throw new Error(
    `Invalid APP_MODE "${appMode}". Valid values: ${APP_MODES.join(", ")}`,
  );
}

/**
 * Extract the database name (path segment) from a PostgreSQL connection URL.
 * Returns "" for URLs without a path segment.
 */
function extractDatabaseName(url: string): string {
  const dbMatch = url.match(/\/([^/?]+)(?:\?|$)/);
  return dbMatch?.[1] ?? "";
}

/**
 * Resolve a TEST database URL and enforce the test name-safety guard.
 *
 * This is the shared test-branch implementation used by both the mode-routing
 * {@link resolveDatabaseUrl} (when mode is test-like) and the explicitly
 * test-oriented {@link resolveTestDatabaseUrl} export. It always reads
 * TEST_DATABASE_URL ?? TEST_DB_URL and NEVER falls back to DATABASE_URL.
 *
 * Exported so `testDb.ts` can delegate without reimplementing the guard.
 *
 * @param env - Process environment to read from.
 * @returns A validated test database URL.
 * @throws When TEST_DATABASE_URL/TEST_DB_URL is missing, or the DB name lacks
 *   test/e2e/ci unless ALLOW_UNSAFE_TEST_DATABASE_URL=1.
 */
export function resolveTestBranchUrl(env: NodeJS.ProcessEnv): string {
  const url = env.TEST_DATABASE_URL ?? env.TEST_DB_URL;
  if (!url) {
    throw new Error(
      "TEST_DATABASE_URL is required for test/e2e/ci mode.\n" +
        "Refusing to use DATABASE_URL as test database.\n" +
        "Set TEST_DATABASE_URL to a dedicated test database, e.g.\n" +
        '  TEST_DATABASE_URL="postgresql://exam:exam@localhost:5432/exam_test"',
    );
  }
  if (env.ALLOW_UNSAFE_TEST_DATABASE_URL !== "1") {
    const dbName = extractDatabaseName(url);
    if (!/(test|e2e|ci)/.test(dbName)) {
      throw new Error(
        `Test database name "${dbName}" does not contain "test", "e2e", or "ci".\n` +
          "Refusing to use a non-test database in test/e2e/ci mode.\n" +
          "Set ALLOW_UNSAFE_TEST_DATABASE_URL=1 to override, or rename the database.",
      );
    }
  }
  return url;
}

/**
 * Default dev-mode host port for the constructed DATABASE_URL. Same variable
 * and default as docker-compose.dev.yml's `"${DB_HOST_PORT:-5432}:5432"`
 * publish — DB_HOST_PORT owns the dev host port; this is its dev-consumer
 * fallback (verified available on WSL2 + Docker Desktop; see
 * docs/development/ports.md).
 */
const DEFAULT_DB_HOST_PORT = "5432";

/**
 * Construct the dev DATABASE_URL from the single-source DB_HOST_PORT.
 *
 * Mirrors the docker-compose.dev.yml dev contract (exam:exam@…/exam); only the
 * port is configurable because only the host publish is a host-machine fact.
 * Development mode only — production and test-like modes never construct.
 */
function constructDevDatabaseUrl(env: NodeJS.ProcessEnv): string {
  const port = env.DB_HOST_PORT?.trim() || DEFAULT_DB_HOST_PORT;
  return `postgresql://exam:exam@localhost:${port}/exam`;
}

/**
 * Resolve the database connection URL for the mode derived from `env`.
 *
 * Mode policy:
 *   - test/ci/e2e → TEST_DATABASE_URL ?? TEST_DB_URL (fail-fast; name-safety
 *     enforced). Never falls back to DATABASE_URL.
 *   - production → DATABASE_URL (fail-fast if unset).
 *   - development → DATABASE_URL when set (external PostgreSQL); otherwise
 *     constructed from DB_HOST_PORT (dev compose contract) so a bare
 *     `pnpm dev` works without a literal URL in .env.
 *
 * @param env - Process environment to read from (defaults to process.env).
 * @returns A validated database URL.
 * @throws When the required env var is missing (prod), or (in test-like
 *   modes) when the DB name lacks test/e2e/ci unless
 *   ALLOW_UNSAFE_TEST_DATABASE_URL=1.
 */
export function resolveDatabaseUrl(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const mode = parseAppMode(env);

  if (TEST_LIKE_MODES.has(mode)) {
    return resolveTestBranchUrl(env);
  }

  const url = env.DATABASE_URL;
  if (url) return url;

  if (mode === "development") {
    return constructDevDatabaseUrl(env);
  }

  // Production (and any unexpected non-dev mode) must never construct a URL:
  // a guessed target would silently connect somewhere unexpected. A missing
  // DATABASE_URL is a misconfiguration that must fail fast.
  throw new Error(
    `DATABASE_URL is required in ${mode} mode (no constructed default). ` +
      "Set DATABASE_URL explicitly (Docker Compose composes it from the " +
      "POSTGRES_* variables).",
  );
}

/**
 * Env-only convenience wrapper: resolve the database URL from the given
 * environment without touching any cached runtime config. Used by standalone
 * scripts (migrate, drizzle-kit, admin CLIs) that only need the URL.
 *
 * @param env - Process environment to read from (defaults to process.env).
 * @returns A validated database URL.
 */
export function resolveDatabaseUrlFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return resolveDatabaseUrl(env);
}
