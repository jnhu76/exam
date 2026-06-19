import { randomUUID } from "node:crypto";
import type { RequestContext } from "@exam/domain";
import { beforeAll, describe, expect, it } from "vitest";
import { getTestDb } from "../testDb.js";
import { schema } from "../schema/pg.js";
import { createAttemptRepo } from "./attemptRepo.js";
import { createEnrollmentRepo } from "./enrollmentRepo.js";
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
    username: `cand-${ids.userId.slice(0, 4)}`,
    passwordHash: "hash",
    name: "Candidate",
    role: "Candidate",
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

describe("attemptRepo custom methods", () => {
  let db: Database;
  let attemptRepo: ReturnType<typeof createAttemptRepo>;
  let enrollmentRepo: ReturnType<typeof createEnrollmentRepo>;
  let ctx: RequestContext;
  let enrollmentId: string;
  let ids: SeedIds;
  const orgId = randomUUID();

  beforeAll(async () => {
    ids = makeIds();
    const result = await getTestDb();
    db = result.db;
    attemptRepo = createAttemptRepo(db);
    enrollmentRepo = createEnrollmentRepo(db);
    ctx = createContext(orgId);

    await seedBaseData(db, orgId, ids);

    const enr = await enrollmentRepo.create(ctx, {
      examId: ids.examId,
      candidateId: ids.candidateId,
      status: "started",
      attemptCount: 1,
    });
    enrollmentId = enr.id;
  });

  it("findActiveByEnrollment returns in_progress attempt", async () => {
    await attemptRepo.create(ctx, {
      examId: ids.examId,
      enrollmentId,
      candidateId: ids.candidateId,
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

  it("findActiveByEnrollment returns disrupted attempt (resumable)", async () => {
    const orgIdDisrupted = randomUUID();
    const idsD = makeIds();
    const ctxD = createContext(orgIdDisrupted);
    await seedBaseData(db, orgIdDisrupted, idsD);
    const enrD = await enrollmentRepo.create(ctxD, {
      examId: idsD.examId,
      candidateId: idsD.candidateId,
      status: "started",
      attemptCount: 1,
    });
    await attemptRepo.create(ctxD, {
      examId: idsD.examId,
      enrollmentId: enrD.id,
      candidateId: idsD.candidateId,
      attemptNo: 1,
      status: "disrupted",
      questionSnapshot: [],
      answers: [],
      startedAt: new Date(),
      deadlineAt: new Date(Date.now() + 3600000),
      lastActivityAt: new Date(),
    });

    const found = await attemptRepo.findActiveByEnrollment(ctxD, enrD.id);
    expect(found).toBeDefined();
    expect(found!.status).toBe("disrupted");
  });

  it("findActiveByEnrollment returns null when no active attempt", async () => {
    const orgId2 = randomUUID();
    const ids2 = makeIds();
    const ctx2 = createContext(orgId2);
    await seedBaseData(db, orgId2, ids2);
    const enr = await enrollmentRepo.create(ctx2, {
      examId: ids2.examId,
      candidateId: ids2.candidateId,
      status: "started",
      attemptCount: 1,
    });
    await attemptRepo.create(ctx2, {
      examId: ids2.examId,
      enrollmentId: enr.id,
      candidateId: ids2.candidateId,
      attemptNo: 1,
      status: "submitted",
      questionSnapshot: [],
      answers: [],
    });

    const found = await attemptRepo.findActiveByEnrollment(ctx2, enr.id);
    expect(found).toBeNull();
  });

  it("findByEnrollmentAndAttemptNo returns correct attempt", async () => {
    const found = await attemptRepo.findByEnrollmentAndAttemptNo(
      ctx,
      enrollmentId,
      1,
    );
    expect(found).toBeDefined();
    expect(found!.attemptNo).toBe(1);
  });

  it("findByExamAndCandidate returns attempts for exam+candidate", async () => {
    const found = await attemptRepo.findByExamAndCandidate(
      ctx,
      ids.examId,
      ids.candidateId,
    );
    expect(found.length).toBeGreaterThanOrEqual(1);
    expect(found[0]!.attemptNo).toBe(1);
  });

  describe("listExpirableByDeadline", () => {
    it("returns in_progress attempts whose deadlineAt <= before", async () => {
      const orgL = randomUUID();
      const idsL = makeIds();
      const ctxL = createContext(orgL);
      await seedBaseData(db, orgL, idsL);
      const enrL = await enrollmentRepo.create(ctxL, {
        examId: idsL.examId,
        candidateId: idsL.candidateId,
        status: "started",
        attemptCount: 1,
      });
      const pastDeadline = new Date(Date.now() - 60_000);
      await attemptRepo.create(ctxL, {
        examId: idsL.examId,
        enrollmentId: enrL.id,
        candidateId: idsL.candidateId,
        attemptNo: 1,
        status: "in_progress",
        questionSnapshot: [],
        answers: [],
        startedAt: new Date(Date.now() - 3600_000),
        deadlineAt: pastDeadline,
        lastActivityAt: new Date(),
      });

      const before = new Date();
      const found = await attemptRepo.listExpirableByDeadline(ctxL, before);

      expect(found.some((a) => a.enrollmentId === enrL.id)).toBe(true);
      const ours = found.find((a) => a.enrollmentId === enrL.id)!;
      expect(ours.status).toBe("in_progress");
    });

    it("returns disrupted attempts whose deadlineAt <= before", async () => {
      const orgD = randomUUID();
      const idsD = makeIds();
      const ctxD = createContext(orgD);
      await seedBaseData(db, orgD, idsD);
      const enrD = await enrollmentRepo.create(ctxD, {
        examId: idsD.examId,
        candidateId: idsD.candidateId,
        status: "started",
        attemptCount: 1,
      });
      await attemptRepo.create(ctxD, {
        examId: idsD.examId,
        enrollmentId: enrD.id,
        candidateId: idsD.candidateId,
        attemptNo: 1,
        status: "disrupted",
        questionSnapshot: [],
        answers: [],
        startedAt: new Date(Date.now() - 3600_000),
        deadlineAt: new Date(Date.now() - 60_000),
        lastActivityAt: new Date(),
      });

      const before = new Date();
      const found = await attemptRepo.listExpirableByDeadline(ctxD, before);

      expect(found.some((a) => a.enrollmentId === enrD.id)).toBe(true);
      const ours = found.find((a) => a.enrollmentId === enrD.id)!;
      expect(ours.status).toBe("disrupted");
    });

    it("does NOT return attempts whose deadlineAt is still in the future", async () => {
      const orgF = randomUUID();
      const idsF = makeIds();
      const ctxF = createContext(orgF);
      await seedBaseData(db, orgF, idsF);
      const enrF = await enrollmentRepo.create(ctxF, {
        examId: idsF.examId,
        candidateId: idsF.candidateId,
        status: "started",
        attemptCount: 1,
      });
      await attemptRepo.create(ctxF, {
        examId: idsF.examId,
        enrollmentId: enrF.id,
        candidateId: idsF.candidateId,
        attemptNo: 1,
        status: "in_progress",
        questionSnapshot: [],
        answers: [],
        startedAt: new Date(),
        deadlineAt: new Date(Date.now() + 3600_000),
        lastActivityAt: new Date(),
      });

      const before = new Date();
      const found = await attemptRepo.listExpirableByDeadline(ctxF, before);

      expect(found.some((a) => a.enrollmentId === enrF.id)).toBe(false);
    });

    it("does NOT return submitted / graded / voided attempts even if deadline passed", async () => {
      const orgS = randomUUID();
      const idsS = makeIds();
      const ctxS = createContext(orgS);
      await seedBaseData(db, orgS, idsS);
      const enrS = await enrollmentRepo.create(ctxS, {
        examId: idsS.examId,
        candidateId: idsS.candidateId,
        status: "started",
        attemptCount: 1,
      });
      const pastDeadline = new Date(Date.now() - 60_000);
      let nextNo = 2;
      for (const status of ["submitted", "grading", "graded", "voided"]) {
        await attemptRepo.create(ctxS, {
          examId: idsS.examId,
          enrollmentId: enrS.id,
          candidateId: idsS.candidateId,
          attemptNo: nextNo++,
          status: status as never,
          questionSnapshot: [],
          answers: [],
          startedAt: new Date(Date.now() - 3600_000),
          deadlineAt: pastDeadline,
          lastActivityAt: new Date(),
          ...(status === "graded"
            ? {
                gradingResult: [
                  {
                    questionId: "q1",
                    score: 0,
                    maxScore: 10,
                    correct: false,
                    candidateAnswer: null,
                    standardAnswer: "a",
                  },
                ],
                score: 0,
                passed: false,
                gradedAt: new Date(),
              }
            : {}),
        });
      }

      const before = new Date();
      const found = await attemptRepo.listExpirableByDeadline(ctxS, before);
      const ours = found.filter((a) => a.enrollmentId === enrS.id);
      expect(ours).toEqual([]);
    });

    it("respects tenant boundary (does not leak other orgs)", async () => {
      const orgA = randomUUID();
      const orgB = randomUUID();
      const idsA = makeIds();
      const idsB = makeIds();
      const ctxA = createContext(orgA);
      const ctxB = createContext(orgB);
      await seedBaseData(db, orgA, idsA);
      await seedBaseData(db, orgB, idsB);
      const enrA = await enrollmentRepo.create(ctxA, {
        examId: idsA.examId,
        candidateId: idsA.candidateId,
        status: "started",
        attemptCount: 1,
      });
      await attemptRepo.create(ctxA, {
        examId: idsA.examId,
        enrollmentId: enrA.id,
        candidateId: idsA.candidateId,
        attemptNo: 1,
        status: "in_progress",
        questionSnapshot: [],
        answers: [],
        startedAt: new Date(Date.now() - 3600_000),
        deadlineAt: new Date(Date.now() - 60_000),
        lastActivityAt: new Date(),
      });

      const found = await attemptRepo.listExpirableByDeadline(ctxB, new Date());
      expect(found.some((a) => a.enrollmentId === enrA.id)).toBe(false);
    });
  });

  // ADR-005 Slice 1: close/export unresolved-attempts guard query.
  describe("countUnresolvedByExam", () => {
    it("counts only unresolved attempt statuses", async () => {
      const orgU = randomUUID();
      const idsU = makeIds();
      const ctxU = createContext(orgU);
      await seedBaseData(db, orgU, idsU);
      const examId = idsU.examId;

      // Each attempt needs its own user + candidate: enrollment has a unique
      // (org, exam, candidate) constraint and candidate_profiles has a unique
      // (org, user) constraint.
      async function makeAttempt(status: string, attemptNo: number) {
        const uid = randomUUID();
        const candId = randomUUID();
        const now = new Date();
        await db.insert(schema.users).values({
          id: uid,
          organizationId: orgU,
          username: `cand-${uid.slice(0, 8)}`,
          passwordHash: "hash",
          name: `Cand-${attemptNo}`,
          role: "Candidate",
          isActive: true,
          createdAt: now,
          updatedAt: now,
        });
        await db.insert(schema.candidateProfiles).values({
          id: candId,
          organizationId: orgU,
          userId: uid,
          fields: {},
        });
        const enr = await enrollmentRepo.create(ctxU, {
          examId,
          candidateId: candId,
          status: "started",
          attemptCount: attemptNo,
        });
        return attemptRepo.create(ctxU, {
          examId,
          enrollmentId: enr.id,
          candidateId: candId,
          attemptNo,
          status: status as never,
          questionSnapshot: [],
          answers: [],
          startedAt: new Date(),
          deadlineAt: new Date(Date.now() + 3600_000),
          lastActivityAt: new Date(),
        });
      }

      // Unresolved (should be counted): queued, in_progress, disrupted,
      // submitted, grading.
      await makeAttempt("queued", 1);
      await makeAttempt("in_progress", 2);
      await makeAttempt("disrupted", 3);
      await makeAttempt("submitted", 4);
      await makeAttempt("grading", 5);
      // Finalized (must NOT be counted): graded, voided.
      await makeAttempt("graded", 6);
      await makeAttempt("voided", 7);

      const count = await attemptRepo.countUnresolvedByExam(ctxU, examId);
      expect(count).toBe(5);
    });

    it("returns 0 when only finalized attempts exist", async () => {
      const orgU = randomUUID();
      const idsU = makeIds();
      const ctxU = createContext(orgU);
      await seedBaseData(db, orgU, idsU);
      const examId = idsU.examId;

      const enr = await enrollmentRepo.create(ctxU, {
        examId,
        candidateId: idsU.candidateId,
        status: "started",
        attemptCount: 1,
      });
      await attemptRepo.create(ctxU, {
        examId,
        enrollmentId: enr.id,
        candidateId: idsU.candidateId,
        attemptNo: 1,
        status: "graded",
        questionSnapshot: [],
        answers: [],
        startedAt: new Date(),
        deadlineAt: new Date(Date.now() + 3600_000),
        lastActivityAt: new Date(),
      });

      const count = await attemptRepo.countUnresolvedByExam(ctxU, examId);
      expect(count).toBe(0);
    });
  });
});

describe("enrollmentRepo custom methods", () => {
  let db: Database;
  let enrollmentRepo: ReturnType<typeof createEnrollmentRepo>;
  let ctx: RequestContext;
  let ids: SeedIds;
  const orgId = randomUUID();

  beforeAll(async () => {
    ids = makeIds();
    const result = await getTestDb();
    db = result.db;
    enrollmentRepo = createEnrollmentRepo(db);
    ctx = createContext(orgId);

    await seedBaseData(db, orgId, ids);
  });

  it("findByExamAndCandidate returns enrollment", async () => {
    await enrollmentRepo.create(ctx, {
      examId: ids.examId,
      candidateId: ids.candidateId,
      status: "assigned",
      attemptCount: 0,
    });

    const found = await enrollmentRepo.findByExamAndCandidate(
      ctx,
      ids.examId,
      ids.candidateId,
    );
    expect(found).toBeDefined();
    expect(found!.candidateId).toBe(ids.candidateId);
  });

  it("findByExamAndCandidate returns null when not found", async () => {
    const orgId2 = randomUUID();
    const ids2 = makeIds();
    const ctx2 = createContext(orgId2);
    await seedBaseData(db, orgId2, ids2);
    const found = await enrollmentRepo.findByExamAndCandidate(
      ctx2,
      ids2.examId,
      ids2.candidateId,
    );
    expect(found).toBeNull();
  });

  it("findByCandidate returns all enrollments for candidate", async () => {
    const found = await enrollmentRepo.findByCandidate(ctx, ids.candidateId);
    expect(found.length).toBeGreaterThanOrEqual(1);
  });
});
