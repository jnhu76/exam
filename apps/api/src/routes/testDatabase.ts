/**
 * API test database adapter (opt-in worker-database).
 *
 * Single chokepoint that selects between the per-file schema path
 * (`testIsolation.ts`) and the per-worker database path
 * (`testWorkerDatabase.ts`), based on `TEST_DB_ISOLATION` (see
 * `isWorkerDatabaseMode` for the opt-in rule and docs/standards/testing.md §2
 * for the environment-variable contract).
 *
 * Lifecycle side effects happen ONLY inside `setupApiTestDatabaseFromEnv`,
 * never at import time. The adapter is test-only and refuses to run in
 * production (the worker path delegates to the production guard).
 */

import { setupIsolatedTestDb } from "@exam/db/src/testIsolation.js";
import {
  setupWorkerTestDatabase,
  type WorkerDatabaseHandle,
} from "@exam/db/src/testWorkerDatabase.js";
import { resolveTestScope, type ResolverEnv } from "@exam/db/src/testScope.js";
import { resolveTestBranchUrl } from "@exam/db/src/databaseUrl.js";

/** Which isolation strategy the adapter selected for this call. */
export type ApiTestDatabaseMode = "file-schema" | "worker-database";

/**
 * Unified handle returned by {@link setupApiTestDatabaseFromEnv}.
 *
 * Callers (e.g. `buildTestApp` and the security test files) use:
 *   - `databaseUrl`   — full PG URL to hand to `createDatabase`
 *   - `schemaName`    — schema for `search_path` / `migrationsSchema`, or
 *                       `undefined` in worker-DB mode (default `public`).
 *   - `resetPostgres()` — truncate business tables (no-op in legacy mode,
 *                       which relies on per-file schema isolation instead).
 *   - `close()`       — release pools / drop schema (idempotent).
 */
export interface ApiTestDatabaseHandle {
  /** Which path was selected. */
  mode: ApiTestDatabaseMode;
  /** Full PostgreSQL connection URL for the selected database. */
  databaseUrl: string;
  /**
   * Schema name for legacy per-file isolation; `undefined` in worker-DB mode
   * (business tables live in the default `public` schema of the worker DB).
   */
  schemaName: string | undefined;
  /**
   * Reset business-table state. In worker-DB mode this truncates the worker
   * DB (preserving migration metadata). In legacy mode this is a no-op:
   * legacy isolation gives every file its own schema, so there is no shared
   * mutable state to reset.
   */
  resetPostgres(): Promise<void>;
  /** Release all resources owned by this handle. Idempotent. */
  close(): Promise<void>;
}

/**
 * Read whether the worker-DB opt-in is active. Pure, no side effects.
 *
 * IMPORTANT: this is EXPLICIT opt-in only — it returns true when
 * `TEST_DB_ISOLATION` is set to the literal string `"worker-database"`, and it
 * deliberately does NOT honor the resolver's `worker-database` default for an
 * unset variable. The adapter must only switch when a developer/CI explicitly
 * opts in.
 */
export function isWorkerDatabaseMode(env: ResolverEnv = process.env): boolean {
  const raw = env.TEST_DB_ISOLATION;
  return raw !== undefined && raw.trim() === "worker-database";
}

/**
 * Resolve the API test database for the current environment.
 *
 * - `TEST_DB_ISOLATION=worker-database` (explicit opt-in) → per-worker
 *   PostgreSQL database via the worker helper. `schemaName` is `undefined`.
 * - Otherwise → per-file schema isolation.
 *
 * In per-file mode the adapter still respects the isolation-enabled rules of
 * `isTestDbIsolationEnabled()` (evaluated against the passed-in `env`, so the
 * adapter is fully testable): when isolation is disabled
 * (`TEST_DB_ISOLATION=0`), no per-file schema is created and the returned
 * `schemaName` is `undefined`.
 *
 * @param namespace stable logical name for the caller (e.g. `"api"`,
 *   `"security-rbac"`). Passed to the per-file path for schema naming; ignored
 *   by the worker-DB path (isolation is database-level, not schema-level).
 */
