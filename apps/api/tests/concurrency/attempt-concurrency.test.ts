import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { createDatabase, migratePostgres, schema } from "@exam/db";
import type { Database } from "@exam/db/src/types.js";
import { createAttemptRepo } from "@exam/db/src/repository/attemptRepo.js";
import { hashPassword } from "@exam/auth/src/password.js";
import { seed } from "@exam/db/src/seed.js";
import { setupIsolatedTestDb } from "@exam/db/src/testIsolation.js";

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://exam:exam@localhost:5432/exam_test";

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
}

async function buildFixture(schemaName?: string): Promise<Fixture> {
  const conn = await createDatabase(TEST_DB_URL, schemaName);
  const db = conn.db;
  const sql = conn.sql as Fixture["sql"];

  if (schemaName) {
    await migratePostgres(db, { migrationsSchema: schemaName });
  }

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
    status: "enrolled",
    attemptCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  return {
    sql,
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

describe("PG concurrency — attempt row-level serialization", () => {
  let fx: Fixture;
  let ctx: ReturnType<typeof makeCtx>;
  let attemptId: string;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    const iso = await setupIsolatedTestDb({
      namespace: "concurrency",
      databaseUrl: TEST_DB_URL,
    });
    cleanup = iso.cleanup;
    fx = await buildFixture(iso.schemaName);
    ctx = makeCtx(fx);
    attemptId = await insertAttempt(fx, 1, "in_progress");
  });

  afterAll(async () => {
    await fx.sql.end();
    await cleanup();
  });

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

  it("FOR UPDATE can lock and mutate a submitted-status row (DB layer)", async () => {
    const submittedId = await insertAttempt(fx, 2, "submitted", {
      submittedAt: new Date(),
    });
    const repo = createAttemptRepo(fx.db);

    await fx.db.transaction(async (tx) => {
      const txRepo = createAttemptRepo(tx as unknown as Database);
      const locked = await txRepo.findByIdForUpdate(ctx, submittedId);
      expect(locked).not.toBeNull();
      expect(locked!.status).toBe("submitted");

      await txRepo.update(ctx, submittedId, {
        answers: [
          {
            questionId: fx.questionId,
            answer: false,
            version: 1,
            savedAt: new Date(),
          },
        ],
        lastActivityAt: new Date(),
      });
    });

    const after = await repo.findById(ctx, submittedId);
    const answers = after!.answers as Array<{ questionId: string }>;
    expect(answers).toHaveLength(1);
    expect(answers[0]!.questionId).toBe(fx.questionId);
  });

  it("save-then-submit: second FOR UPDATE blocks until first commits", async () => {
    const rowId = await insertAttempt(fx, 3, "in_progress");
    let saveCommitted = false;
    let submitSawPreCommit = false;

    // Test-only barrier: keep the save transaction open after it has
    // acquired the attempt row lock via FOR UPDATE. This forces submit
    // to wait on the same attempt row through FOR UPDATE.
    // Production serialization is provided by the row lock, not by
    // this Promise latch.
    const saveHoldingRowLock = deferred();
    const saveCanCommit = deferred();

    const saveTx = fx.db.transaction(async (tx) => {
      const txRepo = createAttemptRepo(tx as unknown as Database);
      await txRepo.findByIdForUpdate(ctx, rowId);
      await txRepo.update(ctx, rowId, {
        answers: [
          {
            questionId: fx.questionId,
            answer: true,
            version: 1,
            savedAt: new Date(),
          },
        ],
        lastActivityAt: new Date(),
      });
      saveHoldingRowLock.resolve();
      await saveCanCommit.promise;
      saveCommitted = true;
    });

    await saveHoldingRowLock.promise;

    const submitOp = fx.db.transaction(async (tx) => {
      await createAttemptRepo(tx as unknown as Database).findByIdForUpdate(
        ctx,
        rowId,
      );
      if (!saveCommitted) submitSawPreCommit = true;
    });

    await expectStillPending(submitOp, 50);

    try {
      saveCanCommit.resolve();
      await Promise.all([saveTx, submitOp]);
    } finally {
      saveCanCommit.resolve();
    }

    expect(submitSawPreCommit).toBe(false);

    const repo = createAttemptRepo(fx.db);
    const final = await repo.findById(ctx, rowId);
    const answers = final!.answers as Array<{ version: number }>;
    expect(answers).toHaveLength(1);
    expect(answers[0]!.version).toBe(1);
  });

  it("N-parallel save: monotonic versions with no lost updates (N=5)", async () => {
    const N = 5;
    const parallelId = await insertAttempt(fx, 4, "in_progress");

    const saves = Array.from({ length: N }, (_, i) =>
      fx.db.transaction(async (tx) => {
        const txRepo = createAttemptRepo(tx as unknown as Database);
        const locked = await txRepo.findByIdForUpdate(ctx, parallelId);
        if (!locked) throw new Error("not found");
        const current = (locked.answers ?? []) as Array<{
          questionId: string;
          version: number;
        }>;
        const existing = current.find((a) => a.questionId === fx.questionId);
        const nextVersion = (existing?.version ?? 0) + 1;
        const updated = current.filter((a) => a.questionId !== fx.questionId);
        updated.push({
          questionId: fx.questionId,
          answer: i % 2 === 0,
          version: nextVersion,
          savedAt: new Date(),
        });
        await txRepo.update(ctx, parallelId, {
          answers: updated,
          lastActivityAt: new Date(),
        });
        return nextVersion;
      }),
    );

    const results = await Promise.all(saves);
    results.sort((a, b) => a - b);
    for (let i = 0; i < results.length; i++) {
      expect(results[i]).toBe(i + 1);
    }

    const repo = createAttemptRepo(fx.db);
    const final = await repo.findById(ctx, parallelId);
    const answers = final!.answers as Array<{ version: number }>;
    expect(answers).toHaveLength(1);
    expect(answers[0]!.version).toBe(N);
  });
});
