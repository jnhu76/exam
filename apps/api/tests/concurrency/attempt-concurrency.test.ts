import { describe, expect, it, beforeAll, afterAll } from "vitest";
import {
  createPostgresDatabase,
  migratePostgres,
} from "@exam/db/src/postgres.js";
import { schema } from "@exam/db/src/schema/pg.js";
import { resolveTestDbUrl } from "@exam/db/src/testDb.js";
import type { Database } from "@exam/db/src/types.js";
import { createAttemptRepo } from "@exam/db/src/repository/attemptRepo.js";
import { hashPassword } from "@exam/auth/src/password.js";
import { seed } from "@exam/db/src/seed.js";
import { setupIsolatedTestDb } from "@exam/db/src/testIsolation.js";
import { createDeferred } from "../../src/testing/barrier.js";
import { collectConnectionEvidence } from "../../src/testing/operatorGrantConcurrencyHarness.js";
import {
  probeRowLockHeldNowait,
  waitForBackendBlocked,
  type ObserverSql,
} from "../../src/testing/pgConcurrencyProbes.js";

/**
 * Attempt-row serialization against real PostgreSQL — deterministic
 * two-session proofs.
 *
 * The previous version of the second test ran both transactions on ONE
 * max:1 pool: the observed "blocking" was pool queuing, not row locking
 * (proven by a targeted mutation that removed FOR UPDATE — the test stayed
 * green). The parked schedule below uses two INDEPENDENT physical sessions
 * (distinct max:1 pools, distinct backend pids) and an observer connection,
 * so the blocking is attributable to the row lock itself:
 *
 *   Session A: BEGIN → Attempt FOR UPDATE (row lock held) → read answers →
 *              signal locked-and-read → PARK → write version+1 → COMMIT
 *   Observer:  SELECT ... FOR UPDATE NOWAIT on the attempt row is rejected
 *              with SQLSTATE 55P03 — session A provably holds the row lock.
 *   Session B: BEGIN → Attempt FOR UPDATE → blocks (pg_locks ungranted-lock
 *              probe on B's pid) → wakes only after A commits → must read
 *              the post-commit answer version → writes version+1 → COMMIT
 *
 * Oracle: the two committed versions are exactly {1, 2} (a permutation) and
 * the durable final answer version is 2. Removing the row lock fails this
 * deterministically: session B would complete its read-modify-write during
 * A's park and both would write the same version.
 */

interface Fixture {
  db: Database;
  orgId: string;
  candidateUserId: string;
  candidateProfileId: string;
  examId: string;
  enrollmentId: string;
  questionId: string;
}

