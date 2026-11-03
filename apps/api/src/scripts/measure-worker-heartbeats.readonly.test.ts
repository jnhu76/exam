/**
 * Read-only proof for measure-worker-heartbeat-growth (#800 D5): the tool's
 * session-level `SET default_transaction_read_only = on` must cover EVERY
 * statement the tool issues. That holds only because the measurement handle
 * is a single dedicated connection (`max: 1`) — a default pooled handle
 * would apply the session SET to one arbitrary connection while later
 * statements could run unguarded on others.
 *
 * The proof exercises the DEFAULT invocation path (no `--schema`): the
 * probe handle is built exactly like the script's fixed main path
 * (`createDatabase(undefined, undefined, { max: 1 })` + the same SET).
 * TEST_DATABASE_URL is pinned — save/restored, the same isolated-schema
 * steering server.shutdown.test.ts uses for env-resolving code under test —
 * so both the probe handle and the exported measurement function resolve
 * this file's migrated schema.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, migratePostgres } from "@exam/db";
import { resolveTestDbUrl } from "@exam/db/testDb";
import {
  addSearchPathToUrl,
  setupIsolatedTestDb,
} from "@exam/db/testIsolation";
import {
  measureWorkerHeartbeatGrowth,
  type WorkerHeartbeatsSnapshot,
} from "./measure-worker-heartbeat-growth.js";

describe("measure-worker-heartbeat-growth — read-only proof", () => {
  let conn: Awaited<ReturnType<typeof createDatabase>>;
  let cleanup: () => Promise<void>;
  let previousTestDatabaseUrl: string | undefined;

  beforeAll(async () => {
    const iso = await setupIsolatedTestDb({
      namespace: "script-hb-readonly",
      databaseUrl: resolveTestDbUrl(),
    });
    cleanup = iso.cleanup;
    conn = await createDatabase(resolveTestDbUrl(), iso.schemaName);
    await migratePostgres(conn.db, { migrationsSchema: iso.schemaName });
    previousTestDatabaseUrl = process.env.TEST_DATABASE_URL;
    process.env.TEST_DATABASE_URL = addSearchPathToUrl(
      resolveTestDbUrl(),
      iso.schemaName,
    );
  }, 30_000);

  afterAll(async () => {
    // Restore the exact prior env state (unset stays unset).
    if (previousTestDatabaseUrl === undefined) {
      delete process.env.TEST_DATABASE_URL;
    } else {
      process.env.TEST_DATABASE_URL = previousTestDatabaseUrl;
    }
    await conn.sql.end({ timeout: 10 });
    await cleanup();
  }, 30_000);

  async function countWorkerHeartbeats(): Promise<number> {
    const rows = (await conn.sql`SELECT count(*)::int AS count
      FROM worker_heartbeats`) as Array<{ count: number }>;
    return rows[0]!.count;
  }

  it("server rejects DML through the single-connection measurement handle", async () => {
    const handle = await createDatabase(undefined, undefined, { max: 1 });
    try {
      await handle.sql.unsafe("SET default_transaction_read_only = on");
      let caught: unknown;
      try {
        // No-op by predicate: the read-only refusal fires at executor start,
        // so rejecting this UPDATE proves the server refuses the WRITE
        // itself, not a row effect.
        await handle.sql.unsafe(
          "UPDATE worker_heartbeats SET worker_name = worker_name WHERE false",
        );
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeDefined();
      const pgErr = caught as { code?: string; message?: string };
      expect(
        pgErr.code === "25006" || /read-only/i.test(pgErr.message ?? ""),
      ).toBe(true);
    } finally {
      await handle.sql.end({ timeout: 10 });
    }
  });

  it("the default-path measurement returns a snapshot and mutates nothing", async () => {
    const before = await countWorkerHeartbeats();
    const measurement = await measureWorkerHeartbeatGrowth({
      sampleSeconds: 0,
      probeWorkerName: "readonly-proof",
    });
    // sampleSeconds <= 0 returns the single-snapshot shape.
    const snapshot = measurement as WorkerHeartbeatsSnapshot;
    expect(snapshot.totalRows).toBe(before);
    expect(await countWorkerHeartbeats()).toBe(before);
  });
});
