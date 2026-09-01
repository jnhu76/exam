import { randomUUID } from "node:crypto";
import type { RequestContext } from "@exam/domain";
import { beforeAll, describe, expect, it, afterAll } from "vitest";
import { getIsolatedTestDb } from "../testDb.js";
import { schema } from "../schema/pg.js";
import { createAttemptRepo } from "./attemptRepo.js";
import { createEnrollmentRepo } from "./enrollmentRepo.js";
import { createAttemptGradingEntryRepo } from "./attemptGradingEntryRepo.js";
import type { Database } from "../types.js";

function createContext(orgId: string): RequestContext {
  return {
    actorId: randomUUID(),
    organizationId: orgId,
    role: "Admin",
    permissions: [],
    sessionId: randomUUID(),
    targetOrganizationId: orgId,
  };
}

interface SeedIds {
  courseId: string;
  examId: string;
  userId: string;
  candidateId: string;
}

async function seedBaseData(
  db: Database,
  orgId: string,
  ids: SeedIds,
): Promise<void> {
  const now = new Date();
  await db.insert(schema.organizations).values({
    id: orgId,
    name: "Test",
    displayName: "Test",
    slug: `test-${orgId.slice(0, 8)}`,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.courses).values({
    id: ids.courseId,
    organizationId: orgId,
    name: "Test",
    code: `T${ids.courseId.slice(0, 4)}`,
    description: "",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.exams).values({
    id: ids.examId,
    organizationId: orgId,
    title: "Test Exam",
    description: "",
    courseId: ids.courseId,
    status: "open",
    timingMode: "timed_window",
    durationMinutes: 60,
    openAt: now,
    closeAt: new Date(Date.now() + 86400000),
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
    maxAttempts: 3,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.users).values({
    id: ids.userId,
    organizationId: orgId,
    username: `grader-${ids.userId.slice(0, 4)}`,
    passwordHash: "hash",
    name: "Grader",
    role: "Admin",
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.candidateProfiles).values({
    id: ids.candidateId,
    organizationId: orgId,
    userId: ids.userId,
    fields: {},
    createdAt: now,
    updatedAt: now,
  });
}

function makeIds(): SeedIds {
  return {
    courseId: randomUUID(),
    examId: randomUUID(),
    userId: randomUUID(),
    candidateId: randomUUID(),
  };
}

describe("attemptGradingEntryRepo", () => {
  let db: Database;
  let cleanup: () => Promise<void>;
  let entryRepo: ReturnType<typeof createAttemptGradingEntryRepo>;
  let attemptRepo: ReturnType<typeof createAttemptRepo>;
  let enrollmentRepo: ReturnType<typeof createEnrollmentRepo>;
  let ctx: RequestContext;
  let attemptId: string;
  const orgId = randomUUID();

  beforeAll(async () => {
    const result = await getIsolatedTestDb("db-attempt-grading-entries");
    db = result.db;
    cleanup = result.cleanup;
    entryRepo = createAttemptGradingEntryRepo(db);
    attemptRepo = createAttemptRepo(db);
    enrollmentRepo = createEnrollmentRepo(db);

    const ids = makeIds();
    ctx = createContext(orgId);
    await seedBaseData(db, orgId, ids);

    const enr = await enrollmentRepo.create(ctx, {
      examId: ids.examId,
      candidateId: ids.candidateId,
      status: "started",
      attemptCount: 1,
    });
    const attempt = await attemptRepo.create(ctx, {
      examId: ids.examId,
      enrollmentId: enr.id,
      candidateId: ids.candidateId,
      attemptNo: 1,
      status: "submitted",
      questionSnapshot: [],
      answers: [],
      submittedAt: new Date(),
    });
    attemptId = attempt.id;
  }, 30_000);

  afterAll(async () => {
    await cleanup();
  }, 30_000);

  it("findByAttempt returns [] when no entries exist", async () => {
    const rows = await entryRepo.findByAttempt(ctx, attemptId);
    expect(rows).toEqual([]);
  });

  it("bulkCreate inserts entries and findByAttempt returns them ordered by questionId", async () => {
    const now = new Date();
    const inserted = await entryRepo.bulkCreate(ctx, [
      {
        attemptId,
        questionId: "q-text",
        gradingMode: "manual",
        status: "pending_manual",
        maxScore: 60,
        earnedScore: null,
        candidateAnswer: "student answer",
        standardAnswer: "reference answer",
        correct: null,
      },
      {
        attemptId,
        questionId: "q-obj",
        gradingMode: "auto",
        status: "completed_auto",
        maxScore: 40,
        earnedScore: 40,
        candidateAnswer: "a",
        standardAnswer: "a",
        correct: true,
      },
    ]);
    expect(inserted).toHaveLength(2);

    const rows = await entryRepo.findByAttempt(ctx, attemptId);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.questionId)).toEqual(["q-obj", "q-text"]);
    const obj = rows.find((r) => r.questionId === "q-obj")!;
    expect(obj.gradingMode).toBe("auto");
    expect(obj.status).toBe("completed_auto");
    expect(obj.earnedScore).toBe(40);
    expect(obj.correct).toBe(true);
    const manual = rows.find((r) => r.questionId === "q-text")!;
    expect(manual.gradingMode).toBe("manual");
    expect(manual.status).toBe("pending_manual");
    expect(manual.earnedScore).toBeNull();
    expect(manual.correct).toBeNull();
  });

  it("findByAttemptAndQuestion returns the matching entry", async () => {
    const row = await entryRepo.findByAttemptAndQuestion(
      ctx,
      attemptId,
      "q-text",
    );
    expect(row).not.toBeNull();
    expect(row!.questionId).toBe("q-text");
    expect(row!.status).toBe("pending_manual");
  });

  it("UNIQUE(attempt_id, question_id) rejects duplicate bulkCreate", async () => {
    await expect(
      entryRepo.bulkCreate(ctx, [
        {
          attemptId,
          questionId: "q-obj",
          gradingMode: "auto",
          status: "completed_auto",
          maxScore: 40,
          earnedScore: 0,
          candidateAnswer: "b",
          standardAnswer: "a",
          correct: false,
        },
      ]),
    ).rejects.toThrow();
  });

  it("DB check constraint rejects negative earnedScore", async () => {
    const now = new Date();
    await expect(
      db.insert(schema.attemptGradingEntries).values({
        id: randomUUID(),
        organizationId: orgId,
        attemptId,
        questionId: "q-negative",
        gradingMode: "auto",
        status: "completed_auto",
        maxScore: 10,
        earnedScore: -1,
        candidateAnswer: null,
        standardAnswer: null,
        correct: false,
        comment: "",
        createdAt: now,
        updatedAt: now,
      }),
    ).rejects.toThrow();
  });

  it("DB check constraint rejects earnedScore > maxScore", async () => {
    const now = new Date();
    await expect(
      db.insert(schema.attemptGradingEntries).values({
        id: randomUUID(),
        organizationId: orgId,
        attemptId,
        questionId: "q-over-max",
        gradingMode: "auto",
        status: "completed_auto",
        maxScore: 10,
        earnedScore: 11,
        candidateAnswer: null,
        standardAnswer: null,
        correct: false,
        comment: "",
        createdAt: now,
        updatedAt: now,
      }),
    ).rejects.toThrow();
  });

  it("completeManualEntry flips pending_manual to completed_manual with score", async () => {
    const now = new Date();
    const updated = await entryRepo.completeManualEntry(ctx, {
      attemptId,
      questionId: "q-text",
      earnedScore: 45,
      maxScore: 60,
      comment: "good effort",
      gradedBy: "grader-1",
      gradedAt: now,
      now,
    });
    expect(updated).not.toBeNull();
    expect(updated!.status).toBe("completed_manual");
    expect(updated!.earnedScore).toBe(45);
    expect(updated!.correct).toBe(false);
    expect(updated!.comment).toBe("good effort");
    expect(updated!.gradedBy).toBe("grader-1");
  });

  it("completeManualEntry with full marks sets correct=true", async () => {
    const now = new Date();
    const inserted = await entryRepo.bulkCreate(ctx, [
      {
        attemptId,
        questionId: "q-full",
        gradingMode: "manual",
        status: "pending_manual",
        maxScore: 10,
        earnedScore: null,
        candidateAnswer: "ans",
        standardAnswer: null,
        correct: null,
      },
    ]);
    expect(inserted).toHaveLength(1);

    const updated = await entryRepo.completeManualEntry(ctx, {
      attemptId,
      questionId: "q-full",
      earnedScore: 10,
      maxScore: 10,
      comment: "perfect",
      gradedBy: "grader-1",
      gradedAt: now,
      now,
    });
    expect(updated!.correct).toBe(true);
    expect(updated!.earnedScore).toBe(10);
  });

  it("listPendingManualQueue returns attempts with pending manual entries", async () => {
    const now = new Date();
    const ids = makeIds();
    const orgId2 = randomUUID();
    await seedBaseData(db, orgId2, ids);
    const ctx2 = createContext(orgId2);
    const enr = await enrollmentRepo.create(ctx2, {
      examId: ids.examId,
      candidateId: ids.candidateId,
      status: "started",
      attemptCount: 1,
    });
    const attempt2 = await attemptRepo.create(ctx2, {
      examId: ids.examId,
      enrollmentId: enr.id,
      candidateId: ids.candidateId,
      attemptNo: 1,
      status: "submitted",
      questionSnapshot: [],
      answers: [],
      submittedAt: now,
    });

    await entryRepo.bulkCreate(ctx2, [
      {
        attemptId: attempt2.id,
        questionId: "q-essay-1",
        gradingMode: "manual",
        status: "pending_manual",
        maxScore: 50,
        earnedScore: null,
        candidateAnswer: "ans1",
        standardAnswer: null,
        correct: null,
      },
      {
        attemptId: attempt2.id,
        questionId: "q-essay-2",
        gradingMode: "manual",
        status: "pending_manual",
        maxScore: 50,
        earnedScore: null,
        candidateAnswer: "ans2",
        standardAnswer: null,
        correct: null,
      },
    ]);

    const rows = await entryRepo.listPendingManualQueue(ctx2, {});
    const found = rows.find((r) => r.attempt.id === attempt2.id);
    expect(found).toBeDefined();
    expect(found!.pendingCount).toBe(2);
    expect(found!.exam.title).toBe("Test Exam");
    expect(found!.candidateUser.name).toBe("Grader");
  });

  it("listPendingManualQueue excludes completed_manual entries from pending count", async () => {
    const rows = await entryRepo.listPendingManualQueue(ctx, {});
    const found = rows.find((r) => r.attempt.id === attemptId);
    expect(found).toBeUndefined();
  });

  it("countPendingManualQueue counts distinct attempts with pending entries", async () => {
    const count = await entryRepo.countPendingManualQueue(ctx, {});
    expect(count).toBe(0);
  });

  it("scoping: does not return entries from another organization", async () => {
    const otherOrgId = randomUUID();
    const ctx2 = createContext(otherOrgId);
    const now = new Date();
    await db.insert(schema.organizations).values({
      id: otherOrgId,
      name: "Other",
      displayName: "Other",
      slug: `other-${otherOrgId.slice(0, 8)}`,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.attemptGradingEntries).values({
      id: randomUUID(),
      organizationId: otherOrgId,
      attemptId,
      questionId: "q-cross-org",
      gradingMode: "manual",
      status: "pending_manual",
      maxScore: 10,
      earnedScore: null,
      candidateAnswer: null,
      standardAnswer: null,
      correct: null,
      comment: "",
      createdAt: now,
      updatedAt: now,
    });
    const ownRows = await entryRepo.findByAttempt(ctx, attemptId);
    expect(ownRows.find((r) => r.questionId === "q-cross-org")).toBeUndefined();
  });

  // ---- Slice 4: SQL-level status / mode guard on completeManualEntry ----
  // The engine layer already enforces the pending_manual → completed_manual
  // transition. These tests prove the SQL UPDATE itself now refuses to touch a
  // row that is not (grading_mode='manual', status='pending_manual'), as
  // defense-in-depth, and that a rejected UPDATE leaves the original row intact.

  it("Slice 4: a pending_manual manual entry can be completed", async () => {
    const now = new Date();
    await entryRepo.bulkCreate(ctx, [
      {
        attemptId,
        questionId: "q-s4-pending",
        gradingMode: "manual",
        status: "pending_manual",
        maxScore: 20,
        earnedScore: null,
        candidateAnswer: "ans",
        standardAnswer: null,
        correct: null,
      },
    ]);
    const updated = await entryRepo.completeManualEntry(ctx, {
      attemptId,
      questionId: "q-s4-pending",
      earnedScore: 15,
      maxScore: 20,
      comment: "ok",
      gradedBy: "grader-s4",
      gradedAt: now,
      now,
    });
    expect(updated).not.toBeNull();
    expect(updated!.status).toBe("completed_manual");
    expect(updated!.earnedScore).toBe(15);
    expect(updated!.gradedBy).toBe("grader-s4");
  });

  it("Slice 4: a completed_manual entry cannot be overwritten (returns null)", async () => {
    const now = new Date();
    // Seed an already-completed manual entry (the committed score/grader).
    await db.insert(schema.attemptGradingEntries).values({
      id: randomUUID(),
      organizationId: orgId,
      attemptId,
      questionId: "q-s4-done",
      gradingMode: "manual",
      status: "completed_manual",
      maxScore: 20,
      earnedScore: 12,
      candidateAnswer: "ans",
      standardAnswer: null,
      correct: false,
      comment: "original comment",
      gradedBy: "original-grader",
      gradedAt: new Date("2025-01-01T00:00:00Z"),
      createdAt: now,
      updatedAt: now,
    });

    // Attempt to overwrite with a different score/grader.
    const result = await entryRepo.completeManualEntry(ctx, {
      attemptId,
      questionId: "q-s4-done",
      earnedScore: 20,
      maxScore: 20,
      comment: "tampered comment",
      gradedBy: "attacker-grader",
      gradedAt: now,
      now,
    });
    expect(result).toBeNull();

    // The original committed score/comment/grader/time are untouched.
    const row = await entryRepo.findByAttemptAndQuestion(
      ctx,
      attemptId,
      "q-s4-done",
    );
    expect(row!.status).toBe("completed_manual");
    expect(row!.earnedScore).toBe(12);
    expect(row!.comment).toBe("original comment");
    expect(row!.gradedBy).toBe("original-grader");
  });

  it("Slice 4: an auto entry cannot be completed as manual (returns null)", async () => {
    const now = new Date();
    await db.insert(schema.attemptGradingEntries).values({
      id: randomUUID(),
      organizationId: orgId,
      attemptId,
      questionId: "q-s4-auto",
      gradingMode: "auto",
      status: "completed_auto",
      maxScore: 20,
      earnedScore: 20,
      candidateAnswer: "a",
      standardAnswer: "a",
      correct: true,
      comment: "",
      createdAt: now,
      updatedAt: now,
    });

    const result = await entryRepo.completeManualEntry(ctx, {
      attemptId,
      questionId: "q-s4-auto",
      earnedScore: 5,
      maxScore: 20,
      comment: "should not apply",
      gradedBy: "grader-s4",
      gradedAt: now,
      now,
    });
    expect(result).toBeNull();

    // The auto entry is untouched.
    const row = await entryRepo.findByAttemptAndQuestion(
      ctx,
      attemptId,
      "q-s4-auto",
    );
    expect(row!.gradingMode).toBe("auto");
    expect(row!.status).toBe("completed_auto");
    expect(row!.earnedScore).toBe(20);
  });
});