async function buildFixture(db: Database): Promise<Fixture> {
  const seedResult = await seed(db, hashPassword);
  const orgId = seedResult.orgId;

  const courseId = crypto.randomUUID();
  await db.insert(schema.courses).values({
    id: courseId,
    organizationId: orgId,
    name: "Concurrency Course",
    code: `CC-${Date.now()}`,
    description: "",
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const questionId = crypto.randomUUID();
  await db.insert(schema.questions).values({
    id: questionId,
    organizationId: orgId,
    courseId,
    type: "true_false",
    content: "Test question",
    options: [],
    standardAnswer: true,
    attachments: [],
    score: 10,
    difficulty: 1,
    tags: [],
    gradingRule: {
      multiSelectScoring: "all_correct_full",
      fillBlankMatchMode: "exact",
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const examId = crypto.randomUUID();
  await db.insert(schema.exams).values({
    id: examId,
    organizationId: orgId,
    courseId,
    title: "Concurrency Exam",
    description: "",
    status: "published",
    timingMode: "timed_window",
    durationMinutes: 60,
    openAt: new Date(Date.now() - 3600000),
    closeAt: new Date(Date.now() + 86400000),
    passingScore: 60,
    totalScore: 100,
    questionSelectionMode: "manual",
    questionIds: [questionId],
    questionSnapshot: [{ originalQuestionId: questionId, score: 10 }],
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
    maxAttempts: 3,
    publishedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const candidateUserId = crypto.randomUUID();
  await db.insert(schema.users).values({
    id: candidateUserId,
    organizationId: orgId,
    username: `conc-${Date.now()}`,
    passwordHash: "unused",
    name: "Concurrency Candidate",
    role: "Candidate",
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const candidateProfileId = crypto.randomUUID();
  await db.insert(schema.candidateProfiles).values({
    id: candidateProfileId,
    organizationId: orgId,
    userId: candidateUserId,
    fields: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const enrollmentId = crypto.randomUUID();
  await db.insert(schema.examEnrollments).values({
    id: enrollmentId,
    organizationId: orgId,
    examId,
    candidateId: candidateProfileId,
    status: "started",
    attemptCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  return {
    db,
    orgId,
    candidateUserId,
    candidateProfileId,
    examId,
    enrollmentId,
    questionId,
  };
}

function makeCtx(fx: Fixture) {
  return {
    organizationId: fx.orgId,
    actorId: fx.candidateUserId,
    role: "Candidate" as const,
    permissions: [] as import("@exam/domain").Permission[],
    targetOrganizationId: fx.orgId,
  };
}

async function insertAttempt(
  fx: Fixture,
  attemptNo: number,
  status: string,
  extra?: Record<string, unknown>,
) {
  const rows = await fx.db
    .insert(schema.examAttempts)
    .values({
      id: crypto.randomUUID(),
      organizationId: fx.orgId,
      examId: fx.examId,
      enrollmentId: fx.enrollmentId,
      candidateId: fx.candidateProfileId,
      attemptNo,
      status,
      questionSnapshot: [
        {
          originalQuestionId: fx.questionId,
          score: 10,
          type: "true_false",
          content: "Test",
        },
      ],
      answers: [],
      deadlineAt: new Date(Date.now() + 3600000),
      startedAt: new Date(),
      lastActivityAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      ...extra,
    })
    .returning({ id: schema.examAttempts.id });
  return rows[0]!.id;
}

/** One locked read-modify-write of the single answer, like a parallel save. */
async function lockedReadModifyWrite(
  db: Database,
  fx: Fixture,
  ctx: ReturnType<typeof makeCtx>,
  rowId: string,
  park?: {
    lockedAndRead: ReturnType<typeof createDeferred<void>>;
    release: ReturnType<typeof createDeferred<void>>;
  },
): Promise<number> {
  return db.transaction(async (tx) => {
    const txRepo = createAttemptRepo(tx as unknown as Database);
    const locked = await txRepo.findByIdForUpdate(ctx, rowId);
    if (!locked) throw new Error("not found");
    if (park) {
      park.lockedAndRead.resolve();
      await park.release.promise;
    }
    const current = (locked.answers ?? []) as Array<{
      questionId: string;
      version: number;
    }>;
    const existing = current.find((a) => a.questionId === fx.questionId);
    const nextVersion = (existing?.version ?? 0) + 1;
    const updated = current.filter((a) => a.questionId !== fx.questionId);
    updated.push({
      questionId: fx.questionId,
      answer: true,
      version: nextVersion,
      savedAt: new Date(),
    });
    await txRepo.update(ctx, rowId, {
      answers: updated,
      lastActivityAt: new Date(),
    });
    return nextVersion;
  });
}

describe("PG concurrency — attempt row-level serialization", () => {
  let iso: Awaited<ReturnType<typeof setupIsolatedTestDb>>;
  let fx: Fixture;
  let ctx: ReturnType<typeof makeCtx>;
  let attemptId: string;
  let dbB: Database;
  let sqlObserver: ObserverSql;
  let teardown: () => Promise<void>;

  beforeAll(async () => {
    iso = await setupIsolatedTestDb({
      namespace: "concurrency",
      databaseUrl: resolveTestDbUrl(),
    });
    const connMain = await createPostgresDatabase(
      iso.databaseUrl,
      iso.schemaName,
    );
    const connB = await createPostgresDatabase(iso.databaseUrl, iso.schemaName);
    const connObserver = await createPostgresDatabase(
      iso.databaseUrl,
      iso.schemaName,
    );
    await migratePostgres(connMain.db, { migrationsSchema: iso.schemaName });
    fx = await buildFixture(connMain.db);
    ctx = makeCtx(fx);
    attemptId = await insertAttempt(fx, 1, "in_progress");
    dbB = connB.db;
    sqlObserver = connObserver.sql;
    teardown = async () => {
      await connObserver.sql.end();
      await connB.sql.end();
      await connMain.sql.end();
      await iso.cleanup();
    };
  }, 60_000);

  afterAll(async () => {
    await teardown();
  }, 30_000);

  it("rollback: save error does not modify attempt row", async () => {
    const repo = createAttemptRepo(fx.db);
    const before = await repo.findById(ctx, attemptId);
    const answersBefore = JSON.stringify(before?.answers);

    await expect(
      fx.db.transaction(async (tx) => {
        const txRepo = createAttemptRepo(tx as unknown as Database);
        await txRepo.findByIdForUpdate(ctx, attemptId);
        await txRepo.update(ctx, attemptId, {
          answers: [
            {
              questionId: fx.questionId,
              answer: true,
              version: 1,
              savedAt: new Date(),
            },
          ],
        });
        throw new Error("simulated failure");
      }),
    ).rejects.toThrow("simulated failure");

    const after = await repo.findById(ctx, attemptId);
    expect(JSON.stringify(after?.answers)).toBe(answersBefore);
    expect(after?.status).toBe(before?.status);
  });

  it("two-session read-modify-write: the second FOR UPDATE blocks until the first commits, versions form a permutation", async () => {
    const rowId = await insertAttempt(fx, 2, "in_progress");

    const pidA = (await collectConnectionEvidence(fx.db)).pid;
    const pidB = (await collectConnectionEvidence(dbB)).pid;
    expect(pidA).not.toBe(pidB);

    const park = {
      lockedAndRead: createDeferred<void>("rmw-locked-and-read"),
      release: createDeferred<void>("rmw-release"),
    };

    // Session A locks and reads, then parks BEFORE its write.
    const saveA = lockedReadModifyWrite(fx.db, fx, ctx, rowId, park);
    await park.lockedAndRead.promise;

    // Observer: session A really holds the attempt row lock right now.
    const nowait = await probeRowLockHeldNowait(
      sqlObserver,
      "exam_attempts",
      rowId,
    );
    expect(nowait.acquired).toBe(false);
    if (!nowait.acquired) {
      expect(nowait.sqlstate).toBe("55P03");
    }

    // Session B, independent backend: its FOR UPDATE must block on A's lock.
    const saveB = lockedReadModifyWrite(dbB, fx, ctx, rowId);
    const blocked = await waitForBackendBlocked(sqlObserver, pidB);
    expect(["relation", "transactionid", "tuple"]).toContain(
      blocked.blockedOnLocktype,
    );

    park.release.resolve();
    const versions = await Promise.all([saveA, saveB]);

    // Both writes landed, each on top of the other's committed state.
    versions.sort((a, b) => a - b);
    expect(versions).toEqual([1, 2]);

    const repo = createAttemptRepo(fx.db);
    const final = await repo.findById(ctx, rowId);
    const answers = final!.answers as Array<{ version: number }>;
    expect(answers).toHaveLength(1);
    expect(answers[0]!.version).toBe(2);
  }, 30_000);
});
