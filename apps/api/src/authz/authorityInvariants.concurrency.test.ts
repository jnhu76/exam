import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import {
  createPostgresDatabase,
  migratePostgres,
} from "@exam/db/src/postgres.js";
import { setupIsolatedTestDb } from "@exam/db/src/testIsolation.js";
import { schema, type AssignableRole } from "@exam/db/src/schema/pg.js";
import type { Database, TenantContext } from "@exam/db/src/types.js";
import { createUserRepo } from "@exam/db/src/repository/userRepo.js";
import { createUserRoleAssignmentRepo } from "@exam/db/src/repository/userRoleAssignmentRepo.js";
import { hashPassword } from "@exam/auth/src/password.js";
import { mutateWithAuthorityInvariants } from "./adminMaintainerExclusion.js";
import { createDeferred } from "../testing/barrier.js";
import { waitForBackendBlocked } from "../testing/pgConcurrencyProbes.js";

/**
 * Authority-invariant write-skew prevention — the D14 (ADR-017) concurrent
 * fault model, proven with TRUE overlap on independent connections.
 *
 * The load-bearing claim in the authority seam is the pair
 * `pg_advisory_xact_lock` + READ COMMITTED: the second transaction must take
 * its snapshot AFTER the lock is granted, so its post-condition observes the
 * first transaction's committed rows. Two schedules break this claim and are
 * the mutants this test discriminates:
 *
 *   - advisory lock removed       → T2 never waits, both commit, the actor
 *                                   ends up Admin+Maintainer (write-skew).
 *   - isolation REPEATABLE READ   → T2's snapshot is taken at its first
 *                                   statement (the lock acquisition, BEFORE
 *                                   T1 commits), the post-condition misses
 *                                   T1's Maintainer row, both commit.
 *
 * Schedule (deterministic, no timing races):
 *
 *   T1 (conn A) — enter mutateWithAuthorityInvariants, acquire the org
 *                 advisory lock, assign Maintainer, SIGNAL, PARK still
 *                 holding the lock (mid-transaction).
 *   T2 (conn B) — enter mutateWithAuthorityInvariants, assign Admin, block
 *                 inside pg_advisory_xact_lock (pg_locks: ungranted advisory
 *                 lock on B's pid — real overlap, not pool queuing).
 *   Release T1  — T1's post-condition sees no Admin, commits.
 *   T2 resumes  — acquires the lock, assigns Admin, post-condition reads
 *                 under READ COMMITTED, sees T1's COMMITTED Maintainer row,
 *                 rejects with ADMIN_MAINTAINER_EXCLUSION.
 *
 * The sequential (pool-queued) shape of this schedule is covered by the
 * single-connection tests in adminInvariant.test.ts and
 * adminMaintainerExclusion.test.ts; those cannot prove overlap — their
 * connections are max:1 pools, so "concurrent" promise pairs there run in
 * dispatch order.
 */
