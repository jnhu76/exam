import { randomUUID } from "node:crypto";
import type { RequestContext } from "@exam/domain";
import { beforeAll, describe, expect, it, afterAll } from "vitest";
import { getIsolatedTestDb } from "../testDb.js";
import { schema } from "../schema/pg.js";
import { createAttemptRepo } from "./attemptRepo.js";
import { createEnrollmentRepo } from "./enrollmentRepo.js";
import { createManualGradingRepo } from "./manualGradingRepo.js";
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
    title: "Test",
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

describe("manualGradingRepo", () => {
  let db: Database;
  let cleanup: () => Promise<void>;
  let manualGradingRepo: ReturnType<typeof createManualGradingRepo>;
  let attemptRepo: ReturnType<typeof createAttemptRepo>;
  let enrollmentRepo: ReturnType<typeof createEnrollmentRepo>;
  let ctx: RequestContext;
  let attemptId: string;
  const orgId = randomUUID();

  beforeAll(async () => {
    const result = await getIsolatedTestDb("db-manual-grading");
    db = result.db;
    cleanup = result.cleanup;
    manualGradingRepo = createManualGradingRepo(db);
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
  });

  afterAll(async () => {
    await cleanup();
  });

  it("findByAttempt returns [] when no entries exist", async () => {
    const rows = await manualGradingRepo.findByAttempt(ctx, attemptId);
    expect(rows).toEqual([]);
  });

  it("findByAttemptAndQuestion returns null when no entry exists", async () => {
    const row = await manualGradingRepo.findByAttemptAndQuestion(
      ctx,
      attemptId,
      "q-essay-1",
    );
    expect(row).toBeNull();
  });

  it("findByAttempt returns inserted entries", async () => {
    const now = new Date();
    await db.insert(schema.manualGradingEntries).values({
      id: randomUUID(),
      organizationId: orgId,
      attemptId,
      questionId: "q-essay-1",
      score: 7,
      maxScore: 10,
      comment: "good effort",
      gradedBy: "grader-1",
      gradedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.manualGradingEntries).values({
      id: randomUUID(),
      organizationId: orgId,
      attemptId,
      questionId: "q-essay-2",
      score: 8,
      maxScore: 10,
      comment: "",
      gradedBy: "grader-1",
      gradedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    const rows = await manualGradingRepo.findByAttempt(ctx, attemptId);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.questionId).sort()).toEqual([
      "q-essay-1",
      "q-essay-2",
    ]);
  });

  it("findByAttemptAndQuestion returns the matching entry", async () => {
    const row = await manualGradingRepo.findByAttemptAndQuestion(
      ctx,
      attemptId,
      "q-essay-1",
    );
    expect(row).not.toBeNull();
    expect(row!.score).toBe(7);
    expect(row!.comment).toBe("good effort");
  });

  it("rejects a duplicate (attemptId, questionId) via the unique index", async () => {
    const now = new Date();
    await expect(
      db.insert(schema.manualGradingEntries).values({
        id: randomUUID(),
        organizationId: orgId,
        attemptId,
        questionId: "q-essay-1", // already inserted above
        score: 9,
        maxScore: 10,
        comment: "re-grade",
        gradedBy: "grader-2",
        gradedAt: now,
        createdAt: now,
        updatedAt: now,
      }),
    ).rejects.toThrow();
  });

  it("scoping: does not return entries from another organization", async () => {
    const otherOrgId = randomUUID();
    const ctx2 = createContext(otherOrgId);
    const now = new Date();
    // The FK requires the other org to exist before we can attach an entry.
    await db.insert(schema.organizations).values({
      id: otherOrgId,
      name: "Other",
      displayName: "Other",
      slug: `other-${otherOrgId.slice(0, 8)}`,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.manualGradingEntries).values({
      id: randomUUID(),
      organizationId: otherOrgId,
      attemptId,
      questionId: "q-cross-org",
      score: 5,
      maxScore: 10,
      comment: "",
      gradedBy: "grader-x",
      gradedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    const rows = await manualGradingRepo.findByAttempt(ctx2, attemptId);
    expect(rows.map((r) => r.questionId)).toEqual(["q-cross-org"]);
    // original tenant still sees only its own 2 entries
    const ownRows = await manualGradingRepo.findByAttempt(ctx, attemptId);
    expect(ownRows).toHaveLength(2);
  });
});
