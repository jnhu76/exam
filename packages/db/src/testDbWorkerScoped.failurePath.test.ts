import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { schema } from "./schema/pg.js";
import { getWorkerScopedTestDb, resolveTestDbUrl } from "./testDb.js";
import {
  resolveDbIsolationMode,
  resolveDbPackageTestScope,
} from "./testScope.js";
import {
  dropDatabaseIfExists,
  setupWorkerTestDatabase,
  withDatabaseName,
} from "./testWorkerDatabase.js";

/**
 * #648 P1-3 — reset-boundary failure must not leak the worker handle.
 *
 * `openWorkerScopedFixture` opens a pool (`setupWorkerTestDatabase`) and then
 * runs the once-per-file `resetPostgres()`. If that reset throws, the adapter
 * — the handle's owner until it returns the fixture — MUST close the pool
 * before propagating the failure, and the memo eviction (already in place)
 * must let the file retry once the failure is cleared.
 *
 * The failure is injected for real, without mocks: the adapter is pointed at
 * a UNIQUE throwaway slot (`TEST_WORKER_ID=failpath<rand>` →
 * `exam_test_db_wfailpath…`, outside the fixed w1..wN slot namespace and
 * dropped in teardown) whose `organizations` table carries a transient
 * BEFORE TRUNCATE trigger that raises. Handle release is proven server-side:
 * after the rejection, no other backend may remain connected to the throwaway
 * slot (pg_stat_activity); on the unfixed code the failed pool's single
 * connection leaks there.
 */

const BASE_URL = resolveTestDbUrl();
const ADMIN_URL = withDatabaseName(BASE_URL, "postgres");

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

const PG_UP = await pgReachable(ADMIN_URL);
const WORKER_MODE_DESCRIBE =
  PG_UP && resolveDbIsolationMode() === "worker-database"
    ? describe
    : describe.skip;

/** Unique-per-run throwaway slot identity (charset: [A-Za-z0-9_-]). */
const FAILPATH_WORKER_ID = `failpath${randomUUID().replaceAll("-", "").slice(0, 8)}`;

let slotName = "";
let cleanupSlot: (() => Promise<void>) | undefined;

/** Connections to `slotName` from other backends (own pid excluded). */
async function otherBackendCount(): Promise<number> {
  const admin = postgres(ADMIN_URL, { max: 1 });
  try {
    const rows = await admin`
      SELECT count(*)::int AS c FROM pg_stat_activity
      WHERE datname = ${slotName} AND pid <> pg_backend_pid()
    `;
    return Number(rows[0]?.c ?? 0);
  } finally {
    await admin.end();
  }
}

/** Run DDL directly on the throwaway slot (own short-lived connection). */
async function onSlotDatabase(statements: readonly string[]): Promise<void> {
  const conn = postgres(withDatabaseName(BASE_URL, slotName), { max: 1 });
  try {
    for (const statement of statements) {
      await conn.unsafe(statement);
    }
  } finally {
    await conn.end();
  }
}

WORKER_MODE_DESCRIBE(
  "getWorkerScopedTestDb — reset-boundary failure releases the handle (#648 P1-3)",
  { timeout: 30_000 },
  () => {
    const origWorkerId = process.env.TEST_WORKER_ID;

    beforeAll(async () => {
      // Point the adapter at a unique throwaway slot for this file's process.
      process.env.TEST_WORKER_ID = FAILPATH_WORKER_ID;
      slotName =
        resolveDbPackageTestScope().postgresDatabaseName ?? "unset-slot-name";

      // Pre-bootstrap + migrate the throwaway slot exactly as a predecessor
      // file would leave it, then release that handle.
      const predecessor = await setupWorkerTestDatabase({
        scope: resolveDbPackageTestScope(),
      });
      await predecessor.close();

      // Block the next TRUNCATE for real: statement-level BEFORE TRUNCATE
      // trigger raising a recognizable error.
      await onSlotDatabase([
        `CREATE OR REPLACE FUNCTION test_block_reset() RETURNS trigger
           LANGUAGE plpgsql AS $$
         BEGIN
           RAISE EXCEPTION 'test_block_reset: TRUNCATE blocked for failure-path regression';
         END $$`,
        `CREATE TRIGGER test_block_reset_trg
           BEFORE TRUNCATE ON organizations
           FOR EACH STATEMENT EXECUTE FUNCTION test_block_reset()`,
      ]);
      expect(await otherBackendCount()).toBe(0);
    }, 30_000);

    afterAll(async () => {
      if (origWorkerId === undefined) {
        delete process.env.TEST_WORKER_ID;
      } else {
        process.env.TEST_WORKER_ID = origWorkerId;
      }
      if (slotName) {
        await dropDatabaseIfExists(ADMIN_URL, slotName);
      }
      await cleanupSlot?.();
    }, 30_000);

    it(
      "a failed first reset rejects AND releases the pool (no leaked backend)",
      { timeout: 30_000 },
      async () => {
        await expect(getWorkerScopedTestDb()).rejects.toThrow(
          /test_block_reset/,
        );
        // OWNERSHIP proof: the adapter owned the handle until returning the
        // fixture; after the rejection its pool must be closed — no other
        // backend may still be connected to the throwaway slot. On the
        // leaky code the failed max:1 pool's connection survives here.
        expect(await otherBackendCount()).toBe(0);
      },
    );

    it(
      "memo eviction lets the file retry once the failure is cleared",
      { timeout: 30_000 },
      async () => {
        await onSlotDatabase([
          "DROP TRIGGER IF EXISTS test_block_reset_trg ON organizations",
          "DROP FUNCTION IF EXISTS test_block_reset()",
        ]);

        const fixture = await getWorkerScopedTestDb();
        cleanupSlot = fixture.cleanup;
        expect(fixture.databaseName).toBe(slotName);
        // The retry re-ran the reset boundary (it never completed before),
        // so business writes work on a clean slot.
        const markerSlug = `failpath-marker-${randomUUID().slice(0, 8)}`;
        await fixture.db.insert(schema.organizations).values({
          id: randomUUID(),
          name: "failpath marker",
          displayName: "failpath marker",
          slug: markerSlug,
        });
        const rows = (await fixture.db.execute(
          sql`SELECT 1 FROM ${schema.organizations} WHERE slug = ${markerSlug}`,
        )) as unknown as Array<{ slug: string }>;
        expect(rows.length).toBe(1);
      },
    );
  },
);
