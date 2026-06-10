import { randomUUID } from "node:crypto";
import type { RequestContext } from "@exam/domain";
import { beforeEach, describe, expect, it } from "vitest";
import { createSqliteDatabase, migrateSqlite } from "../sqlite.js";
import { sqliteSchema } from "../schema/sqlite.js";
import { createAttemptRepo } from "./attemptRepo.js";
import { createEnrollmentRepo } from "./enrollmentRepo.js";

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

describe("attemptRepo custom methods", () => {
  let db: ReturnType<typeof createSqliteDatabase>;
  let attemptRepo: ReturnType<typeof createAttemptRepo>;
  let enrollmentRepo: ReturnType<typeof createEnrollmentRepo>;
  let ctx: RequestContext;
  let enrollmentId: string;

  beforeEach(async () => {
    db = createSqliteDatabase(":memory:");
    migrateSqlite(db.db);
    attemptRepo = createAttemptRepo(db.db);
    enrollmentRepo = createEnrollmentRepo(db.db);
    ctx = createContext("org-1");

    db.db
      .insert(sqliteSchema.organizations)
      .values({
        id: "org-1",
        name: "Test",
        displayName: "Test",
        slug: "test",
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .run();

    db.db
      .insert(sqliteSchema.courses)
      .values({
        id: "course-1",
        organizationId: "org-1",
        name: "Test",
        code: "TEST",
        description: "",
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .run();

    db.db
      .insert(sqliteSchema.exams)
      .values({
        id: "exam-1",
        organizationId: "org-1",
        title: "Test",
        description: "",
        courseId: "course-1",
        status: "open",
        timingMode: "timed_window",
        durationMinutes: 60,
        openAt: new Date(),
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
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .run();

    db.db
      .insert(sqliteSchema.users)
      .values({
        id: "user-1",
        organizationId: "org-1",
        username: "cand",
        passwordHash: "hash",
        name: "Candidate",
        role: "Candidate",
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .run();

    db.db
      .insert(sqliteSchema.candidateProfiles)
      .values({
        id: "cand-1",
        organizationId: "org-1",
        userId: "user-1",
        fields: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .run();

    const enr = await enrollmentRepo.create(ctx, {
      examId: "exam-1",
      candidateId: "cand-1",
      status: "started",
      attemptCount: 1,
    });
    enrollmentId = enr.id;
  });

  it("findActiveByEnrollment returns in_progress attempt", async () => {
    await attemptRepo.create(ctx, {
      examId: "exam-1",
      enrollmentId,
      candidateId: "cand-1",
      attemptNo: 1,
      status: "in_progress",
      questionSnapshot: [],
      answers: [],
      startedAt: new Date(),
      deadlineAt: new Date(Date.now() + 3600000),
      lastActivityAt: new Date(),
    });

    const found = await attemptRepo.findActiveByEnrollment(ctx, enrollmentId);
    expect(found).toBeDefined();
    expect(found!.status).toBe("in_progress");
  });

  it("findActiveByEnrollment returns null when no active attempt", async () => {
    await attemptRepo.create(ctx, {
      examId: "exam-1",
      enrollmentId,
      candidateId: "cand-1",
      attemptNo: 1,
      status: "submitted",
      questionSnapshot: [],
      answers: [],
    });

    const found = await attemptRepo.findActiveByEnrollment(ctx, enrollmentId);
    expect(found).toBeNull();
  });

  it("findByEnrollmentAndAttemptNo returns correct attempt", async () => {
    await attemptRepo.create(ctx, {
      examId: "exam-1",
      enrollmentId,
      candidateId: "cand-1",
      attemptNo: 1,
      status: "submitted",
      questionSnapshot: [],
      answers: [],
    });

    const found = await attemptRepo.findByEnrollmentAndAttemptNo(
      ctx,
      enrollmentId,
      1,
    );
    expect(found).toBeDefined();
    expect(found!.attemptNo).toBe(1);
  });

  it("findByExamAndCandidate returns attempts for exam+candidate", async () => {
    await attemptRepo.create(ctx, {
      examId: "exam-1",
      enrollmentId,
      candidateId: "cand-1",
      attemptNo: 1,
      status: "submitted",
      questionSnapshot: [],
      answers: [],
    });

    const found = await attemptRepo.findByExamAndCandidate(
      ctx,
      "exam-1",
      "cand-1",
    );
    expect(found.length).toBe(1);
    expect(found[0]!.attemptNo).toBe(1);
  });
});

describe("enrollmentRepo custom methods", () => {
  let db: ReturnType<typeof createSqliteDatabase>;
  let enrollmentRepo: ReturnType<typeof createEnrollmentRepo>;
  let ctx: RequestContext;

  beforeEach(() => {
    db = createSqliteDatabase(":memory:");
    migrateSqlite(db.db);
    enrollmentRepo = createEnrollmentRepo(db.db);
    ctx = createContext("org-1");

    db.db
      .insert(sqliteSchema.organizations)
      .values({
        id: "org-1",
        name: "Test",
        displayName: "Test",
        slug: "test",
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .run();

    db.db
      .insert(sqliteSchema.courses)
      .values({
        id: "course-1",
        organizationId: "org-1",
        name: "Test",
        code: "TEST",
        description: "",
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .run();

    db.db
      .insert(sqliteSchema.exams)
      .values({
        id: "exam-1",
        organizationId: "org-1",
        title: "Test",
        description: "",
        courseId: "course-1",
        status: "open",
        timingMode: "timed_window",
        durationMinutes: 60,
        openAt: new Date(),
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
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .run();

    db.db
      .insert(sqliteSchema.users)
      .values({
        id: "user-1",
        organizationId: "org-1",
        username: "cand",
        passwordHash: "hash",
        name: "Candidate",
        role: "Candidate",
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .run();

    db.db
      .insert(sqliteSchema.candidateProfiles)
      .values({
        id: "cand-1",
        organizationId: "org-1",
        userId: "user-1",
        fields: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .run();
  });

  it("findByExamAndCandidate returns enrollment", async () => {
    await enrollmentRepo.create(ctx, {
      examId: "exam-1",
      candidateId: "cand-1",
      status: "assigned",
      attemptCount: 0,
    });

    const found = await enrollmentRepo.findByExamAndCandidate(
      ctx,
      "exam-1",
      "cand-1",
    );
    expect(found).toBeDefined();
    expect(found!.candidateId).toBe("cand-1");
  });

  it("findByExamAndCandidate returns null when not found", async () => {
    const found = await enrollmentRepo.findByExamAndCandidate(
      ctx,
      "exam-1",
      "cand-1",
    );
    expect(found).toBeNull();
  });

  it("findByCandidate returns all enrollments for candidate", async () => {
    await enrollmentRepo.create(ctx, {
      examId: "exam-1",
      candidateId: "cand-1",
      status: "assigned",
      attemptCount: 0,
    });

    const found = await enrollmentRepo.findByCandidate(ctx, "cand-1");
    expect(found.length).toBe(1);
  });
});
