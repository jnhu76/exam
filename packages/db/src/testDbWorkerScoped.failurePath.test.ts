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
 *
 * #650: the count is observed through a bounded settle poll, not an
 * instantaneous read — postgres.js `close()` resolves on the client-side
 * Terminate while the server-side backend's pg_stat_activity row can lag
 * briefly behind the actual exit.
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

/**
 * Bounded settle wait for the server-side handle-release proof (#650).
 *
 * postgres.js `close()` resolves once the CLIENT has sent Terminate and
 * closed its socket; the server-side backend exits asynchronously and its
 * `pg_stat_activity` row disappears only when that process actually exits.
 * A just-closed connection to the throwaway slot can therefore remain
 * briefly visible in `pg_stat_activity` after its client-side close has
 * completed; the #650 beforeAll reproducer did not PID-attribute which
 * just-closed slot connection (predecessor pool or DDL connection) was
 * observed. A REAL leaked pool — the #648 P1-3 regression this file guards —
 * is different in kind: it keeps its backend connected indefinitely.
 *
 * The predicate stays EXACTLY `otherBackendCount() === 0`: the poll only
 * tolerates the short exit-visibility window, it never weakens the invariant.
 * Same bounded-polling precedent as `pollAdvisoryLocks` in
 * `testInfraLock.test.ts`: poll REAL server state until the predicate holds,
 * fail loudly at the deadline; no fixed sleep stands in for the ordering.
 *
 * 2_000ms deadline / 50ms interval: the observed exit lag is milliseconds
 * scale (#650 failed only when the count query ran ~1 round-trip after
 * close, and every immediate rerun passed), so 2s is orders of magnitude
 * above the real window while a genuine leak still fails fast — well inside
 * the unchanged 30s hook/test budgets. Each poll performs one short-lived
 * admin connection and one count query via the `otherBackendCount`
 * predicate verbatim; the 50ms cadence keeps the observation budget bounded
 * and the measured overhead negligible for this focused regression test.
 */
const BACKEND_EXIT_SETTLE_DEADLINE_MS = 2_000;
const BACKEND_EXIT_SETTLE_INTERVAL_MS = 50;

async function waitForNoOtherBackends(): Promise<void> {
  const deadline = Date.now() + BACKEND_EXIT_SETTLE_DEADLINE_MS;
  let count = await otherBackendCount();
  while (count !== 0) {
    if (Date.now() >= deadline) {
      throw new Error(
        `backend still connected to throwaway slot "${slotName}" ` +
          `after ${BACKEND_EXIT_SETTLE_DEADLINE_MS}ms (otherBackendCount=${count}) — ` +
          `a real #648 P1-3 handle leak never drains and must fail here`,
      );
    }
    await new Promise((r) => setTimeout(r, BACKEND_EXIT_SETTLE_INTERVAL_MS));
    count = await otherBackendCount();
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
      await waitForNoOtherBackends();
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
        // fixture; after the rejection its pool must be closed — no backend
        // may remain connected to the throwaway slot, settled within the
        // bounded server-exit window. On the leaky code the failed max:1
        // pool's connection survives indefinitely and the settle deadline
        // fails here. Unlike the beforeAll settle, the handle proven released
        // here is the adapter's own — the stronger direct #648 P1-3 evidence.
        await waitForNoOtherBackends();
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
