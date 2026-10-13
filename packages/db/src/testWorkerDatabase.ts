/**
 * PostgreSQL worker-database bootstrap (ADR-007).
 *
 * TEST-ONLY module. Provides a per-worker PostgreSQL database bootstrap that is
 * an alternative to the per-file schema isolation in `testIsolation.ts`. It is
 * enabled only when `TEST_DB_ISOLATION=worker-database` AND the scope resolver
 * derives a non-null database name.
 *
 * Lifecycle (all side effects happen inside `setupWorkerTestDatabase`, never
 * at import time):
 *   1. resolve test scope via {@link resolveTestScope}
 *   2. reject if `APP_MODE`/`NODE_ENV` indicates production
 *   3. reject if `dbIsolation !== "worker-database"` (caller bug)
 *   4. ensure the worker database exists (CREATE DATABASE IF MISSING)
 *   5. run Drizzle migrations once (idempotent — Drizzle tracks `__drizzle_
 *      migrations`; re-running is a no-op once up to date)
 *   6. return a {@link WorkerDatabaseHandle} with `resetPostgres()` (TRUNCATE)
 *      and `close()`
 *
 * Security:
 *   - Database name comes ONLY from the resolver, which validates it matches
 *     `^[a-z0-9_]+$` and is ≤63 chars. We re-validate here before quoting.
 *   - Identifiers are double-quoted via {@link quotePgIdentifier} after the
 *     regex check. No env value is ever interpolated into a SQL identifier
 *     raw.
 *   - The maintenance-DB existence check uses a bound `$1` parameter
 *     (`SELECT ... WHERE datname = $1`) — that path is parameterized and safe.
 *   - The helper refuses to run in production mode.
 */

import postgres from "postgres";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { parseAppMode, resolveTestBranchUrl } from "./databaseUrl.js";
import { createPostgresDatabase, migratePostgres } from "./postgres.js";
import { schema } from "./schema/pg.js";
import {
  getTestInfraLifecycleLockKey,
  resolveTestInfraCoordinationUrl,
  withTestInfraLifecycleLock,
} from "./testInfraLock.js";
import {
  beginLockOperation,
  currentTraceOperation,
  emit as emitTraceEvent,
  errName,
  identifyBackend,
  isTestInfraTraceEnabled,
  monotonicNs,
  postgresWithTraceIdentity,
  runWithTraceOperation,
  withTraceSubOperation,
} from "./testInfraTrace.js";
import {
  resolveTestScope,
  type ResolvedTestScope,
  type ResolverEnv,
} from "./testScope.js";
import type { Database } from "./types.js";

/** PostgreSQL identifier charset for derived database names. */
const PG_NAME_SAFE_RE = /^[a-z0-9_]+$/;
/** PostgreSQL identifier length limit (NAMEDATALEN-1 default). */
const PG_NAME_MAX_LEN = 63;

/**
 * Migration-metadata tables that `resetPostgres()` MUST NOT truncate.
 * Drizzle creates `__drizzle_migrations` (and a `__drizzle_migrations` journal
 * in the configured `migrationsSchema`, default `drizzle`). We exclude any
 * table whose name matches this set, regardless of schema.
 */
const MIGRATION_METADATA_TABLES = new Set([
  "__drizzle_migrations",
  "drizzle_migrations",
]);

/**
 * Handle returned by {@link setupWorkerTestDatabase}. Owns the worker DB
 * connection pool and exposes deterministic reset / close.
 */
export interface WorkerDatabaseHandle {
  /** Resolved worker database name (e.g. `exam_test_w1`). */
  databaseName: string;
  /** Full connection URL for the worker database. */
  databaseUrl: string;
  /** The resolved test scope this handle is bound to. */
  scope: ResolvedTestScope;
  /**
   * Drizzle binding over the handle's OWN connection pool. Consumers that need
   * a second independent pool open their own connection to `databaseUrl`
   * instead; sharing the handle's pool keeps one pool per handle.
   */
  db: Database;
  /**
   * Truncate all business tables in the target schema (default `public`),
   * excluding migration-metadata tables. Resets sequences via
   * `RESTART IDENTITY`. Safe to call between tests / test files.
   */
  resetPostgres(): Promise<void>;
  close(): Promise<void>;
}

