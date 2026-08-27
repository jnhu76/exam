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
 *   - test/ci/e2e modes → `TEST_DATABASE_URL ?? TEST_DB_URL` when an explicit
 *     value is set (CI / remote DB / special case wins). Otherwise a LOCAL
 *     test URL is constructed as `postgresql://exam:exam@localhost:${DB_HOST_PORT
 *     ?? 5432}/exam_test` — the SAME single-source DB_HOST_PORT that
 *     docker-compose.dev.yml publishes and that dev DATABASE_URL construction
 *     uses, so changing it once makes every local consumer follow. Never falls
 *     back to DATABASE_URL (a test must never silently hit the dev or prod
 *     DB). The resolved DB name must contain "test" | "e2e" | "ci" unless
 *     ALLOW_UNSAFE_TEST_DATABASE_URL=1 (a manual escape hatch, never a
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
 * Construct a LOCAL test database URL from the single-source `DB_HOST_PORT`.
 *
 * Mirrors the docker-compose.dev.yml dev contract (exam:exam@localhost:<port>)
 * and always targets the `exam_test` database, whose name passes the test/e2e/ci
 * safety guard. Used only when no explicit TEST_DATABASE_URL / TEST_DB_URL is
 * set — i.e. a bare local `pnpm test` relying on .env alone. An explicit value
 * (CI / remote DB / operator special case) always wins, and DATABASE_URL is
 * never consulted. CI always sets TEST_DATABASE_URL, so this construction path
 * is local-only.
 */
function constructTestDatabaseUrl(env: NodeJS.ProcessEnv): string {
  const port = env.DB_HOST_PORT?.trim() || DEFAULT_DB_HOST_PORT;
  return `postgresql://exam:exam@localhost:${port}/exam_test`;
}

/**
 * Read the first explicitly-set, non-empty test URL variable.
 *
 * A set-but-empty (`TEST_DATABASE_URL=`) value is treated as UNSET: an empty
 * string is not an operator decision, it is a template artifact, and treating
 * it as an explicit URL would fail name-safety on the empty database name
 * instead of constructing the implicit local URL.
 */
function readExplicitTestUrl(env: NodeJS.ProcessEnv): string | undefined {
  for (const key of ["TEST_DATABASE_URL", "TEST_DB_URL"] as const) {
    const raw = env[key];
    if (raw === undefined) continue;
    const trimmed = raw.trim();
    if (trimmed.length > 0) return raw;
  }
  return undefined;
}

/**
 * Whether an operator explicitly supplied `TEST_DATABASE_URL` / `TEST_DB_URL`.
 *
 * This is the ownership switch for the test database contract:
 *   - explicit  → the target is operator-owned; the harness must NOT create it
 *     and must fail fast when it is missing (no privilege escalation, no
 *     fallback);
 *   - implicit  → the harness constructs the local convenience URL
 *     (`exam_test` on `DB_HOST_PORT`) and MAY self-provision that database.
 *
 * Set-but-empty values count as implicit (see {@link readExplicitTestUrl}).
 */
export function isExplicitTestDbUrl(env: NodeJS.ProcessEnv): boolean {
  return readExplicitTestUrl(env) !== undefined;
}

/**
 * Resolve a TEST database URL and enforce the test name-safety guard.
 *
 * This is the shared test-branch implementation used by both the mode-routing
 * {@link resolveDatabaseUrl} (when mode is test-like) and the explicitly
 * test-oriented {@link resolveTestDatabaseUrl} export. It reads
 * `TEST_DATABASE_URL ?? TEST_DB_URL` when set to a non-empty value; otherwise
 * it constructs a LOCAL test URL from the single-source `DB_HOST_PORT` (so
 * changing DB_HOST_PORT in `.env` makes `pnpm test` follow automatically). It
 * NEVER falls back to DATABASE_URL.
 *
 * Exported so `testDb.ts` can delegate without reimplementing the guard.
 *
 * @param env - Process environment to read from.
 * @returns A validated test database URL.
 * @throws When the DB name lacks test/e2e/ci unless
 *   ALLOW_UNSAFE_TEST_DATABASE_URL=1.
 */
export function resolveTestBranchUrl(env: NodeJS.ProcessEnv): string {
  const url = readExplicitTestUrl(env);
  const resolved = url ?? constructTestDatabaseUrl(env);
  if (env.ALLOW_UNSAFE_TEST_DATABASE_URL !== "1") {
    const dbName = extractDatabaseName(resolved);
    if (!/(test|e2e|ci)/.test(dbName)) {
      throw new Error(
        `Test database name "${dbName}" does not contain "test", "e2e", or "ci".\n` +
          "Refusing to use a non-test database in test/e2e/ci mode.\n" +
          "Set ALLOW_UNSAFE_TEST_DATABASE_URL=1 to override, or rename the database.",
      );
    }
  }
  return resolved;
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
 *   - test/ci/e2e → TEST_DATABASE_URL ?? TEST_DB_URL when set; otherwise a
 *     LOCAL test URL constructed from DB_HOST_PORT (name-safety enforced).
 *     Never falls back to DATABASE_URL.
 *   - production → DATABASE_URL (fail-fast if unset).
 *   - development → DATABASE_URL when set (external PostgreSQL); otherwise
 *     constructed from DB_HOST_PORT (dev compose contract) so a bare
 *     `pnpm dev` works without a literal URL in .env.
 *
 * @param env - Process environment to read from (defaults to process.env).
 * @returns A validated database URL.
 * @throws When the required env var is missing (prod), or (in test-like
 *   modes) when the resolved DB name lacks test/e2e/ci unless
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
