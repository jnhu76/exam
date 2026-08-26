/**
 * P7-S2-A — RESULT_PUBLISH_IS_SINGLE_WINNER deterministic concurrency proof.
 *
 * For one Exam, `resultsPublishedAt` transitions NULL → timestamp exactly
 * once. Two concurrent publishers (two physical connections, two
 * transactions) are interleaved with a deferred barrier so the overlap that
 * previously produced two winners is forced as far as the coordination
 * allows:
 *
 *   T1 acquires the exam row lock (FOR UPDATE) via `findByIdForUpdate` and
 *     signals t1LockHeld, then waits on allowT1Commit.
 *   T2 starts while T1 still holds the lock; its `findByIdForUpdate` blocks
 *     on the row lock (it signals t2LockAttempted immediately before the
 *     blocking SELECT).
 *   The controller releases T1 → T1 re-checks under lock, commits.
 *   T2 wakes with the committed truth and returns alreadyPublished=true
 *     (under REPEATABLE READ this is via the 40001 retry path; under READ
 *     COMMITTED the blocked SELECT simply re-reads the committed row).
 *
 * Overlap precision: T2 signals t2LockAttempted immediately BEFORE issuing its
 * blocking FOR UPDATE, so the row-lock blocking overlap is HIGHLY LIKELY (T1
 * still holds the lock) but not deterministically proven by this coordination
 * alone. The single-winner invariant does not depend on the overlap being
 * forced: T2 reads the committed row regardless.
 *
 * Proven invariants (run under both isolation levels):
 *   - exactly one caller owns the applied publication (alreadyPublished=false)
 *   - the loser observes already-published truth (alreadyPublished=true)
 *   - the stored timestamp is the winner's and never changes afterward
 *   - the two callers run on distinct physical connections (distinct PIDs)
 *
 * The old code shape (plain `findById` + unconditional UPDATE) fails this
 * test: both callers pass the NULL check, both update, both report first
 * publication, and one writer's evidence is overwritten (proven in the
 * temporary race-proof run under READ COMMITTED before the fix).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import {
  createPostgresDatabase,
  migratePostgres,
} from "@exam/db/src/postgres.js";
import { withTestInfraLifecycleLock } from "@exam/db/src/testInfraLock.js";
import { setupIsolatedTestDb } from "@exam/db/src/testIsolation.js";
import { resolveTestDbUrl } from "@exam/db/src/testDb.js";
import { schema } from "@exam/db/src/schema/pg.js";
import { createExamRepo } from "@exam/db/src/repository/examRepo.js";
import { executeInTransaction } from "@exam/db/src/types.js";
import { publishResults } from "@exam/exam-engine";
import type { ExamRepository } from "@exam/exam-engine";
import type { RequestContext } from "@exam/domain";
import type { Database, TransactionDatabase } from "@exam/db/src/types.js";
import { createExamRepoAdapter } from "../adapters/repoAdapters.js";
import { createDeferred, type Deferred } from "../testing/barrier.js";

const ORG_ID = `pr-race-${randomUUID().slice(0, 8)}`;
const ACTOR_ID = `actor-${randomUUID().slice(0, 8)}`;

function makeCtx(): RequestContext {
  return {
    actorId: ACTOR_ID,
    organizationId: ORG_ID,
    role: "Admin",
    permissions: [],
    sessionId: randomUUID(),
  };
}

interface PublishRaceBarrier {
  /** Fired when T1's `findByIdForUpdate` has ACQUIRED the row lock. */
  t1LockHeld: Deferred<void>;
  /** Resolved by the controller to release T1 past its lock-hold gate. */
  allowT1Commit: Deferred<void>;
  /** Fired immediately before T2's blocking `findByIdForUpdate`. */
  t2LockAttempted: Deferred<void>;
  dispose(): void;
}

function createBarrier(): PublishRaceBarrier {
  const d = {
    t1LockHeld: createDeferred<void>("t1 lock held"),
    allowT1Commit: createDeferred<void>("allow t1 commit"),
    t2LockAttempted: createDeferred<void>("t2 lock attempted"),
  };
  return {
    ...d,
    dispose() {
      for (const deferred of [
        d.t1LockHeld,
        d.allowT1Commit,
        d.t2LockAttempted,
      ]) {
        if (!deferred.isSettled()) deferred.resolve(undefined as never);
      }
    },
  };
}