export async function setupApiTestDatabaseFromEnv(options?: {
  env?: ResolverEnv;
  namespace?: string;
  databaseUrl?: string;
}): Promise<ApiTestDatabaseHandle> {
  const env = options?.env ?? process.env;
  const namespace = options?.namespace ?? "api";
  // Explicit override (test-injected URL) wins; otherwise the single-source
  // test-branch resolver picks TEST_DATABASE_URL/TEST_DB_URL, or constructs a
  // LOCAL test URL from DB_HOST_PORT. Never falls back to DATABASE_URL.
  const baseUrl = options?.databaseUrl ?? resolveTestBranchUrl(env);

  if (isWorkerDatabaseMode(env)) {
    const worker = await setupWorkerTestDatabase({ env });
    return wrapWorkerHandle(worker);
  }

  // Per-file schema path. Whether a per-file schema is created follows the
  // SAME rules as `isTestDbIsolationEnabled()`, evaluated against the `env`
  // the caller passed in (defaults to `process.env`) so the adapter is fully
  // testable. The value is trimmed for consistency with
  // `isWorkerDatabaseMode()`; an unrecognized value is treated as disabled.
  // Note: "file-schema" is treated as ENABLED. It is the documented legacy
  // mode name (see docs/archive/dev/test-suite-taxonomy.md); without this it would
  // fall through to the disabled branch and silently run tests on the shared
  // `public` schema with NO isolation.
  const isoEnabled = (() => {
    const val = env.TEST_DB_ISOLATION?.trim();
    if (val === undefined || val === "" || val === "file-schema") return true;
    return val === "1" || val === "true";
  })();

  if (isoEnabled) {
    const iso = await setupIsolatedTestDb({ namespace, databaseUrl: baseUrl });
    return wrapLegacyIso(iso, baseUrl);
  }
  return wrapLegacyIso(
    {
      schemaName: undefined,
      databaseUrl: baseUrl,
      cleanup: async () => {
        /* nothing to drop in the shared-DB disabled path */
      },
    },
    baseUrl,
  );
}

/** Build the unified handle around a Phase 3A worker-DB handle. */
function wrapWorkerHandle(worker: WorkerDatabaseHandle): ApiTestDatabaseHandle {
  let closed = false;
  return {
    mode: "worker-database",
    databaseUrl: worker.databaseUrl,
    schemaName: undefined,
    resetPostgres: () => worker.resetPostgres(),
    close: async () => {
      if (closed) return;
      closed = true;
      await worker.close();
    },
  };
}

/**
 * Build the unified handle around the legacy `IsolatedTestDb`.
 *
 * `resetPostgres` is a no-op here: legacy mode gives each test file its own
 * schema, so there is no cross-file mutable state to truncate. Tests that
 * need within-file resets keep using their existing helpers.
 *
 * `schemaName` may be `undefined` when isolation is explicitly disabled
 * (`TEST_DB_ISOLATION=0`); callers then connect to the base DB's default
 * schema.
 */
interface LegacyIsoLike {
  schemaName: string | undefined;
  databaseUrl: string;
  cleanup: () => Promise<void>;
}
function wrapLegacyIso(
  iso: LegacyIsoLike,
  fallbackBaseUrl: string,
): ApiTestDatabaseHandle {
  let closed = false;
  return {
    mode: "file-schema",
    // Legacy callers connect to the base URL (the schema is selected via
    // `search_path`, not the URL). `iso.databaseUrl` is that base URL.
    databaseUrl: iso.databaseUrl ?? fallbackBaseUrl,
    schemaName: iso.schemaName,
    resetPostgres: async () => {
      /* no-op in legacy per-file schema mode */
    },
    close: async () => {
      if (closed) return;
      closed = true;
      await iso.cleanup();
    },
  };
}
