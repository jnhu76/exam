import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import {
  createPostgresDatabase,
  migratePostgres,
} from "@exam/db/src/postgres.js";
import { setupIsolatedTestDb } from "@exam/db/src/testIsolation.js";
import { schema } from "@exam/db/src/schema/pg.js";
import type { Database, TenantContext } from "@exam/db/src/types.js";
import { createBackupEvidenceRepo } from "@exam/db/src/repository/backupEvidenceRepo.js";
import { waitForBackendBlocked } from "../testing/pgConcurrencyProbes.js";

/**
 * Concurrent duplicate backup completion — the 23505 classification path of
 * `completeRun` (D10 #2), proven with TRUE overlap on independent
 * connections.
 *
 * `completeRun`'s code-level duplicate check runs inside a REPEATABLE READ
 * transaction: when another transaction commits a `succeeded` row for the
 * same operationId BETWEEN our read and our insert, the check cannot see it.
 * The partial unique index `backup_runs_org_operation_succeeded_unique` is
 * the physical backstop; the 23505 catch then classifies the conflict
 * (contradictory artifact → the attempt is recorded `failed` with
 * `duplicate_operation_conflict`, and the committed success is untouched).
 *
 * Schedule (deterministic, no timing races):
 *
 *   T1 (conn A, raw transaction) — INSERT a fully-verified `succeeded` row
 *                                  for operationId, HOLD it uncommitted.
 *   T2 (conn B, the REAL repo)   — completeRun(same operationId, DIFFERENT
 *                                  artifactLabel): its duplicate check sees
 *                                  no committed success, its INSERT of a
 *                                  second succeeded row waits on T1's
 *                                  pending unique-index entry (pg_locks:
 *                                  ungranted transactionid lock — real
 *                                  overlap, not pool queuing).
 *   COMMIT T1                    — T2's INSERT fails 23505 → the catch
 *                                  classifies and fails closed.
 *
 * The sequential duplicate path (second completion sees the committed
 * success through the code check) is covered by backupEvidence.test.ts;
 * that file's shared max:1 pool can never reach the 23505 branch.
 */
describe("backup completeRun concurrent duplicate — 23505 classification", () => {
  let iso: Awaited<ReturnType<typeof setupIsolatedTestDb>>;
  let dbMain: Database;
  let connA: postgres.Sql;
  let observer: postgres.Sql;
  let cleanupAll: () => Promise<void>;

  let orgId: string;
  let ctx: TenantContext;

  beforeAll(async () => {
    iso = await setupIsolatedTestDb({ namespace: "backup_dup_23505" });
    // OWNERSHIP: once the schema exists it must be dropped even if a later
    // setup step throws — register the floor cleanup immediately.
    cleanupAll = async () => {
      await iso.cleanup();
    };
    const main = await createPostgresDatabase(iso.databaseUrl, iso.schemaName);
    dbMain = main.db;
    connA = postgres(iso.databaseUrl, { max: 1 });
    await connA.unsafe(`SET search_path TO "${iso.schemaName}"`);
    observer = postgres(iso.databaseUrl, { max: 1 });
    await observer.unsafe(`SET search_path TO "${iso.schemaName}"`);

    await migratePostgres(dbMain, { migrationsSchema: iso.schemaName });

    orgId = randomUUID();
    const now = new Date();
    await dbMain.insert(schema.organizations).values({
      id: orgId,
      name: "Backup Dup Org",
      displayName: "Backup Dup Org",
      slug: `backup-dup-${orgId.slice(0, 8)}-${Date.now()}`,
      createdAt: now,
      updatedAt: now,
    });
    ctx = {
      organizationId: orgId,
      actorId: "test",
      role: "Admin",
      permissions: [],
    };

    const floorCleanup = cleanupAll;
    cleanupAll = async () => {
      await Promise.allSettled([main.sql.end(), connA.end(), observer.end()]);
      await floorCleanup();
    };
  }, 60_000);

  afterAll(async () => {
    if (cleanupAll) await cleanupAll();
  }, 30_000);

  it("completeRun losing the insert race is classified failed; the committed success survives untouched", async () => {
    const operationId = `logical:dup-${randomUUID().slice(0, 8)}`;
    const repoMain = createBackupEvidenceRepo(dbMain);
    const t = new Date("2026-10-01T00:00:00.000Z");

    // T1: hold an uncommitted fully-verified succeeded row.
    await connA.unsafe("BEGIN");
    await connA.unsafe(`
      INSERT INTO "backup_runs"
        ("id", "organization_id", "operation_id", "backup_type", "status",
         "started_at", "completed_at", "artifact_label", "artifact_size_bytes",
         "verification_method", "verification_status", "verified_at",
         "executor_type", "created_at", "updated_at")
      VALUES (
        '${randomUUID()}', '${orgId}', '${operationId}', 'logical', 'succeeded',
        '${t.toISOString()}', '${t.toISOString()}', 'early.dump', 100,
        'pg_restore_list', 'verified', '${t.toISOString()}',
        'host_script', '${t.toISOString()}', '${t.toISOString()}')
    `);

    // T2 runs on its own pinned connection; capture its backend pid while
    // the connection is still idle (once blocked it cannot answer probes).
    const connB = await createPostgresDatabase(iso.databaseUrl, iso.schemaName);
    try {
      const pidRows = (await connB.sql.unsafe(
        `SELECT pg_backend_pid() AS pid`,
      )) as Array<{ pid: number }>;
      const pidB = pidRows[0]!.pid;

      const t2 = createBackupEvidenceRepo(connB.db).completeRun(ctx, {
        operationId,
        backupType: "logical",
        artifactLabel: "late.dump",
        artifactSizeBytes: 100,
        verificationMethod: "pg_restore_list",
        verifiedAt: t,
        executorType: "host_script",
        now: t,
      });

      // Real-overlap evidence: T2 waits on T1's uncommitted unique-index
      // entry (transactionid wait). On a shared max:1 pool this wait cannot
      // exist.
      const blocked = await waitForBackendBlocked(observer, pidB);
      expect(blocked.blockedOnLocktype).toBe("transactionid");

      await connA.unsafe("COMMIT");

      // T2's insert loses the race with 23505; the catch classifies the
      // contradictory duplicate and fails closed.
      const result = await t2;
      expect(result.status).toBe("failed");
      expect(result.failureReason).toBe("duplicate_operation_conflict");

      // The committed success survives untouched; exactly one succeeded row.
      const runs = await repoMain.listRuns(ctx);
      const succeeded = runs.filter(
        (r) => r.operationId === operationId && r.status === "succeeded",
      );
      expect(succeeded).toHaveLength(1);
      expect(succeeded[0]!.artifactLabel).toBe("early.dump");
    } finally {
      await connB.sql.end();
    }
  }, 30_000);
});
