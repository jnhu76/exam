import { afterAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import {
  dropDatabaseIfExists,
  ensureDatabaseExists,
  setupWorkerTestDatabase,
  truncateBusinessTables,
  withDatabaseName,
} from "./testWorkerDatabase.js";
import { resolveTestDbUrl } from "./testDb.js";

/**
 * ADR-007 Phase 3A worker-database prototype tests.
 *
 * Two layers:
 *   - Pure-logic tests (URL derivation, production guard, scope wiring) —
 *     hermetic, no PG service needed.
 *   - PG-integration tests (ensure / migrate / truncate / close) — require a
 *     reachable PostgreSQL. They use a dedicated worker database name derived
 *     from a fixed TEST_WORKER_ID so they never touch a sibling test's data.
 *
 * PG-integration tests are wrapped in `PG_DESCRIBE`, which becomes
 * `describe.skip` when the server is not reachable — so the suite never fails
 * just because PG is down, but DOES run wherever PG is up (local dev / CI).
 *
 * ADR-007 Phase 6D: lifecycle DB names are now per-run unique
 * (`exam_test_wphase6d_<pid>_<ts>_<rand>`) so leftover DBs from a crashed
 * previous run cannot collide with the current run's fixed name, and teardown
 * uses {@link dropDatabaseIfExists} (terminates lingering connections + advisory
 * lock) instead of a bare `DROP DATABASE IF EXISTS`.
 */

const BASE_URL = resolveTestDbUrl();

/** A real admin URL derived from BASE_URL → maintenance DB `postgres`. */
const ADMIN_URL = withDatabaseName(BASE_URL, "postgres");

/** Best-effort reachability check; resolves true/false, never throws. */
async function pgReachable(url: string): Promise<boolean> {
  const sql = postgres(url, { connect_timeout: 2 });
  try {
    await sql`SELECT 1`;
    return true;
  } catch {
    return false;
  } finally {
    await sql.end();
  }
}

const PG_UP = await pgReachable(ADMIN_URL);
/** describe or describe.skip depending on PG reachability. */
const PG_DESCRIBE = PG_UP ? describe : describe.skip;

/**
 * Generate a per-run unique, safety-guard-compatible database name.
 *
 * Phase 6D Option B: previously the lifecycle tests used fixed names
 * (`exam_test_w_phase3a_ensure`), which could collide with leftovers from a
 * crashed prior run and force a `DROP DATABASE` on the cold path. A unique
 * name means a fresh run starts with an absent DB (CREATE DATABASE only) and
 * best-effort cleanup never has to wait for a stale connection.
 *
 * Format: `exam_test_wphase6d_<pid>_<counter>_<rand>` — passes the
 * `^[a-z0-9_]+ / ≤63-char guard in `assertPgNameSafe`.
 */
function uniqueLifecycleDbName(tag: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  const name = `exam_test_wphase6d_${tag}_${process.pid}_${rand}`;
  // Defensive: keep within the 63-char PG identifier limit.
  return name.slice(0, 63).replace(/[^a-z0-9_]/g, "_");
}

afterAll(async () => {
  // Best-effort cleanup of the prototype DB names used below.
  if (PG_UP) {
    await dropDatabaseIfExists(ADMIN_URL, "exam_test_w_phase3a_proto", {
      keepMissing: true,
    }).catch(() => {
      /* best-effort; reported via diagnostics in dropDatabaseIfExists */
    });
  }
});

// ---------------------------------------------------------------------------
// Pure-logic tests (no PG service required)
// ---------------------------------------------------------------------------

describe("withDatabaseName", () => {
  it("replaces the pathname and preserves the rest", () => {
    const out = withDatabaseName(
      "postgresql://exam:exam@localhost:5432/exam_test",
      "exam_test_w1",
    );
    expect(out).toBe("postgresql://exam:exam@localhost:5432/exam_test_w1");
  });

  it("preserves query parameters", () => {
    const out = withDatabaseName(
      "postgresql://exam:exam@localhost:5432/exam_test?sslmode=disable",
      "exam_test_s2_w1",
    );
    expect(out).toContain("/exam_test_s2_w1");
    expect(out).toContain("sslmode=disable");
  });

  it("derives the CI worker URL from a shard+worker name", () => {
    const out = withDatabaseName(BASE_URL, "exam_test_s2_w1");
    expect(out.endsWith("/exam_test_s2_w1")).toBe(true);
  });
});

describe("setupWorkerTestDatabase — input guards (no PG)", () => {
  it("refuses to run in production mode (APP_MODE=production)", async () => {
    await expect(
      setupWorkerTestDatabase({
        env: {
          APP_MODE: "production",
          TEST_DB_ISOLATION: "worker-database",
          TEST_DATABASE_URL: BASE_URL,
        },
      }),
    ).rejects.toThrow(/production mode/);
  });

  it("refuses to run when NODE_ENV=production and APP_MODE unset", async () => {
    await expect(
      setupWorkerTestDatabase({
        env: {
          NODE_ENV: "production",
          TEST_DB_ISOLATION: "worker-database",
          TEST_DATABASE_URL: BASE_URL,
        },
      }),
    ).rejects.toThrow(/production mode/);
  });

  it("rejects when dbIsolation is file-schema", async () => {
    await expect(
      setupWorkerTestDatabase({
        env: { TEST_DB_ISOLATION: "file-schema", TEST_DATABASE_URL: BASE_URL },
      }),
    ).rejects.toThrow(/worker-database/);
  });

  it("rejects an unsafe base URL scheme", async () => {
    await expect(
      setupWorkerTestDatabase({
        env: {
          TEST_DB_ISOLATION: "worker-database",
          TEST_DATABASE_URL: "sqlite:./dev.db",
          TEST_WORKER_ID: "1",
        },
      }),
    ).rejects.toThrow(/postgresql:\/\/ or postgres:\/\//);
  });
});

// ---------------------------------------------------------------------------
// PG-integration tests (skipped when PG is not reachable)
// ---------------------------------------------------------------------------

PG_DESCRIBE("ensureDatabaseExists", { timeout: 15_000 }, () => {
  it("creates the database if missing, idempotent on second call", async () => {
    // Phase 6D Option B: per-run unique name so a crashed prior run's leftover
    // DB cannot collide, and teardown uses robust dropDatabaseIfExists.
    const workerDb = uniqueLifecycleDbName("ensure");
    try {
      // First call: creates (DB is absent because the name is unique).
      await ensureDatabaseExists(ADMIN_URL, workerDb);
      // Second call: idempotent (already exists).
      await ensureDatabaseExists(ADMIN_URL, workerDb);
      const admin = postgres(ADMIN_URL);
      try {
        const rows = await admin`
          SELECT 1 FROM pg_database WHERE datname = ${workerDb}
        `;
        expect(rows.length).toBe(1);
      } finally {
        await admin.end();
      }
    } finally {
      // Phase 6D Option C: robust drop (terminate lingering connections + lock).
      await dropDatabaseIfExists(ADMIN_URL, workerDb, { keepMissing: true });
    }
  });

  it("rejects an unsafe database name without issuing DDL", async () => {
    await expect(
      ensureDatabaseExists(ADMIN_URL, "exam_test; DROP TABLE x"),
    ).rejects.toThrow(/unsafe database name/);
  });
});

PG_DESCRIBE("dropDatabaseIfExists — robust drop", () => {
  it("is idempotent when the database is missing", async () => {
    const missing = uniqueLifecycleDbName("missing");
    // No CREATE — drop a DB that does not exist; must not throw with keepMissing.
    await dropDatabaseIfExists(ADMIN_URL, missing, { keepMissing: true });
    // And again — repeated drop on missing is still a no-op.
    await dropDatabaseIfExists(ADMIN_URL, missing, { keepMissing: true });
  });

  it("refuses an unsafe database name without issuing DDL", async () => {
    await expect(
      dropDatabaseIfExists(ADMIN_URL, "exam_test; DROP TABLE x"),
    ).rejects.toThrow(/unsafe database name/);
  });

  it("drops a database that exists", async () => {
    const workerDb = uniqueLifecycleDbName("dropdrop");
    try {
      await ensureDatabaseExists(ADMIN_URL, workerDb);
      await dropDatabaseIfExists(ADMIN_URL, workerDb);
      const admin = postgres(ADMIN_URL);
      try {
        const rows = await admin`
          SELECT 1 FROM pg_database WHERE datname = ${workerDb}
        `;
        expect(rows.length).toBe(0);
      } finally {
        await admin.end();
      }
    } finally {
      await dropDatabaseIfExists(ADMIN_URL, workerDb, {
        keepMissing: true,
      }).catch(() => {
        /* best-effort */
      });
    }
  });
});

PG_DESCRIBE("setupWorkerTestDatabase — full lifecycle", () => {
  it("migrates, connects, truncates, preserves migration metadata, closes cleanly", async () => {
    // Phase 6D Option B: unique TEST_WORKER_ID → unique resolved DB name
    // (`exam_test_wphase6d_proto_<tag>`), so no leftover-collision on cold start.
    const runTag = Math.random().toString(36).slice(2, 8);
    const workerId = `phase6d_proto_${runTag}`.replace(/[^a-z0-9_]/g, "_");
    const handle = await setupWorkerTestDatabase({
      env: {
        TEST_DB_ISOLATION: "worker-database",
        TEST_INFRA_SCOPE: "local",
        TEST_WORKER_ID: workerId,
        TEST_DATABASE_URL: BASE_URL,
      },
    });
    try {
      // Derived name follows the resolver's local-worker rule (`exam_test_w<id>`).
      expect(handle.databaseName).toBe(`exam_test_w${workerId}`);
      expect(handle.scope.dbIsolation).toBe("worker-database");
      expect(handle.databaseUrl.endsWith(`/${handle.databaseName}`)).toBe(true);

      // Migration metadata must be present (real migration ran).
      const meta = postgres(handle.databaseUrl);
      try {
        const tables = await meta`
          SELECT tablename FROM pg_tables WHERE schemaname = 'drizzle'
        `;
        const names = tables.map((t) =>
          "tablename" in (t as object)
            ? (t as { tablename: string }).tablename
            : "",
        );
        expect(names).toContain("__drizzle_migrations");
      } finally {
        await meta.end();
      }

      // Insert a business row into a migrated table (organizations), then
      // confirm resetPostgres() clears it while preserving migration metadata.
      const biz = postgres(handle.databaseUrl);
      try {
        await biz`
          INSERT INTO organizations (id, name, slug, display_name, created_at, updated_at)
          VALUES ('org-test-phase3a', 'Test Org', 'org-test-phase3a', 'Test Org', now(), now())
        `;
        let rows = await biz`SELECT count(*)::int AS c FROM organizations`;
        expect((rows[0] as { c: number }).c).toBeGreaterThanOrEqual(1);

        await handle.resetPostgres();
        rows = await biz`SELECT count(*)::int AS c FROM organizations`;
        expect((rows[0] as { c: number }).c).toBe(0);
      } finally {
        await biz.end();
      }

      // Migration metadata MUST survive resetPostgres().
      const meta2 = postgres(handle.databaseUrl);
      try {
        const after = await meta2`
          SELECT count(*)::int AS c FROM drizzle.__drizzle_migrations
        `;
        expect((after[0] as { c: number }).c).toBeGreaterThan(0);
      } finally {
        await meta2.end();
      }
    } finally {
      await handle.close();
      await handle.close(); // idempotent
      await dropDatabaseIfExists(ADMIN_URL, handle.databaseName, {
        keepMissing: true,
      });
    }
  });
});

describe("truncateBusinessTables — guard", () => {
  it("rejects an unsafe schema name without touching PG", async () => {
    const fakeSql = {
      async unsafe() {
        throw new Error("should not be called");
      },
    } as unknown as postgres.Sql;
    await expect(
      truncateBusinessTables(fakeSql, "public; DROP"),
    ).rejects.toThrow(/unsafe schema/);
  });
});

PG_DESCRIBE("truncateBusinessTables — no-op path", () => {
  it("does not error when there are zero business rows", async () => {
    // Phase 6D Option B: unique TEST_WORKER_ID → unique resolved DB name.
    const runTag = Math.random().toString(36).slice(2, 8);
    const workerId = `phase6d_noop_${runTag}`.replace(/[^a-z0-9_]/g, "_");
    const handle = await setupWorkerTestDatabase({
      env: {
        TEST_DB_ISOLATION: "worker-database",
        TEST_WORKER_ID: workerId,
        TEST_DATABASE_URL: BASE_URL,
      },
    });
    try {
      await handle.resetPostgres();
      await handle.resetPostgres(); // no business rows -> no-op, no error
    } finally {
      await handle.close();
      await dropDatabaseIfExists(ADMIN_URL, handle.databaseName, {
        keepMissing: true,
      });
    }
  });
});
