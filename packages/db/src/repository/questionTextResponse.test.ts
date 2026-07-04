import { randomUUID } from "node:crypto";
import type { RequestContext } from "@exam/domain";
import { beforeAll, describe, expect, it, afterAll } from "vitest";
import { getIsolatedTestDb } from "../testDb.js";
import { schema } from "../schema/pg.js";
import { createQuestionRepo } from "./questionRepo.js";
import { createAttemptRepo } from "./attemptRepo.js";
import type { Database } from "../types.js";

/**
 * P3-L0-1: proves the schema migration + repo layer round-trip the new
 * fields end to end — text_response questions carry rubric, and attempts
 * persist submittedAnswers + submissionReason.
 */
describe("P3-L0-1 repo round-trip: text_response + submitted_answers", () => {
  let db: Database;
  let cleanup: () => Promise<void>;
  let questionRepo: ReturnType<typeof createQuestionRepo>;
  let attemptRepo: ReturnType<typeof createAttemptRepo>;
  const orgId = randomUUID();
  const courseId = randomUUID();
  const ctx: RequestContext = {
    actorId: randomUUID(),
    organizationId: orgId,
    role: "Admin",
    permissions: [],
    sessionId: randomUUID(),
    targetOrganizationId: orgId,
  };

  beforeAll(async () => {
    const result = await getIsolatedTestDb("l01-roundtrip");
    db = result.db;
    cleanup = result.cleanup;
    questionRepo = createQuestionRepo(db);
    attemptRepo = createAttemptRepo(db);

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
      id: courseId,
      organizationId: orgId,
      name: "Test",
      code: `T${courseId.slice(0, 4)}`,
      description: "",
      createdAt: now,
      updatedAt: now,
    });
  });

  afterAll(async () => {
    await cleanup();
  });

  it("persists a text_response question with rubric and reads it back", async () => {
    const created = await questionRepo.create(ctx, {
      courseId,
      type: "text_response",
      content: "请阐述你的观点",
      options: [],
      standardAnswer: null,
      attachments: [],
      score: 20,
      difficulty: 3,
      tags: [],
      gradingRule: {
        multiSelectScoring: "all_correct_full",
        fillBlankMatchMode: "exact",
      },
      rubric: "按逻辑完整性、关键概念、论证质量给分",
    });

    const fetched = await questionRepo.findById(ctx, created.id);
    expect(fetched).not.toBeNull();
    expect(fetched?.type).toBe("text_response");
    expect(fetched?.rubric).toBe("按逻辑完整性、关键概念、论证质量给分");
  });

  it("normalizes missing rubric to null for objective questions", async () => {
    // Objective question created without specifying rubric — DB column is
    // nullable with no default; the read should yield null, not undefined,
    // so downstream Question.rubric typing (string | null) holds.
    const created = await questionRepo.create(ctx, {
      courseId,
      type: "true_false",
      content: "1+1=2?",
      options: [],
      standardAnswer: true,
      attachments: [],
      score: 1,
      difficulty: 1,
      tags: [],
      gradingRule: {
        multiSelectScoring: "all_correct_full",
        fillBlankMatchMode: "exact",
      },
    });

    const fetched = await questionRepo.findById(ctx, created.id);
    expect(fetched).not.toBeNull();
    expect(fetched?.rubric).toBeNull();
  });

  it("persists submittedAnswers + submissionReason on an attempt and reads them back", async () => {
    const examId = randomUUID();
    const enrollmentId = randomUUID();
    const candidateId = randomUUID();
    const attemptId = randomUUID();
    const now = new Date();

    // Minimal exam + enrollment + candidateProfile to satisfy FKs.
    await db.insert(schema.exams).values({
      id: examId,
      organizationId: orgId,
      title: "T",
      description: "",
      courseId,
      status: "open",
      timingMode: "timed_window",
      durationMinutes: 60,
      openAt: now,
      closeAt: new Date(now.getTime() + 86400000),
      passingScore: 0,
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
        batchSize: 1,
        batchInterval: 1,
        restrictIp: false,
        requireLockdown: false,
        showResultImmediately: true,
      },
      retakePolicy: "unlimited",
      scoreStrategy: "highest",
      maxAttempts: 1,
      latestStartOffsetMinutes: null,
      minSubmitAfterStartMinutes: null,
      resultPublicationMode: "immediate",
      resultsPublishedAt: null,
      createdAt: now,
      updatedAt: now,
    });
    const userId = randomUUID();
    await db.insert(schema.users).values({
      id: userId,
      organizationId: orgId,
      username: `u-${userId.slice(0, 8)}`,
      passwordHash: "x",
      name: "Test",
      role: "Candidate",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.candidateProfiles).values({
      id: candidateId,
      organizationId: orgId,
      userId,
      fields: {},
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.examEnrollments).values({
      id: enrollmentId,
      organizationId: orgId,
      examId,
      candidateId,
      status: "started",
      attemptCount: 1,
      createdAt: now,
      updatedAt: now,
    });

    const submitted = {
      schemaVersion: 1 as const,
      answers: [{ questionId: "q1", value: "free text answer" }],
    };

    await db.insert(schema.examAttempts).values({
      id: attemptId,
      organizationId: orgId,
      examId,
      enrollmentId,
      candidateId,
      attemptNo: 1,
      status: "submitted",
      questionSnapshot: [],
      answers: [],
      submittedAnswers: submitted,
      submissionReason: "manual",
      submittedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    const fetched = await attemptRepo.findById(ctx, attemptId);
    expect(fetched).not.toBeNull();
    expect(fetched?.submittedAnswers).toEqual(submitted);
    expect(fetched?.submissionReason).toBe("manual");
  });

  it("round-trips null submittedAnswers/submissionReason (legacy attempt)", async () => {
    const examId = randomUUID();
    const enrollmentId = randomUUID();
    const candidateId = randomUUID();
    const attemptId = randomUUID();
    const now = new Date();

    await db.insert(schema.exams).values({
      id: examId,
      organizationId: orgId,
      title: "T2",
      description: "",
      courseId,
      status: "open",
      timingMode: "timed_window",
      durationMinutes: 60,
      openAt: now,
      closeAt: new Date(now.getTime() + 86400000),
      passingScore: 0,
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
        batchSize: 1,
        batchInterval: 1,
        restrictIp: false,
        requireLockdown: false,
        showResultImmediately: true,
      },
      retakePolicy: "unlimited",
      scoreStrategy: "highest",
      maxAttempts: 1,
      latestStartOffsetMinutes: null,
      minSubmitAfterStartMinutes: null,
      resultPublicationMode: "immediate",
      resultsPublishedAt: null,
      createdAt: now,
      updatedAt: now,
    });
    const legacyUserId = randomUUID();
    await db.insert(schema.users).values({
      id: legacyUserId,
      organizationId: orgId,
      username: `u-${legacyUserId.slice(0, 8)}`,
      passwordHash: "x",
      name: "Test",
      role: "Candidate",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.candidateProfiles).values({
      id: candidateId,
      organizationId: orgId,
      userId: legacyUserId,
      fields: {},
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.examEnrollments).values({
      id: enrollmentId,
      organizationId: orgId,
      examId,
      candidateId,
      status: "started",
      attemptCount: 1,
      createdAt: now,
      updatedAt: now,
    });

    // Legacy attempt: submittedAnswers/submissionReason not set → null columns.
    await db.insert(schema.examAttempts).values({
      id: attemptId,
      organizationId: orgId,
      examId,
      enrollmentId,
      candidateId,
      attemptNo: 1,
      status: "in_progress",
      questionSnapshot: [],
      answers: [],
      createdAt: now,
      updatedAt: now,
    });

    const fetched = await attemptRepo.findById(ctx, attemptId);
    expect(fetched).not.toBeNull();
    expect(fetched?.submittedAnswers).toBeNull();
    expect(fetched?.submissionReason).toBeNull();
  });
});
