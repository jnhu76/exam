import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { schema } from "./schema/pg.js";
import {
  getWorkerScopedTestDb,
  resolveTestDbUrl,
  type WorkerScopedTestDb,
} from "./testDb.js";

/**
 * #648 P1-1 — file-schema compatibility of the ordinary-test adapter
 * {@link getWorkerScopedTestDb}.
 *
 * `TEST_DB_ISOLATION=file-schema` is a supported mode (explicit
 * TEST_DATABASE_URL + restricted no-CREATEDB role — testing.md §2). The
 * adapter is the ONE seam that knows the mode: under file-schema it
 * internally delegates to the existing fresh-schema mechanism
 * (`getIsolatedTestDb`, namespace `db-worker-scoped`) so converted ordinary
 * tests run unchanged — in particular without any package worker-database
 * creation and therefore without CREATEDB privilege.
 *
 * Each test file runs in its own process (forks pool, isolate: true), so
 * forcing TEST_DB_ISOLATION=file-schema for THIS file is hermetic; the
 * enclosing invocation's mode is untouched for sibling files.
 */

const BASE_URL = resolveTestDbUrl();

async function pgReachable(url: string): Promise<boolean> {
  const conn = postgres(url, { connect_timeout: 2 });
  try {
    await conn`SELECT 1`;
    return true;
  } catch {
    return false;
  } finally {
    await conn.end();
  }
}

const PG_UP = await pgReachable(
  BASE_URL.replace(/\/[^/?]*(\?|$)/, "/postgres$1"),
);
const PG_DESCRIBE = PG_UP ? describe : describe.skip;

async function schemaExists(schemaName: string): Promise<boolean> {
  const raw = postgres(BASE_URL, { max: 1 });
  try {
    const rows = await raw`
      SELECT 1 FROM pg_namespace WHERE nspname = ${schemaName}
    `;
    return rows.length > 0;
  } finally {
    await raw.end();
  }
}

async function migrationMetadataCount(
  fixture: WorkerScopedTestDb,
): Promise<number> {
  // The fresh-schema path migrates with migrationsSchema = the isolated
  // schema, and the pool's search_path is that schema, so the unqualified
  // tracking-table name resolves inside the fixture's own schema.
  const rows = (await fixture.db.execute(
    sql`SELECT count(*)::int AS c FROM __drizzle_migrations`,
  )) as unknown as Array<{ c: number }>;
  return Number(rows[0]?.c ?? 0);
}

let cleanupFixture: (() => Promise<void>) | undefined;

afterAll(async () => {
  await cleanupFixture?.();
}, 30_000);

PG_DESCRIBE(
  "getWorkerScopedTestDb — file-schema mode delegates to the fresh-schema path (#648 P1-1)",
  { timeout: 30_000 },
  () => {
    const origMode = process.env.TEST_DB_ISOLATION;

    beforeAll(async () => {
      process.env.TEST_DB_ISOLATION = "file-schema";
    }, 30_000);

    afterAll(() => {
      if (origMode === undefined) {
        delete process.env.TEST_DB_ISOLATION;
      } else {
        process.env.TEST_DB_ISOLATION = origMode;
      }
    }, 30_000);

    it("returns a fresh per-file schema fixture, not a package worker slot", async () => {
      const fixture = await getWorkerScopedTestDb();
      cleanupFixture = fixture.cleanup;
      // Fresh-schema delegation: deterministic internal namespace, no
      // exam_test_db_* slot database involved (URL stays the base test DB).
      expect(fixture.schemaName).toMatch(/^test_db_worker_scoped_/);
      expect(fixture.databaseName).toBeUndefined();
      expect(new URL(fixture.databaseUrl).pathname).toBe(
        new URL(BASE_URL).pathname,
      );
      expect(fixture.databaseUrl).not.toContain("/exam_test_db_");
    });

    it("migrations ran into the fresh schema", async () => {
      const fixture = await getWorkerScopedTestDb();
      expect(await migrationMetadataCount(fixture)).toBeGreaterThan(0);
    });

    it("second call in the same file reuses the schema and does not reset", async () => {
      const fixture = await getWorkerScopedTestDb();
      const markerSlug = `file-schema-marker-${randomUUID().slice(0, 8)}`;
      await fixture.db.insert(schema.organizations).values({
        id: randomUUID(),
        name: "file-schema marker",
        displayName: "file-schema marker",
        slug: markerSlug,
      });

      const again = await getWorkerScopedTestDb();
      expect(again.schemaName).toBe(fixture.schemaName);
      const rows = (await again.db.execute(
        sql`SELECT 1 FROM ${schema.organizations} WHERE slug = ${markerSlug}`,
      )) as unknown as Array<{ slug: string }>;
      expect(rows.length).toBe(1);
    });

    it("cleanup drops the per-file schema; a reopen gets a NEW schema", async () => {
      const fixture = await getWorkerScopedTestDb();
      const schemaName = fixture.schemaName;
      if (schemaName === undefined) {
        throw new Error("file-schema fixture must carry schemaName");
      }
      expect(await schemaExists(schemaName)).toBe(true);

      await fixture.cleanup();
      cleanupFixture = undefined;
      expect(await schemaExists(schemaName)).toBe(false);

      const reopened = await getWorkerScopedTestDb();
      cleanupFixture = reopened.cleanup;
      expect(reopened.schemaName).not.toBe(schemaName);
      expect(await migrationMetadataCount(reopened)).toBeGreaterThan(0);
    });
  },
);