function createBarrierExamRepoProxy(
  tx: TransactionDatabase,
  ctx: RequestContext,
  hooks: {
    afterFindByIdForUpdate?: () => Promise<void>;
    beforeFindByIdForUpdate?: () => Promise<void>;
  },
): ExamRepository {
  const real = createExamRepoAdapter(createExamRepo(tx), ctx);
  return {
    ...real,
    findByIdForUpdate: async (examId: string) => {
      if (hooks.beforeFindByIdForUpdate) {
        await hooks.beforeFindByIdForUpdate();
      }
      const row = await real.findByIdForUpdate(examId);
      if (hooks.afterFindByIdForUpdate) {
        await hooks.afterFindByIdForUpdate();
      }
      return row;
    },
  };
}

describe("P7-S2-A: result publication is single-winner", () => {
  let iso: Awaited<ReturnType<typeof setupIsolatedTestDb>>;
  let db1: Database;
  let db2: Database;
  let sql1: { end(): Promise<void> };
  let sql2: { end(): Promise<void> };
  let sharedSql: { end(): Promise<void> } | undefined;
  let courseId: string;

  /** Inserts a fresh unpublished exam; each test gets its own row. */
  async function insertUnpublishedExam(db: Database): Promise<string> {
    const examId = randomUUID();
    const now = new Date();
    await db.insert(schema.exams).values({
      id: examId,
      organizationId: ORG_ID,
      title: "race-exam",
      description: "",
      courseId,
      status: "published",
      timingMode: "timed_window",
      durationMinutes: 60,
      openAt: now,
      closeAt: new Date(now.getTime() + 86400_000),
      passingScore: 60,
      totalScore: 100,
      questionSelectionMode: "manual",
      questionIds: [],
      questionSnapshot: [],
      controlFlags: {
        shuffleQuestions: false,
        shuffleOptions: false,
        detectTabSwitch: false,
        disableCopyPaste: false,
        requireQueue: false,
        batchSize: 10,
        batchInterval: 3,
        restrictIp: false,
        requireLockdown: false,
        showResultImmediately: true,
      },
      retakePolicy: "unlimited",
      scoreStrategy: "highest",
      maxAttempts: 1,
      interruptionTimePolicy: "operator_incident",
      createdAt: now,
      updatedAt: now,
    });
    return examId;
  }

  beforeAll(async () => {
    const testDbUrl = resolveTestDbUrl();
    iso = await setupIsolatedTestDb({
      namespace: "prrace",
      databaseUrl: testDbUrl,
    });
    const shared = await createPostgresDatabase(
      iso.databaseUrl,
      iso.schemaName,
    );
    sharedSql = shared.sql;
    await withTestInfraLifecycleLock(iso.databaseUrl, () =>
      migratePostgres(shared.db, { migrationsSchema: iso.schemaName }),
    );

    const now = new Date();
    await shared.db.insert(schema.organizations).values({
      id: ORG_ID,
      name: ORG_ID,
      displayName: ORG_ID,
      slug: ORG_ID,
      createdAt: now,
      updatedAt: now,
    });
    await shared.db.insert(schema.users).values({
      id: ACTOR_ID,
      organizationId: ORG_ID,
      username: `usr-${randomUUID().slice(0, 8)}`,
      passwordHash: "x",
      name: "Actor",
      role: "Admin",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    courseId = randomUUID();
    await shared.db.insert(schema.courses).values({
      id: courseId,
      organizationId: ORG_ID,
      name: "c",
      code: `code-${randomUUID().slice(0, 6)}`,
      description: "",
      createdAt: now,
      updatedAt: now,
    });

    const c1 = await createPostgresDatabase(iso.databaseUrl, iso.schemaName);
    const c2 = await createPostgresDatabase(iso.databaseUrl, iso.schemaName);
    db1 = c1.db;
    db2 = c2.db;
    sql1 = c1.sql;
    sql2 = c2.sql;
  }, 120_000);

  afterAll(async () => {
    await Promise.allSettled([
      sql2?.end() ?? Promise.resolve(),
      sql1?.end() ?? Promise.resolve(),
      sharedSql?.end() ?? Promise.resolve(),
    ]);
    await iso?.cleanup().catch(() => {});
  });

  for (const isolation of ["read committed", "repeatable read"] as const) {
    it(`forced overlap (${isolation}): exactly one winner, immutable timestamp`, async () => {
      const ctx = makeCtx();
      const barrier = createBarrier();
      const examId = await insertUnpublishedExam(db1);
      const winnerNow = new Date("2026-08-09T10:00:00.000Z");
      const loserNow = new Date("2026-08-09T11:00:00.000Z");

      // In-transaction identity captured by each caller (distinct connections).
      const observations: { pid: number; txid: string }[] = [];
      async function captureObservation(
        tx: TransactionDatabase,
      ): Promise<void> {
        const rows = (await tx.execute(
          sql`SELECT pg_backend_pid() AS pid, txid_current()::text AS txid`,
        )) as unknown as Array<{ pid: number; txid: string }>;
        observations.push({
          pid: Number(rows[0]?.pid ?? 0),
          txid: String(rows[0]?.txid ?? ""),
        });
      }

      // T1: the winner. Gated AFTER its FOR UPDATE has acquired the row lock.
      const t1Promise = executeInTransaction(
        db1,
        async (tx) => {
          await captureObservation(tx);
          const repo = createBarrierExamRepoProxy(tx, ctx, {
            afterFindByIdForUpdate: async () => {
              barrier.t1LockHeld.resolve();
              await barrier.allowT1Commit.promise;
            },
          });
          return publishResults(repo, examId, winnerNow);
        },
        isolation,
      );

      try {
        // Wait until T1 provably holds the exam row lock.
        await barrier.t1LockHeld.promise;

        // T2: the loser. Signals immediately before its (blocking) FOR UPDATE.
        const t2Promise = executeInTransaction(
          db2,
          async (tx) => {
            await captureObservation(tx);
            const repo = createBarrierExamRepoProxy(tx, ctx, {
              beforeFindByIdForUpdate: async () => {
                barrier.t2LockAttempted.resolve();
              },
            });
            return publishResults(repo, examId, loserNow);
          },
          isolation,
        );

        // T2 has signalled it is about to issue its (blocking) FOR UPDATE;
        // release T1 to commit. NB: T2 signals immediately BEFORE the blocking
        // SELECT, so blocking overlap is HIGHLY LIKELY (T1 still holds the lock
        // when T2 reaches FOR UPDATE) but not deterministically guaranteed by
        // this coordination alone. The single-winner invariant holds either way
        // (T2 reads the committed row, via blocked re-read under READ COMMITTED
        // or the 40001-retry path under REPEATABLE READ).
        await barrier.t2LockAttempted.promise;
        barrier.allowT1Commit.resolve();

        const [winner, loser] = await Promise.all([t1Promise, t2Promise]);

        // Exactly one caller owns the applied publication.
        expect(winner.alreadyPublished).toBe(false);
        expect(loser.alreadyPublished).toBe(true);

        // The loser observes the winner's committed truth — never its own now.
        expect((loser.exam.resultsPublishedAt as Date).toISOString()).toBe(
          winnerNow.toISOString(),
        );
        expect(winner.exam.resultsPublishedAt).not.toBeNull();

        // The stored timestamp is the winner's and is immutable.
        const stored = (await createExamRepo(db1).findById(ctx, examId)) as {
          resultsPublishedAt: Date | null;
        } | null;
        expect(stored?.resultsPublishedAt?.toISOString()).toBe(
          winnerNow.toISOString(),
        );

        // The two callers ran on distinct physical connections; under REPEATABLE
        // READ the loser's 40001-retry adds extra observations, so assert
        // distinctness (>= 2) rather than an exact count.
        expect(
          new Set(observations.map((o) => o.pid)).size,
        ).toBeGreaterThanOrEqual(2);
        expect(
          new Set(observations.map((o) => o.txid)).size,
        ).toBeGreaterThanOrEqual(2);
      } finally {
        // Always dispose the barrier so an assertion failure does not leak a
        // pending deferred-promise that would hang the worker on teardown.
        barrier.dispose();
      }
    });
  }
});