describe("authority-invariants write-skew prevention — real overlap", () => {
  let iso: Awaited<ReturnType<typeof setupIsolatedTestDb>>;
  let dbMain: Database;
  let dbA: Database;
  let connB: Awaited<ReturnType<typeof createPostgresDatabase>>;
  let observer: postgres.Sql;
  let cleanupAll: () => Promise<void>;

  let orgId: string;
  let ctx: TenantContext;

  beforeAll(async () => {
    iso = await setupIsolatedTestDb({ namespace: "authority_write_skew" });
    // OWNERSHIP: once the schema exists it must be dropped even if a later
    // setup step throws — register the floor cleanup immediately, then
    // extend it as connections come up.
    cleanupAll = async () => {
      await iso.cleanup();
    };
    const mk = async () =>
      await createPostgresDatabase(iso.databaseUrl, iso.schemaName);
    const main = await mk();
    const a = await mk();
    const b = await mk();
    dbMain = main.db;
    dbA = a.db;
    connB = b;
    observer = postgres(iso.databaseUrl, { max: 1 });
    await observer.unsafe(`SET search_path TO "${iso.schemaName}"`);

    // Only the FIRST connection migrates; the others share the schema.
    await migratePostgres(dbMain, { migrationsSchema: iso.schemaName });

    orgId = randomUUID();
    const now = new Date();
    await dbMain.insert(schema.organizations).values({
      id: orgId,
      name: "Write-Skew Org",
      displayName: "Write-Skew Org",
      slug: `write-skew-${orgId.slice(0, 8)}-${Date.now()}`,
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
      await Promise.allSettled([
        main.sql.end(),
        a.sql.end(),
        b.sql.end(),
        observer.end(),
      ]);
      await floorCleanup();
    };
  }, 60_000);

  afterAll(async () => {
    if (cleanupAll) await cleanupAll();
  }, 30_000);

  it("T2 blocked on the advisory lock observes T1's committed Maintainer row and rejects (no write-skew)", async () => {
    // A brand-new actor with no authority assignments: whichever half
    // commits first, the other half must be rejected by the post-condition.
    const actor = await createUserRepo(dbMain).create(ctx, {
      username: `write-skew-actor-${randomUUID().slice(0, 8)}`,
      passwordHash: await hashPassword("password123"),
      name: "Write-Skew Actor",
      role: "Candidate",
      isActive: true,
    });

    // T2's backend pid, captured BEFORE T2 starts (its connection is idle
    // now; once blocked, it cannot answer probes).
    const pidRows = (await connB.sql.unsafe(
      `SELECT pg_backend_pid() AS pid`,
    )) as Array<{ pid: number }>;
    const pidB = pidRows[0]!.pid;

    const t1Assigned = createDeferred<void>("t1-maintainer-assigned");
    const releaseT1 = createDeferred<void>("t1-release");

    const t1 = mutateWithAuthorityInvariants(dbA, ctx, async (tx) => {
      await createUserRoleAssignmentRepo(tx).assignWithinTransaction(tx, ctx, {
        userId: actor.id,
        role: "Maintainer" as AssignableRole,
        isPrimary: true,
        isActive: true,
      });
      t1Assigned.resolve();
      // Park mid-transaction, still holding the org advisory lock.
      await releaseT1.promise;
    });

    // T1 is inside its transaction with the Maintainer row written.
    await t1Assigned.promise;

    const t2 = mutateWithAuthorityInvariants(connB.db, ctx, async (tx) => {
      await createUserRoleAssignmentRepo(tx).assignWithinTransaction(tx, ctx, {
        userId: actor.id,
        role: "Admin" as AssignableRole,
        isPrimary: true,
        isActive: true,
      });
    });

    // Real-overlap evidence: T2 waits on an UNGRANTED advisory lock while T1
    // is parked mid-transaction. On the shared max:1 pool this wait cannot
    // exist — pool queuing would keep T2's transaction from even starting.
    const blocked = await waitForBackendBlocked(observer, pidB);
    expect(blocked.blockedOnLocktype).toBe("advisory");

    // Release T1: its post-condition sees no Admin, so it commits.
    releaseT1.resolve();
    await expect(t1).resolves.toBeUndefined();

    // T2 proceeds under READ COMMITTED: its snapshot is taken AFTER the lock
    // grant, so the post-condition must see T1's committed Maintainer row
    // and reject the Admin assignment (the write-skew D14 forbids).
    await expect(t2).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      details: { reason: "ADMIN_MAINTAINER_EXCLUSION" },
    });

    // Durable state: exactly the Maintainer assignment survived.
    const rows = await createUserRoleAssignmentRepo(dbMain).listForUser(
      ctx,
      actor.id,
    );
    const activeRoles = rows
      .filter((r) => r.isActive)
      .map((r) => r.role)
      .sort();
    expect(activeRoles).toEqual(["Maintainer"]);
  }, 30_000);
});
