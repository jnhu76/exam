import { randomUUID } from "node:crypto";
import type { RequestContext } from "@exam/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getWorkerScopedTestDb } from "../testDb.js";
import { schema } from "../schema/pg.js";
import { createSystemStatsRepo } from "./systemStatsRepo.js";
import { createEnrollmentRepo } from "./enrollmentRepo.js";
import type { Database } from "../types.js";

function createContext(organizationId: string): RequestContext {
  return {
    actorId: randomUUID(),
    organizationId,
    role: "Admin",
    permissions: [],
    sessionId: randomUUID(),
    targetOrganizationId: organizationId,
  };
}

/** Inserts org + course and returns the course id. */
async function seedOrg(
  db: Database,
  orgId: string,
  slug: string,
): Promise<string> {
  const now = new Date();
  const courseId = randomUUID();
  await db.insert(schema.organizations).values({
    id: orgId,
    name: slug,
    displayName: slug,
    slug: `test-${slug}-${orgId.slice(0, 8)}`,
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
  return courseId;
}

/** Inserts an exam in the given course and returns the exam id. */
async function seedExam(
  db: Database,
  orgId: string,
  courseId: string,
  title: string,
): Promise<string> {
  const now = new Date();
  const examId = randomUUID();
  await db.insert(schema.exams).values({
    id: examId,
    organizationId: orgId,
    title,
    description: "",
    courseId,
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
  return examId;
}

/** Inserts a candidate user + profile and returns the candidate profile id. */
async function seedCandidate(
  db: Database,
  orgId: string,
  index: number,
): Promise<string> {
  const now = new Date();
  const userId = randomUUID();
  const candidateId = randomUUID();
  await db.insert(schema.users).values({
    id: userId,
    organizationId: orgId,
    username: `cand-${orgId.slice(0, 8)}-${index}`,
    passwordHash: "hash",
    name: `Candidate ${index}`,
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
  return candidateId;
}

/**
 * Regression (#833): dashboard `getRecentExams` must report the real
 * enrollment count per exam — the same fact as the /admin/exams list's
 * `participantCount` — not the hardcoded 0 stub.
 */
describe("systemStatsRepo.getRecentExams participantCount", () => {
  let db: Database;
  let cleanup: () => Promise<void>;
  const orgA = randomUUID();
  const orgB = randomUUID();
  let examWithEnrollmentsId: string;
  let examWithoutEnrollmentsId: string;
  let orgBExamId: string;
  let ctxA: RequestContext;
  let ctxB: RequestContext;
  let repo: ReturnType<typeof createSystemStatsRepo>;

  beforeAll(async () => {
    const result = await getWorkerScopedTestDb();
    db = result.db;
    cleanup = result.cleanup;
    repo = createSystemStatsRepo(db);
    ctxA = createContext(orgA);
    ctxB = createContext(orgB);

    const courseA = await seedOrg(db, orgA, "orga");
    examWithEnrollmentsId = await seedExam(
      db,
      orgA,
      courseA,
      "Exam with enrollments",
    );
    examWithoutEnrollmentsId = await seedExam(
      db,
      orgA,
      courseA,
      "Exam without enrollments",
    );
    const courseB = await seedOrg(db, orgB, "orgb");
    orgBExamId = await seedExam(db, orgB, courseB, "Org B exam");

    // The /admin/exams participantCount counts EVERY enrollment row for the
    // exam regardless of status; these must all be reflected.
    const enrollmentRepo = createEnrollmentRepo(db);
    for (const [index, status] of (
      ["assigned", "started", "completed"] as const
    ).entries()) {
      const candidateId = await seedCandidate(db, orgA, index);
      await enrollmentRepo.create(ctxA, {
        examId: examWithEnrollmentsId,
        candidateId,
        status,
        attemptCount: 0,
      });
    }
    const orgBCandidate = await seedCandidate(db, orgB, 0);
    await enrollmentRepo.create(ctxB, {
      examId: orgBExamId,
      candidateId: orgBCandidate,
      status: "assigned",
      attemptCount: 0,
    });
  }, 30_000);

  afterAll(async () => {
    await cleanup();
  }, 30_000);

  it("reports the real enrollment count (all statuses) per exam", async () => {
    const recent = await repo.getRecentExams(ctxA);
    const withEnrollments = recent.find(
      (exam) => exam.id === examWithEnrollmentsId,
    );
    expect(withEnrollments).toBeDefined();
    expect(withEnrollments?.participantCount).toBe(3);
  });

  it("returns 0 for an exam without enrollments", async () => {
    const recent = await repo.getRecentExams(ctxA);
    const withoutEnrollments = recent.find(
      (exam) => exam.id === examWithoutEnrollmentsId,
    );
    expect(withoutEnrollments).toBeDefined();
    expect(withoutEnrollments?.participantCount).toBe(0);
  });

  it("stays tenant-scoped: only the requesting organization's exams and enrollments", async () => {
    const recentA = await repo.getRecentExams(ctxA);
    expect(recentA.some((exam) => exam.id === orgBExamId)).toBe(false);

    const recentB = await repo.getRecentExams(ctxB);
    const orgBExam = recentB.find((exam) => exam.id === orgBExamId);
    expect(orgBExam).toBeDefined();
    expect(orgBExam?.participantCount).toBe(1);
  });
});
