import { describe, expect, it, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import {
  createPostgresDatabase,
  migratePostgres,
} from "@exam/db/src/postgres.js";
import { schema } from "@exam/db/src/schema/pg.js";
import { resolveTestDbUrl } from "@exam/db/src/testDb.js";
import type { Database } from "@exam/db/src/types.js";
import { createAttemptRepo } from "@exam/db/src/repository/attemptRepo.js";
import { createEnrollmentRepo } from "@exam/db/src/repository/enrollmentRepo.js";
import { hashPassword } from "@exam/auth/src/password.js";
import { seed } from "@exam/db/src/seed.js";
import { setupIsolatedTestDb } from "@exam/db/src/testIsolation.js";
import { lockEnrollmentAndAttempt } from "@exam/exam-engine";
import { createDeferred } from "../../src/testing/barrier.js";
import { collectConnectionEvidence } from "../../src/testing/operatorGrantConcurrencyHarness.js";
import {
  probeRowLockHeldNowait,
  waitForBackendBlocked,
  type ObserverSql,
} from "../../src/testing/pgConcurrencyProbes.js";
import {
  createAttemptRepoAdapter,
  createEnrollmentRepoAdapter,
} from "../../src/adapters/repoAdapters.js";

/**
 * EA↔AE lock-order cycle prevention + tx-bound repository lifecycle
 * semantics — deterministic, real-overlap proofs.
 *
 * Test 1 — lock-order cycle prevention (the historical 40P01 regression
 * class). Two INDEPENDENT physical sessions (distinct max:1 pools, distinct
 * backend pids) with a pinned schedule:
 *
 *   Session A — natural EA order (the startOrRestoreAttempt shape):
 *     Enrollment FOR UPDATE → signal eHeld → PARK → Attempt FOR UPDATE → commit
 *   Observer — independent connection:
 *     `SELECT ... FOR UPDATE NOWAIT` on the enrollment row is rejected with
 *     SQLSTATE 55P03: session A provably holds the Enrollment row lock while
 *     the Attempt lock is NOT yet held.
 *   Session B — the REAL canonical seam (lockEnrollmentAndAttempt):
 *     locator read → Enrollment FOR UPDATE → blocks on session A's row lock
 *     (pg_locks ungranted-lock probe on B's pid; B's only lock acquisition up
 *     to that point is the Enrollment FOR UPDATE, so the wait is attributable
 *     to A's held lock).
 *   Release A: A acquires the Attempt lock and commits; B wakes, acquires
 *   E then A, commits. Both fulfill with NO 40P01 — under the canonical
 *   E-before-A order no cycle is constructible even with true overlap.
 *
 *   (A reversed seam — Attempt FOR UPDATE before Enrollment FOR UPDATE —
 *   under this same schedule acquires the free Attempt lock, then blocks on
 *   A's Enrollment lock; releasing A makes A block on B's Attempt lock: a
 *   real cycle and a 40P01. That reversal is exercised by targeted mutation
 *   validation, not by a committed mutant.)
 *
 * Test 2 — tx-bound repository lifecycle characterization. A repository
 * captured inside a transaction KEEPS EXECUTING after the transaction ends
 * (reads return rows; a write after ROLLBACK lands durably in autocommit on
 * the pooled connection). This pins the REAL driver behavior
 * (Drizzle 0.45 / postgres.js 3.4): there is NO post-end rejection. Safety
 * arguments must not rely on one — see the follow-up issue tracking the
 * capability-boundary hardening.
 */

interface Fixture {
  orgId: string;
  candidateUserId: string;
  candidateProfileId: string;
  examId: string;
  enrollmentId: string;
  questionId: string;
  attemptId: string;
}

async function buildFixture(db: Database): Promise<Fixture> {
  const seedResult = await seed(db, hashPassword);
  const orgId = seedResult.orgId;

  const courseId = crypto.randomUUID();
  await db.insert(schema.courses).values({
    id: courseId,
    organizationId: orgId,
    name: "EA Lock Order Course",
    code: `EA-${Date.now()}`,
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
    content: "EA lock-order question",
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
    title: "EA Lock Order Exam",
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
    username: `ealo-${Date.now()}`,
    passwordHash: "unused",
    name: "EA Lock Order Candidate",
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

  const attemptRows = await db
    .insert(schema.examAttempts)
    .values({
      id: crypto.randomUUID(),
      organizationId: orgId,
      examId,
      enrollmentId,
      candidateId: candidateProfileId,
      attemptNo: 1,
      status: "in_progress",
      questionSnapshot: [
        {
          originalQuestionId: questionId,
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
    })
    .returning({ id: schema.examAttempts.id });

  return {
    orgId,
    candidateUserId,
    candidateProfileId,
    examId,
    enrollmentId,
    questionId,
    attemptId: attemptRows[0]!.id,
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

describe("EA lock-order and tx-bound repo lifecycle (real sessions)", () => {
  let iso: Awaited<ReturnType<typeof setupIsolatedTestDb>>;
  let dbA: Database;
  let dbB: Database;
  let dbSeed: Database;
  let sqlObserver: ObserverSql;
  let fx: Fixture;
  let ctx: ReturnType<typeof makeCtx>;
  let teardown: () => Promise<void>;

  beforeAll(async () => {
    iso = await setupIsolatedTestDb({
      namespace: "ea_lock_order",
      databaseUrl: resolveTestDbUrl(),
    });
    // Three INDEPENDENT max:1 connections: racer A, racer B, and a
    // probe-only observer that never queues behind a parked racer.
    const connA = await createPostgresDatabase(iso.databaseUrl, iso.schemaName);
    const connB = await createPostgresDatabase(iso.databaseUrl, iso.schemaName);
    const connSeed = await createPostgresDatabase(
      iso.databaseUrl,
      iso.schemaName,
    );
    const connObserver = await createPostgresDatabase(
      iso.databaseUrl,
      iso.schemaName,
    );
    dbA = connA.db;
    dbB = connB.db;
    dbSeed = connSeed.db;
    sqlObserver = connObserver.sql;
    await migratePostgres(dbSeed, { migrationsSchema: iso.schemaName });
    fx = await buildFixture(dbSeed);
    ctx = makeCtx(fx);
    teardown = async () => {
      await connObserver.sql.end();
      await connSeed.sql.end();
      await connB.sql.end();
      await connA.sql.end();
      await iso.cleanup();
    };
  }, 60_000);

  afterAll(async () => {
    await teardown();
  }, 30_000);

  it("true overlap, canonical E→A order: a parked natural-EA holder does not deadlock the canonical seam — no 40P01", async () => {
    const pidA = (await collectConnectionEvidence(dbA)).pid;
    const pidB = (await collectConnectionEvidence(dbB)).pid;
    expect(pidA).not.toBe(pidB);

    const eHeld = createDeferred<void>("natural-ea-enrollment-held");
    const releaseA = createDeferred<void>("natural-ea-release");

    // Session A — natural EA order, parked BETWEEN the two lock acquisitions
    // (the only window in which an EA↔AE cycle is constructible at all).
    const naturalEa = dbA.transaction(async (tx) => {
      const enrollmentRepo = createEnrollmentRepo(tx as unknown as Database);
      await enrollmentRepo.findByExamAndCandidateForUpdate(
        ctx,
        fx.examId,
        fx.candidateProfileId,
      );
      eHeld.resolve();
      await releaseA.promise;
      const attemptRepo = createAttemptRepo(tx as unknown as Database);
      await attemptRepo.findByIdForUpdate(ctx, fx.attemptId);
    });

    await eHeld.promise;

    // Observer: session A really holds the Enrollment row lock right now.
    const nowait = await probeRowLockHeldNowait(
      sqlObserver,
      "exam_enrollments",
      fx.enrollmentId,
    );
    expect(nowait.acquired).toBe(false);
    if (!nowait.acquired) {
      expect(nowait.sqlstate).toBe("55P03");
    }

    // Session B — the REAL canonical seam on an independent session. Its
    // Enrollment FOR UPDATE must block on A's row lock.
    const canonical = dbB.transaction(async (tx) => {
      const attemptRepo = createAttemptRepo(tx as unknown as Database);
      const enrollmentRepo = createEnrollmentRepo(tx as unknown as Database);
      const enrollments = createEnrollmentRepoAdapter(enrollmentRepo, ctx);
      const attempts = createAttemptRepoAdapter(attemptRepo, ctx);
      await lockEnrollmentAndAttempt(enrollments, attempts, fx.attemptId);
    });

    const blocked = await waitForBackendBlocked(sqlObserver, pidB);
    expect(["relation", "transactionid", "tuple"]).toContain(
      blocked.blockedOnLocktype,
    );

    // Release A: A completes (Attempt lock, commit); B wakes, acquires E
    // then A, commits. Under the canonical order both fulfill — no cycle.
    releaseA.resolve();
    await Promise.all([naturalEa, canonical]);

    // Durable post-commit sanity: both rows still present, attempt still
    // in_progress (neither path mutates status).
    const attempt = await createAttemptRepo(dbSeed).findById(ctx, fx.attemptId);
    expect(attempt?.status).toBe("in_progress");
  }, 30_000);

  // Characterization of the REAL tx-bound repository lifecycle semantics
  // (Drizzle 0.45 / postgres.js 3.4): a captured repository does NOT reject
  // use after its transaction ends. A post-ROLLBACK write executes in
  // autocommit on the pooled connection and LANDS DURABLY. Any safety
  // argument that leans on driver-level post-end rejection is false; this
  // test pins the actual behavior so such an assumption cannot silently
  // return (and a driver upgrade that changes it turns this red).
  it("tx-bound repository captured in a rolled-back transaction keeps executing — its post-rollback write lands durably (characterization)", async () => {
    let captured: ReturnType<typeof createAttemptRepo> | null = null;
    const marker = new Date(Date.now() + 123_456);
    await expect(
      dbSeed.transaction(async (tx) => {
        captured = createAttemptRepo(tx as unknown as Database);
        const live = await captured.findById(ctx, fx.attemptId);
        expect(live).not.toBeNull();
        throw new Error("forced rollback before any write");
      }),
    ).rejects.toThrow("forced rollback before any write");
    expect(captured).not.toBeNull();

    // Post-rollback read: still executes (no rejection).
    const afterRead = await captured!.findById(ctx, fx.attemptId);
    expect(afterRead).not.toBeNull();

    // Post-rollback WRITE: executes and lands durably — proving the repo is
    // no longer transactional after the transaction ended.
    await captured!.update(ctx, fx.attemptId, { lastActivityAt: marker });

    const fresh = await createAttemptRepo(dbSeed).findById(ctx, fx.attemptId);
    expect(fresh?.lastActivityAt?.toISOString()).toBe(marker.toISOString());
  });
});
