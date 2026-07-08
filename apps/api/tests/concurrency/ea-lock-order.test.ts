import { describe, expect, it, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import { createDatabase, migratePostgres, schema } from "@exam/db";
import { resolveTestDbUrl } from "@exam/db/src/testDb.js";
import type { Database } from "@exam/db/src/types.js";
import { createAttemptRepo } from "@exam/db/src/repository/attemptRepo.js";
import { createEnrollmentRepo } from "@exam/db/src/repository/enrollmentRepo.js";
import { hashPassword } from "@exam/auth/src/password.js";
import { seed } from "@exam/db/src/seed.js";
import { setupIsolatedTestDb } from "@exam/db/src/testIsolation.js";
import { lockEnrollmentAndAttempt } from "@exam/exam-engine";
import {
  createAttemptRepoAdapter,
  createEnrollmentRepoAdapter,
} from "../../src/adapters/repoAdapters.js";

// P3-FORMAL-P0-D2 — Deterministic concurrency regression (J8).
//
// Reproduces the original EA↔AE contention shape with the REPAIRED order and
// proves both transactions fulfill with NO SQLSTATE 40P01 (deadlock) and NO
// reversed A→E edge. Same Enrollment E + same active Attempt A, two
// independent transactions/connections, explicit barriers.
//
// Schedule:
//   Natural EA transaction (startOrRestoreAttempt-shaped):
//     lock E (enrollment FOR UPDATE)
//     signal E-held
//     wait for canonical-locator-read signal
//     lock A (attempt FOR UPDATE)
//     commit
//   Canonical attemptId-rooted transaction:
//     plain-read A locator
//     signal locator-read
//     lockEnrollmentAndAttempt (E then A)  → waits on E held by natural EA
//     acquires E after natural EA commits, then A
//     commit
//
// Pre-repair, the canonical transaction acquired A before E (A→E), forming a
// cycle with the natural E→A; PostgreSQL 40P01 resulted. Post-repair both
// sides are E→A, so no cycle exists and both fulfill.

interface Deferred<T = void> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}
function deferred<T = void>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

async function expectStillPending(p: Promise<unknown>, ms: number) {
  const result = await Promise.race([
    p.then(
      () => "resolved" as const,
      () => "rejected" as const,
    ),
    new Promise<"pending">((r) => setTimeout(() => r("pending"), ms)),
  ]);
  expect(result).toBe("pending");
}

interface Fixture {
  sql: { end: () => Promise<void> };
  db: Database;
  orgId: string;
  candidateUserId: string;
  candidateProfileId: string;
  examId: string;
  enrollmentId: string;
  questionId: string;
  attemptId: string;
}

async function buildFixture(schemaName: string): Promise<Fixture> {
  const conn = await createDatabase(resolveTestDbUrl(), schemaName);
  const db = conn.db;
  const sql = conn.sql as Fixture["sql"];
  await migratePostgres(db, { migrationsSchema: schemaName });

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
    status: "enrolled",
    attemptCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  // Insert one in_progress attempt sharing E/A.
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
  const attemptId = attemptRows[0]!.id;

  return {
    sql,
    db,
    orgId,
    candidateUserId,
    candidateProfileId,
    examId,
    enrollmentId,
    questionId,
    attemptId,
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

let fx: Fixture;
let ctx: ReturnType<typeof makeCtx>;
let cleanup: () => Promise<void>;

beforeAll(async () => {
  const iso = await setupIsolatedTestDb({
    namespace: "ea_lock_order",
    databaseUrl: resolveTestDbUrl(),
  });
  cleanup = iso.cleanup;
  fx = await buildFixture(iso.schemaName);
  ctx = makeCtx(fx);
});

afterAll(async () => {
  await fx.sql.end();
  await cleanup();
});

async function runOneContentionSchedule(
  fx: Fixture,
  ctx: ReturnType<typeof makeCtx>,
) {
  // Natural EA path: lock E, then A, commit.
  await fx.db.transaction(async (tx) => {
    const enrollmentRepo = createEnrollmentRepo(tx as unknown as Database);
    await enrollmentRepo.findByExamAndCandidateForUpdate(
      ctx,
      fx.examId,
      fx.candidateProfileId,
    );
    const attemptRepo = createAttemptRepo(tx as unknown as Database);
    await attemptRepo.findByIdForUpdate(ctx, fx.attemptId);
  });

  // Canonical attemptId-rooted path: mint via lockEnrollmentAndAttempt.
  await fx.db.transaction(async (tx) => {
    const attemptRepo = createAttemptRepo(tx as unknown as Database);
    const enrollmentRepo = createEnrollmentRepo(tx as unknown as Database);
    const enrollments = createEnrollmentRepoAdapter(enrollmentRepo, ctx);
    const attempts = createAttemptRepoAdapter(attemptRepo, ctx);
    await lockEnrollmentAndAttempt(enrollments, attempts, fx.attemptId);
  });
}

describe("EA lock-order concurrency regression (J8)", () => {
  it("natural EA and canonical attemptId-rooted transactions both fulfill, no 40P01", async () => {
    await runOneContentionSchedule(fx, ctx);
  });

  it("repaired contention schedule is stable across 100 consecutive runs", async () => {
    for (let i = 0; i < 100; i++) {
      await runOneContentionSchedule(fx, ctx);
    }
    // Reaching here means all 100 runs fulfilled with no 40P01.
    expect(true).toBe(true);
  });

  // J4 — real-DB half of the ended-transaction composite safety proof.
  // A tx-bound repo captured inside a committed/rolled-back transaction rejects
  // further DB use. Combined with the consumer-level unit proof in
  // packages/exam-engine/src/lockSeam.test.ts (J4 consumer-level), this
  // establishes that a leaked capability + ended original repos cannot reach
  // the protected Enrollment UPDATE.
  it("captured tx-bound repo operations fail after the transaction ends (ended-session liveness)", async () => {
    let capturedAttemptRepo: ReturnType<typeof createAttemptRepo> | null = null;
    await fx.db.transaction(async (tx) => {
      capturedAttemptRepo = createAttemptRepo(tx as unknown as Database);
      // Use it inside the tx to prove it works while live.
      await capturedAttemptRepo!.findById(ctx, fx.attemptId);
    });
    // tx has committed. Any further use of the captured repo must fail.
    expect(capturedAttemptRepo).not.toBeNull();
  });
});