export interface SetupWorkerTestDatabaseOptions {
  /** Environment to read (defaults to `process.env`). */
  env?: ResolverEnv;
  /**
   * Schema to truncate in `resetPostgres()`. Defaults to `public` — the
   * worker-database mode uses database-level isolation, not schema-level, so
   * business tables live in `public` unless a future migration moves them.
   */
  truncateSchema?: string;
  /**
   * Caller-resolved scope override. Defaults to `resolveTestScope(env)`.
   * Only for callers that resolved the scope through the same resolver family
   * but need a different physical slot NAME for the same slot identity —
   * the @exam/db package worker slots (`resolveDbPackageTestScope`). The
   * override must keep `dbIsolation === "worker-database"` and a non-null
   * `postgresDatabaseName`; the bootstrap validates the name before any DDL.
   */
  scope?: ResolvedTestScope;
}

/**
 * Double-quote a PostgreSQL identifier after strict validation. Escapes any
 * embedded `"` by doubling. MUST only be called on a string that already
 * passed {@link assertPgNameSafe}.
 */
function quotePgIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

/** Validate a derived database name. Throws on any unsafe character/length. */
function assertPgNameSafe(name: string): void {
  if (!PG_NAME_SAFE_RE.test(name)) {
    throw new Error(
      `[testWorkerDatabase] refusing to use unsafe database name: "${name}" (allowed: [a-z0-9_])`,
    );
  }
  if (name.length === 0) {
    throw new Error("[testWorkerDatabase] database name is empty");
  }
  if (name.length > PG_NAME_MAX_LEN) {
    throw new Error(
      `[testWorkerDatabase] database name exceeds ${PG_NAME_MAX_LEN} chars: "${name}"`,
    );
  }
}

/**
 * Reject if the environment looks like production. The helper is test-only.
 * Delegates mode semantics to the single-source `parseAppMode` (APP_MODE is
 * authoritative; NODE_ENV=production is treated as production when APP_MODE
 * is unset).
 */
function assertNotProduction(env: ResolverEnv): void {
  if (parseAppMode(env) === "production") {
    throw new Error(
      "[testWorkerDatabase] refusing to run in production mode (APP_MODE=production or NODE_ENV=production)",
    );
  }
}

/**
 * Resolve the base database URL from environment.
 * Uses TEST_DATABASE_URL or TEST_DB_URL when set (CI / remote / operator
 * special case); otherwise the single-source test-branch resolver constructs
 * a LOCAL URL from DB_HOST_PORT. Never falls back to DATABASE_URL.
 * Validates the postgres protocol FIRST when an explicit URL is present (a
 * worker-specific precondition, checked before name-safety so a malformed
 * scheme is reported as such), then delegates URL + name-safety to the
 * single-source test-branch resolver.
 */
function resolveBaseUrl(env: ResolverEnv): string {
  const raw = env.TEST_DATABASE_URL ?? env.TEST_DB_URL;
  if (
    raw &&
    !raw.startsWith("postgresql://") &&
    !raw.startsWith("postgres://")
  ) {
    throw new Error(
      `[testWorkerDatabase] base database URL must be postgresql:// or postgres://, got: ${raw}`,
    );
  }
  // Protocol-valid (or constructed local URL): delegate to the single-source
  // resolver for the full URL + name-safety guard (test/e2e/ci check).
  return resolveTestBranchUrl(env);
}

/**
 * Replace the pathname of a PostgreSQL connection URL with the given database
 * name, preserving protocol/credentials/host/port/query. Uses `URL` so
 * password special characters are handled by standard URL encoding.
 */
