import { afterAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { isExplicitTestDbUrl, resolveTestBranchUrl } from "./databaseUrl.js";
import { resolveTestDbUrl } from "./testDb.js";
import {
  __resetTestDbBootstrapMemoForTests,
  prepareTestDatabase,
} from "./testDbBootstrap.js";
import { withDatabaseName } from "./testWorkerDatabase.js";

/**
 * Ownership-semantics tests for the test-database bootstrap contract:
 *
 *   explicit URL + missing DB       ≠ auto-create (fail fast, no fallback)
 *   implicit local URL + missing DB = auto-create (idempotent)
 *   production mode                 = never auto-create (refuse to run)
 *   malformed / unsafe DB name      = fail (name-safety guard preserved)
 *   bootstrap twice                 = idempotent
 *   concurrent bootstrap            = safe under the lifecycle lock
 *
 * Pure contract tests run everywhere; PG-backed cases follow the
 * testWorkerDatabase.test.ts `PG_DESCRIBE` pattern (skip when the server is
 * unreachable) and only ever touch disposable names or the shared exam_test
 * target itself (existence only).
 */

const BASE_URL = resolveTestDbUrl();
const ADMIN_URL = withDatabaseName(BASE_URL, "postgres");

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
const PG_DESCRIBE = PG_UP ? describe : describe.skip;

async function databaseExists(name: string): Promise<boolean> {
  const admin = postgres(ADMIN_URL, { max: 1 });
  try {
    const rows = (await admin`
      SELECT 1 FROM pg_database WHERE datname = ${name}
    `) as Array<{ "?column?": number }>;
    return rows.length > 0;
  } finally {
    await admin.end();
  }
}

describe("prepareTestDatabase — pure ownership guards", () => {
  it("refuses to run in production mode (APP_MODE=production)", async () => {
    await expect(
      prepareTestDatabase({ env: { APP_MODE: "production" } }),
    ).rejects.toThrow(/production mode/);
  });

  it("refuses to run in production mode (NODE_ENV=production fallback)", async () => {
    await expect(
      prepareTestDatabase({ env: { NODE_ENV: "production" } }),
    ).rejects.toThrow(/production mode/);
  });

  it("preserves the test DB name-safety guard for unsafe explicit names", async () => {
    await expect(
      prepareTestDatabase({
        env: {
          APP_MODE: "test",
          TEST_DATABASE_URL: "postgresql://exam:exam@localhost:5432/exam_prod",
        },
      }),
    ).rejects.toThrow(/does not contain "test", "e2e", or "ci"/);
  });

  it("treats set-but-empty TEST_DATABASE_URL as implicit (template artifact)", () => {
    const env = {
      APP_MODE: "test",
      TEST_DATABASE_URL: "",
      DB_HOST_PORT: "55432",
    };
    expect(isExplicitTestDbUrl(env)).toBe(false);
    expect(resolveTestBranchUrl(env)).toBe(
      "postgresql://exam:exam@localhost:55432/exam_test",
    );
  });
});

PG_DESCRIBE("prepareTestDatabase — PG-backed ownership semantics", () => {
  it("explicit URL + existing DB → verified, never created", async () => {
    const outcome = await prepareTestDatabase({
      env: { APP_MODE: "test", TEST_DATABASE_URL: BASE_URL },
      bypassMemo: true,
    });
    expect(outcome.kind).toBe("explicit-verified");
    expect(outcome.databaseName).toBe("exam_test");
  });

  it("explicit URL + missing DB → clear failure, NO auto-create, no fallback", async () => {
    const missing = `exam_test_bootstrap_missing_${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    await expect(databaseExists(missing)).resolves.toBe(false);
    await expect(
      prepareTestDatabase({
        env: {
          APP_MODE: "test",
          TEST_DATABASE_URL: withDatabaseName(BASE_URL, missing),
        },
        bypassMemo: true,
      }),
    ).rejects.toThrow(/operator-owned.*will not create/s);
    // The failure must not have silently created the database.
    await expect(databaseExists(missing)).resolves.toBe(false);
  });

  it("implicit local URL → ensured, and bootstrap twice is idempotent", async () => {
    const port = new URL(BASE_URL).port || "5432";
    const implicitEnv = { APP_MODE: "test", DB_HOST_PORT: port };
    const first = await prepareTestDatabase({
      env: implicitEnv,
      bypassMemo: true,
    });
    expect(first.kind).toBe("implicit-ensured");
    expect(first.databaseName).toBe("exam_test");
    const second = await prepareTestDatabase({
      env: implicitEnv,
      bypassMemo: true,
    });
    expect(second.kind).toBe("implicit-ensured");
  });

  it("concurrent bootstrap on the same URL is safe (lifecycle lock)", async () => {
    const port = new URL(BASE_URL).port || "5432";
    const outcomes = await Promise.all(
      [1, 2, 3].map(() =>
        prepareTestDatabase({
          env: { APP_MODE: "test", DB_HOST_PORT: port },
          bypassMemo: true,
        }),
      ),
    );
    for (const outcome of outcomes) {
      expect(outcome.kind).toBe("implicit-ensured");
    }
  });
});

afterAll(() => {
  __resetTestDbBootstrapMemoForTests();
});
