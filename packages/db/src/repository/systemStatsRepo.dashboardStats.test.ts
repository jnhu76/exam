import { randomUUID } from "node:crypto";
import type { RequestContext } from "@exam/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getWorkerScopedTestDb } from "../testDb.js";
import { schema } from "../schema/pg.js";
import { createSystemStatsRepo } from "./systemStatsRepo.js";
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

/** Inserts an enrollment row and returns the enrollment id. */
async function seedEnrollment(
  db: Database,
  orgId: string,
  examId: string,
  candidateId: string,
): Promise<string> {
  const now = new Date();
  const enrollmentId = randomUUID();
  await db.insert(schema.examEnrollments).values({
    id: enrollmentId,
    organizationId: orgId,
    examId,
    candidateId,
    status: "started",
    attemptCount: 0,
    createdAt: now,
    updatedAt: now,
  });
  return enrollmentId;
}

/** Inserts one attempt row with explicit startedAt (null allowed). */
async function seedAttempt(
  db: Database,
  orgId: string,
  examId: string,
  enrollmentId: string,
  candidateId: string,
  attemptNo: number,
  startedAt: Date | null,
  status: "in_progress" | "graded",
): Promise<void> {
  const now = new Date();
  await db.insert(schema.examAttempts).values({
    id: randomUUID(),
    organizationId: orgId,
    examId,
    enrollmentId,
    candidateId,
    attemptNo,
    status,
    questionSnapshot: [],
    answers: [],
    startedAt,
    deadlineAt: new Date(now.getTime() + 3600_000),
    lastActivityAt: startedAt ?? now,
    createdAt: now,
    updatedAt: now,
  });
}

/**
 * Local calendar-day boundary — the same "当日" bucket the dashboard stat
 * reports against (repo computes it from the process wall clock; APP_TIMEZONE
 * wiring is an open TODO in systemStatsRepo).
 */
function localStartOfDay(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/**
 * Acceptance (UX-R1 S6.4 / R0-F7): `getDashboardStats().todayAttempts` is the
 * per-attempt count (人次) of attempt rows started since the local day
 * boundary — retakes count separately, so it is neither the number of exam
 * sessions (场数) nor of unique candidates (人数). Rows started before the
 * boundary (跨日) or never started (startedAt null, 空值) are excluded, and
 * the bucket is tenant-scoped. #833's participantCount is a different fact
 * and is not re-implemented here.
 *
 * Seeding happens inside each `it` so seed and query share one calendar day
 * even when a run starts within seconds of midnight.
 */
describe("systemStatsRepo.getDashboardStats todayAttempts", () => {
  let db: Database;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    const result = await getWorkerScopedTestDb();
    db = result.db;
    cleanup = result.cleanup;
  }, 30_000);

  afterAll(async () => {
    await cleanup();
  }, 30_000);

  it("counts attempts (人次): retakes separately across one exam and multiple candidates", async () => {
    const orgId = randomUUID();
    const ctx = createContext(orgId);
    const repo = createSystemStatsRepo(db);
    const courseId = await seedOrg(db, orgId, "dash-mult");
    const examId = await seedExam(db, orgId, courseId, "One exam, retakes");
    const candidateA = await seedCandidate(db, orgId, 0);
    const candidateB = await seedCandidate(db, orgId, 1);
    const enrollmentA = await seedEnrollment(db, orgId, examId, candidateA);
    const enrollmentB = await seedEnrollment(db, orgId, examId, candidateB);
    const startOfDay = localStartOfDay();

    await seedAttempt(
      db,
      orgId,
      examId,
      enrollmentA,
      candidateA,
      1,
      new Date(startOfDay.getTime() - 26 * 3600_000),
      "graded",
    ); // 跨日 — excluded
    await seedAttempt(
      db,
      orgId,
      examId,
      enrollmentA,
      candidateA,
      2,
      new Date(),
      "in_progress",
    ); // today
    await seedAttempt(
      db,
      orgId,
      examId,
      enrollmentA,
      candidateA,
      3,
      startOfDay,
      "in_progress",
    ); // exact boundary — gte includes it
    await seedAttempt(
      db,
      orgId,
      examId,
      enrollmentB,
      candidateB,
      1,
      new Date(),
      "in_progress",
    ); // today
    await seedAttempt(
      db,
      orgId,
      examId,
      enrollmentB,
      candidateB,
      2,
      null,
      "in_progress",
    ); // 空值 (never started) — excluded

    const stats = await repo.getDashboardStats(ctx);
    // 3 人次 (A2 + boundary A3 + B1) — with 1 exam and 2 candidates, an exam
    // count (场数) would read 1 and a unique-candidate count (人数) would read 2.
    expect(stats.todayAttempts).toBe(3);
  });

  it("returns 0 for an org without attempts today and stays tenant-scoped", async () => {
    const orgEmpty = randomUUID();
    const orgWithAttempt = randomUUID();
    const repo = createSystemStatsRepo(db);
    const courseEmpty = await seedOrg(db, orgEmpty, "dash-zero");
    const examEmpty = await seedExam(db, orgEmpty, courseEmpty, "No attempts");
    const candidateEmpty = await seedCandidate(db, orgEmpty, 0);
    await seedEnrollment(db, orgEmpty, examEmpty, candidateEmpty);

    const courseOther = await seedOrg(db, orgWithAttempt, "dash-other");
    const examOther = await seedExam(
      db,
      orgWithAttempt,
      courseOther,
      "Other org",
    );
    const candidateOther = await seedCandidate(db, orgWithAttempt, 0);
    const enrollmentOther = await seedEnrollment(
      db,
      orgWithAttempt,
      examOther,
      candidateOther,
    );
    await seedAttempt(
      db,
      orgWithAttempt,
      examOther,
      enrollmentOther,
      candidateOther,
      1,
      new Date(),
      "in_progress",
    );

    const emptyStats = await repo.getDashboardStats(createContext(orgEmpty));
    expect(emptyStats.todayAttempts).toBe(0);

    const otherStats = await repo.getDashboardStats(
      createContext(orgWithAttempt),
    );
    expect(otherStats.todayAttempts).toBe(1);
  });
});