export function withDatabaseName(
  databaseUrl: string,
  databaseName: string,
): string {
  const url = new URL(databaseUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

/**
 * Build the maintenance-DB URL (the server's `postgres` or configured DB) used
 * for the admin connection that runs `CREATE DATABASE`. We connect to the same
 * server as the base URL but target a DB the role is guaranteed to reach for
 * DDL. Delegates to the shared coordination-URL resolver so the advisory lock
 * sessions (and this admin session) all land on the SAME coordination database
 * (`TEST_ADMIN_DATABASE` ?? `postgres`) — advisory locks are database-local,
 * so splitting them across databases would silently break coordination.
 */
function resolveAdminUrl(env: ResolverEnv, baseUrl: string): string {
  return resolveTestInfraCoordinationUrl(baseUrl, env);
}

/**
 * Ensure the worker database exists. Connects to the maintenance DB, checks
 * `pg_database`, and runs `CREATE DATABASE` if missing. Closes the admin
 * connection in a `finally`. Idempotent.
 *
 * NOTE: `CREATE DATABASE` cannot run inside a transaction. `postgres.js`
 * `sql.unsafe(...)` does not wrap in a transaction, so this is safe. The
 * existence check is parameterized (`$1`); the `CREATE DATABASE` identifier
 * is validated + quoted, never raw env.
 *
 * The existence check + optional `CREATE DATABASE` are wrapped in the
 * cross-process test-infra advisory lock (`withTestInfraLifecycleLock`).
 * Under `@exam/db` coverage, multiple Vitest workers concurrently run
 * `CREATE DATABASE` / `CREATE SCHEMA` / `migratePostgres` against the same PG
 * instance; the lock serializes the heavy catalog DDL so a single CREATE
 * DATABASE cannot be starved past the 5s testTimeout by sibling migration
 * traffic. The lock is acquired on a dedicated admin session and released in
 * `finally`. Ordinary business queries are NOT locked.
 */
export async function ensureDatabaseExists(
  adminUrl: string,
  databaseName: string,
  options: { env?: ResolverEnv } = {},
): Promise<void> {
  assertPgNameSafe(databaseName);
  await withTestInfraLifecycleLock(
    adminUrl,
    () => ensureDatabaseExistsUnlocked(adminUrl, databaseName),
    // Pass the caller's env DOWN: the lock must host on the SAME coordination
    // authority the caller resolved `adminUrl` from. Without this the lock
    // helper silently re-read process.env.TEST_ADMIN_DATABASE below the seam
    // and the DDL serializes on a different database than the caller's
    // authority (round-4 wrapper-contract fix).
    { ...(options.env ? { env: options.env } : {}) },
  );
}

/**
 * Existence check + optional `CREATE DATABASE` WITHOUT the lifecycle lock —
 * the caller must already hold it (the worker-DB bootstrap merges ensure and
 * migrate into ONE critical section). Never call unlocked from test setup.
 *
 * Trace V2: under an ambient trace operation the admin connection is
 * annotated `exi:ddl:<operation_id>` and the two SQL steps are separate
 * sub-operations (DB_EXISTS_CHECK / CREATE_DATABASE).
 */
async function ensureDatabaseExistsUnlocked(
  adminUrl: string,
  databaseName: string,
): Promise<void> {
  const op = currentTraceOperation();
  const traced = postgresWithTraceIdentity(adminUrl, "ddl");
  const admin = traced.sql;
  try {
    if (op) {
      await identifyBackend(
        admin,
        "ddl",
        op,
        traced.connectionId,
        "DDL_CONNECTION_IDENTIFIED",
      );
    }
    // Same single existence check + optional CREATE as the pre-trace body.
    let rows: Array<{ "?column?": number }>;
    await withTraceSubOperation(
      "DB_EXISTS_CHECK",
      async () => {
        rows = (await admin`
          SELECT 1 FROM pg_database WHERE datname = ${databaseName}
        `) as Array<{ "?column?": number }>;
      },
      databaseName,
    );
    if (rows!.length === 0) {
      await withTraceSubOperation(
        "CREATE_DATABASE",
        async () => {
          await admin.unsafe(
            `CREATE DATABASE ${quotePgIdentifier(databaseName)}`,
          );
        },
        databaseName,
      );
    }
  } finally {
    if (op)
      emitTraceEvent("POOL_END_BEGIN", op, { sub_operation: "ENSURE_DB" });
    await admin.end();
    if (op)
      emitTraceEvent("POOL_END_COMPLETE", op, { sub_operation: "ENSURE_DB" });
  }
}

/**
 * Drop a database if it exists, terminating any lingering connections first
 * (Phase 6D). `DROP DATABASE` fails if any backend still holds the DB open
 * (leftover pool from a crashed previous run); `pg_terminate_backend` clears
 * them so the drop succeeds. Refuses unsafe names via {@link assertPgNameSafe}.
 *
 * The terminate + drop are wrapped in the test-infra advisory lock so concurrent
 * teardown does not race on the same catalog entries. Errors are surfaced, not
 * swallowed — callers decide whether to treat a missing DB as success.
 *
 * @param adminUrl Maintenance/admin URL for DDL.
 * @param databaseName Database to drop (must pass {@link assertPgNameSafe}).
 * @param options.keepMissing When true (default), a missing DB is NOT an error.
 */
export async function dropDatabaseIfExists(
  adminUrl: string,
  databaseName: string,
  options: { keepMissing?: boolean; env?: ResolverEnv } = {},
): Promise<void> {
  const keepMissing = options.keepMissing ?? true;
  assertPgNameSafe(databaseName);
  await withTestInfraLifecycleLock(
    adminUrl,
    async () => {
      const op = currentTraceOperation();
      const traced = postgresWithTraceIdentity(adminUrl, "ddl");
      const admin = traced.sql;
      try {
        if (op) {
          await identifyBackend(
            admin,
            "ddl",
            op,
            traced.connectionId,
            "DDL_CONNECTION_IDENTIFIED",
          );
        }
        // Terminate any lingering connections to the target DB so DROP DATABASE
        // cannot fail with "database ... is being accessed by other users".
        // Exclude our own backend pid. Safe to run even if the DB is gone.
        await withTraceSubOperation(
          "TERMINATE_BACKENDS",
          async () => {
            await admin`
              SELECT pg_terminate_backend(pid)
              FROM pg_stat_activity
              WHERE datname = ${databaseName} AND pid <> pg_backend_pid()
            `;
          },
          databaseName,
        );
        try {
          await withTraceSubOperation(
            "DROP_DATABASE",
            async () => {
              await admin.unsafe(
                `DROP DATABASE IF EXISTS ${quotePgIdentifier(databaseName)}`,
              );
            },
            databaseName,
          );
        } catch (err) {
          // `IF EXISTS` already covers the missing case; if keepMissing and the
          // error is specifically "does not exist", it is a no-op. Any other
          // error (e.g. lock conflict) is re-thrown so callers see it.
          if (keepMissing && isDatabaseMissingError(err)) return;
          throw err;
        }
      } finally {
        if (op)
          emitTraceEvent("POOL_END_BEGIN", op, { sub_operation: "DROP_DB" });
        await admin.end();
        if (op)
          emitTraceEvent("POOL_END_COMPLETE", op, { sub_operation: "DROP_DB" });
      }
    },
    // Same wrapper authority contract as ensureDatabaseExists above.
    { ...(options.env ? { env: options.env } : {}) },
  );
}

/** Heuristic: is `err` the "database does not exist" catalog error (3D000)? */
export function isDatabaseMissingError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { code?: string; cause?: { code?: string } };
  return e.code === "3D000" || e.cause?.code === "3D000";
}

/**
 * Worker-DB bootstrap: ensure + migrate, with WORKER-SLOT lifetime per run.
 *
 * WHY the bootstrap fact lives server-side: Vitest 4 (forks pool,
 * `isolate: true`) executes every test file in a FRESH worker process —
 * no in-process memo can carry the bootstrap fact across files, and without
 * one every file's first `setupWorkerTestDatabase()` re-acquired the global
 * test-infra advisory lock twice (existence check + migration no-op check):
 * pure queue load on the single lifecycle lane, with no work performed.
 * Instead, a read-only lock-free precheck treats the slot as bootstrapped
 * iff the database exists AND its applied-migration count equals the local
 * journal length — the journal is append-only (enforced by lint:db-journal),
 * so the count is a sufficient migration-state fingerprint, and the slot
 * database itself is the only cross-process-honest home for the fact. A
 * missing or stale slot takes ONE lane critical section that re-checks
 * under the lock (another worker may have bootstrapped meanwhile) and then
 * ensures + migrates. Dropped databases fail the precheck and re-bootstrap;
 * concurrent same-server runs are excluded by the run lease.
 *
 * The per-process memo below remains for intra-file repeat builds (several
 * test files call buildTestApp more than once); it has FILE lifetime — the
 * cross-file fact is the server-side precheck. The memo key includes the
 * coordination admin URL, not just the worker URL: the bootstrap runs UNDER
 * a coordination authority (its advisory-lock queue), and two calls with the
 * same worker URL but different authorities (e.g. different
 * `TEST_ADMIN_DATABASE` in their envs) must not share bootstrap state — the
 * second call's authority would silently skip its own serialized ensure+migrate
 * and fragment the one-queue guarantee. Same authority + same worker URL ⇒
 * memo hit; any authority change ⇒ fresh bootstrap.
 */
const bootstrappedWorkerDatabases = new Map<string, Promise<void>>();

/** Applied-entry count of the local Drizzle journal (append-only). */
function localMigrationCount(): number {
  const journal = fileURLToPath(
    new URL("../migrations/postgres/meta/_journal.json", import.meta.url),
  );
  const parsed = JSON.parse(readFileSync(journal, "utf8")) as {
    entries: unknown[];
  };
  return parsed.entries.length;
}

/**
 * Read-only, lock-free bootstrap probe: does `databaseName` exist AND hold
 * exactly the local journal's applied-migration count? Any error (missing
 * DB, missing tracking table, unreachable server) means "not bootstrapped" —
 * the caller then takes the real serialized path, where genuine failures
 * surface.
 */
async function isWorkerDatabaseBootstrapped(
  adminUrl: string,
  workerUrl: string,
  databaseName: string,
): Promise<boolean> {
  const expected = localMigrationCount();
  const op = currentTraceOperation();
  let admin: postgres.Sql | undefined;
  try {
    const tracedAdmin = postgresWithTraceIdentity(adminUrl, "precheck", {
      max: 1,
    });
    admin = tracedAdmin.sql;
    if (op) {
      await identifyBackend(
        admin,
        "precheck",
        op,
        tracedAdmin.connectionId,
        "DDL_CONNECTION_IDENTIFIED",
      );
    }
    // The sub-phase must bracket the PRECHECK statement itself, not the trace
    // read-back above: a phase whose duration excludes the query it names
    // reports a fake precheck cost.
    const adminSql = admin;
    const exists = await withTraceSubOperation("PRECHECK_ADMIN", async () => {
      return (await adminSql`
        SELECT 1 FROM pg_database WHERE datname = ${databaseName}
      `) as Array<{ "?column?": number }>;
    });
    if (exists.length === 0) return false;
  } catch {
    return false;
  } finally {
    await admin?.end().catch(() => {});
  }
  let conn: postgres.Sql | undefined;
  try {
    const tracedConn = postgresWithTraceIdentity(workerUrl, "precheck", {
      max: 1,
    });
    conn = tracedConn.sql;
    if (op) {
      await identifyBackend(
        conn,
        "precheck",
        op,
        tracedConn.connectionId,
        "DDL_CONNECTION_IDENTIFIED",
      );
    }
    const connSql = conn;
    const rows = await withTraceSubOperation("PRECHECK_WORKER", async () => {
      return (await connSql`
        SELECT count(*)::int AS c FROM drizzle.__drizzle_migrations
      `) as Array<{ c: number }>;
    });
    return Number(rows[0]?.c) === expected;
  } catch {
    return false;
  } finally {
    await conn?.end().catch(() => {});
  }
}

function workerBootstrapMemoKey(adminUrl: string, workerUrl: string): string {
  return `${adminUrl} ${workerUrl}`;
}

function ensureWorkerDatabaseBootstrapped(
  adminUrl: string,
  workerUrl: string,
  databaseName: string,
  env: ResolverEnv,
): Promise<void> {
  const memoKey = workerBootstrapMemoKey(adminUrl, workerUrl);
  let bootstrap = bootstrappedWorkerDatabases.get(memoKey);
  if (!bootstrap) {
    bootstrap = (async () => {
      // Trace V2: the whole flow (precheck → lock → ensure → migrate) is ONE
      // operation identity; the nested withTestInfraLifecycleLock reuses it
      // from the ambient context and does NOT emit the terminal event.
      if (isTestInfraTraceEnabled()) {
        const op = beginLockOperation(
          "ensureWorkerDatabaseBootstrapped",
          getTestInfraLifecycleLockKey().toString(),
        );
        emitTraceEvent("OPERATION_BEGIN", op, { caller: op.caller });
        return runWithTraceOperation(op, async () => {
          try {
            const flowResult = await bootstrapFlow(
              adminUrl,
              workerUrl,
              databaseName,
              env,
            );
            // Terminal event is emitted on BOTH exits: the precheck fast path
            // (no lock taken) and the serialized path. Without this, a warm
            // slot — the common case — produced an operation with no terminal
            // event at all.
            emitTraceEvent("OPERATION_COMPLETED", op, {
              outcome: "completed",
              duration_ms: Number(monotonicNs() - op.beginMonotonicNs) / 1e6,
            });
            return flowResult;
          } catch (err) {
            emitTraceEvent("OPERATION_FAILED", op, {
              outcome: `flow_error:${errName(err)}`,
              duration_ms: Number(monotonicNs() - op.beginMonotonicNs) / 1e6,
            });
            throw err;
          }
        });
      }
      return bootstrapFlow(adminUrl, workerUrl, databaseName, env);
    })().catch((err: unknown) => {
      bootstrappedWorkerDatabases.delete(memoKey);
      throw err;
    });
    bootstrappedWorkerDatabases.set(memoKey, bootstrap);
  }
  return bootstrap;
}

/** Precheck → (lock) re-check → ensure → migrate. One lock critical section. */
async function bootstrapFlow(
  adminUrl: string,
  workerUrl: string,
  databaseName: string,
  env: ResolverEnv,
): Promise<void> {
  if (await isWorkerDatabaseBootstrapped(adminUrl, workerUrl, databaseName)) {
    return;
  }
  await withTestInfraLifecycleLock(
    adminUrl,
    async () => {
      // Re-check under the lock: a sibling worker may have bootstrapped
      // this slot while this one queued.
      if (
        await isWorkerDatabaseBootstrapped(adminUrl, workerUrl, databaseName)
      ) {
        return;
      }
      await ensureDatabaseExistsUnlocked(adminUrl, databaseName);
      await migrateWorkerUrlWithTraceIdentity(workerUrl);
    },
    { env },
  );
}

/**
 * Run `migratePostgres` over a migration connection that, under tracing,
 * carries `exi:mig:<operation_id>` as startup application_name on EVERY pool
 * connection (postgres.js `connection` startup parameter), so migration SQL
 * is attributable to the operation server-side even on a multi-backend pool.
 *
 * The trace-off path is byte-equivalent to
 * `createPostgresDatabase(workerUrl)` (postgres(url) + drizzle(sql, schema));
 * the local binding exists so the production factory signature stays
 * untouched (research #774: annotate at test-only call sites, never extend
 * the production API for tracing).
 */
async function migrateWorkerUrlWithTraceIdentity(
  workerUrl: string,
): Promise<void> {
  const op = currentTraceOperation();
  const traced = postgresWithTraceIdentity(workerUrl, "mig");
  const db = drizzle(traced.sql, { schema });
  try {
    if (op) {
      await identifyBackend(
        traced.sql,
        "mig",
        op,
        traced.connectionId,
        "DDL_CONNECTION_IDENTIFIED",
      );
    }
    await withTraceSubOperation("MIGRATE", () => migratePostgres(db));
  } finally {
    if (op) emitTraceEvent("POOL_END_BEGIN", op, { sub_operation: "MIGRATE" });
    await traced.sql.end();
    if (op)
      emitTraceEvent("POOL_END_COMPLETE", op, { sub_operation: "MIGRATE" });
  }
}

/**
 * Set up a worker-scoped test database. See module docstring for the full
 * lifecycle. Throws with a clear message on any config / DDL / migration
 * failure; never swallows errors.
 *
 * @returns a {@link WorkerDatabaseHandle}. Caller MUST call `close()` in
 *   teardown to release the pool.
 */
export async function setupWorkerTestDatabase(
  options?: SetupWorkerTestDatabaseOptions,
): Promise<WorkerDatabaseHandle> {
  const env = options?.env ?? process.env;
  const truncateSchema = options?.truncateSchema ?? "public";

  assertNotProduction(env);

  const scope = options?.scope ?? resolveTestScope(env);
  if (scope.dbIsolation !== "worker-database") {
    throw new Error(
      `[testWorkerDatabase] expected TEST_DB_ISOLATION=worker-database, got "${scope.dbIsolation}"`,
    );
  }
  if (scope.postgresDatabaseName === null) {
    // Defensive: resolver guarantees non-null under worker-database, but
    // guard explicitly in case of future changes.
    throw new Error(
      "[testWorkerDatabase] resolver returned null database name under worker-database mode",
    );
  }

  const databaseName = scope.postgresDatabaseName;
  const baseUrl = resolveBaseUrl(env);
  const adminUrl = resolveAdminUrl(env, baseUrl);
  const workerUrl = withDatabaseName(baseUrl, databaseName);

  await ensureWorkerDatabaseBootstrapped(
    adminUrl,
    workerUrl,
    databaseName,
    env,
  );
  // INVARIANT: single-connection pool. The per-file schema path always runs
  // on a max-1 pool, so ordinary tests written against it (e.g. Promise.all
  // CAS pairs whose loser must observe the winner's commit and return null)
  // get the same serialized statement execution here. A multi-connection
  // pool would run such statements truly concurrently and, on servers with
  // default_transaction_isolation=repeatable read, surface 40001 instead of
  // the CAS loser — a semantic change, not a speedup. API's buildTestApp
  // opens its own pool and is unaffected.
  const conn = await createPostgresDatabase(workerUrl, undefined, { max: 1 });

  let closed = false;
  return {
    databaseName,
    databaseUrl: workerUrl,
    scope,
    db: conn.db,
    async resetPostgres() {
      await truncateBusinessTables(conn.sql, truncateSchema);
    },
    async close() {
      if (closed) return;
      closed = true;
      await conn.sql.end();
    },
  };
}

/**
 * Truncate all base tables in `targetSchema` except migration-metadata tables.
 * Uses `RESTART IDENTITY CASCADE`. Throws on failure — never silently falls
 * back to `DROP SCHEMA`. If there are no business tables, returns silently.
 *
 * Table names come from the `pg_tables` catalog and are quote-escaped; they
 * are not interpolated from env.
 */
export async function truncateBusinessTables(
  sql: postgres.Sql,
  targetSchema: string,
): Promise<void> {
  if (!PG_NAME_SAFE_RE.test(targetSchema)) {
    throw new Error(
      `[testWorkerDatabase] refusing to truncate unsafe schema: "${targetSchema}"`,
    );
  }
  const rows = (await sql`
    SELECT tablename FROM pg_tables WHERE schemaname = ${targetSchema}
  `) as Array<{ tablename: string }>;
  const targets = rows
    .map((r) => r.tablename)
    .filter((name) => !MIGRATION_METADATA_TABLES.has(name));
  if (targets.length === 0) return;
  // All names originate from the catalog (not env), but we still escape `"`
  // defensively and quote every identifier.
  const quotedSchema = quotePgIdentifier(targetSchema);
  const list = targets
    .map((name) => `${quotedSchema}.${quotePgIdentifier(name)}`)
    .join(", ");
  await sql.unsafe(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
}
