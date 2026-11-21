import { randomUUID } from "node:crypto";
import type { RequestContext } from "@exam/domain";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { schema } from "../schema/pg.js";
import { getIsolatedTestDb } from "../testDb.js";
import type { Database } from "../types.js";
import { createAttemptGradingEntryRepo } from "./attemptGradingEntryRepo.js";
import { createAttemptRepo } from "./attemptRepo.js";
import { createGradingQueueRepo } from "./gradingQueueRepo.js";
import { createRecoveryRepo } from "./recoveryRepo.js";

/**
 * Cross-org join-read contract (R-DB-1).
 *
 * The linked columns (candidate_profiles.user_id, exam_attempts.candidate_id,
 * attempt_grading_entries.attempt_id) are GLOBAL foreign keys, so a row in the
 * caller org can legitimately reference a row of ANOTHER org. Every read path
 * that joins across those edges must therefore carry the same-org predicate on
 * the joined table (or fail closed) — an org-scoped WHERE on the driving table
 * alone does not stop a foreign-org joined row from being projected.
 *
 * The recovery aggregate already implements the convention (same-org User join
 * + null-displayName fail-closed); these tests pin the same contract for the
 * four read paths that still project foreign-org identity into the caller's
 * process, plus an in-org control row proving the read paths keep working.
 */

function context(organizationId: string, actorId: string): RequestContext {
  return {
    actorId,
    organizationId,
    role: "Admin",
    permissions: [],
    sessionId: randomUUID(),
  };
}

const NOW = new Date("2026-01-01T00:00:00.000Z");

interface Fixture {
  organizationId: string;
  actorId: string;
  examId: string;
  candidateId: string;
  enrollmentId: string;
  gradedAttemptId: string;
  pendingAttemptId: string;
  ctx: RequestContext;
}

async function insertOrganization(
  db: Database,
  id: string,
  label: string,
): Promise<void> {
  await db.insert(schema.organizations).values({
    id,
    name: label,
    displayName: label,
    slug: `${label}-${id}`,
    createdAt: NOW,
    updatedAt: NOW,
  });
}

async function insertUser(
  db: Database,
  seed: {
    id?: string;
    organizationId: string;
    name: string;
    role: string;
    passwordHash?: string;
  },
): Promise<string> {
  const id = seed.id ?? randomUUID();
  await db.insert(schema.users).values({
    id,
    organizationId: seed.organizationId,
    username: `${seed.name.replace(/\s+/g, "-").toLowerCase()}-${id}`,
    passwordHash: seed.passwordHash ?? "hash",
    name: seed.name,
    role: seed.role,
    isActive: true,
    createdAt: NOW,
    updatedAt: NOW,
  });
  return id;
}

async function insertCourse(
  db: Database,
  seed: { organizationId: string },
): Promise<string> {
  const id = randomUUID();
  await db.insert(schema.courses).values({
    id,
    organizationId: seed.organizationId,
    name: "Course",
    code: `C-${id}`,
    description: "",
    createdAt: NOW,
    updatedAt: NOW,
  });
  return id;
}

async function insertExam(
  db: Database,
  seed: { organizationId: string; courseId: string },
  opts: { id?: string; title?: string } = {},
): Promise<string> {
  const id = opts.id ?? randomUUID();
  await db.insert(schema.exams).values({
    id,
    organizationId: seed.organizationId,
    title: opts.title ?? "Exam",
    description: "",
    courseId: seed.courseId,
    status: "open",
    timingMode: "timed_window",
    durationMinutes: 60,
    openAt: NOW,
    closeAt: new Date("2026-01-02T00:00:00.000Z"),
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
    maxAttempts: 1,
    createdAt: NOW,
    updatedAt: NOW,
  });
  return id;
}

async function insertEnrollment(
  db: Database,
  seed: {
    organizationId: string;
    examId: string;
    candidateId: string;
    attemptCount?: number;
  },
): Promise<string> {
  const id = randomUUID();
  await db.insert(schema.examEnrollments).values({
    id,
    organizationId: seed.organizationId,
    examId: seed.examId,
    candidateId: seed.candidateId,
    status: "started",
    attemptCount: seed.attemptCount ?? 1,
    createdAt: NOW,
    updatedAt: NOW,
  });
  return id;
}

async function insertAttempt(
  db: Database,
  seed: {
    organizationId: string;
    examId: string;
    enrollmentId: string;
    candidateId: string;
  },
  opts: {
    attemptNo?: number;
    status?: "in_progress" | "graded";
    score?: number;
    passed?: boolean;
  } = {},
): Promise<string> {
  const id = randomUUID();
  const graded = opts.status === "graded";
  await db.insert(schema.examAttempts).values({
    id,
    organizationId: seed.organizationId,
    examId: seed.examId,
    enrollmentId: seed.enrollmentId,
    candidateId: seed.candidateId,
    attemptNo: opts.attemptNo ?? 1,
    status: opts.status ?? "in_progress",
    questionSnapshot: [],
    answers: [],
    startedAt: NOW,
    deadlineAt: new Date("2026-01-01T01:00:00.000Z"),
    submittedAt: graded ? NOW : null,
    gradedAt: graded ? NOW : null,
    score: opts.score,
    passed: opts.passed,
    lastActivityAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
  });
  return id;
}

async function insertPendingManualEntry(
  db: Database,
  seed: { organizationId: string; attemptId: string; questionId: string },
): Promise<string> {
  const id = randomUUID();
  await db.insert(schema.attemptGradingEntries).values({
    id,
    organizationId: seed.organizationId,
    attemptId: seed.attemptId,
    questionId: seed.questionId,
    gradingMode: "manual",
    status: "pending_manual",
    maxScore: 10,
    comment: "",
    createdAt: NOW,
    updatedAt: NOW,
  });
  return id;
}

interface IncidentSeed {
  examId: string;
  attemptId?: string | null;
  candidateId?: string | null;
  description?: string;
}

async function insertIncident(
  db: Database,
  fx: Fixture,
  seed: IncidentSeed,
): Promise<string> {
  const id = randomUUID();
  await db.insert(schema.examIncidents).values({
    id,
    organizationId: fx.organizationId,
    examId: seed.examId,
    attemptId: seed.attemptId ?? null,
    candidateId: seed.candidateId ?? null,
    type: "network_interruption",
    severity: "info",
    status: "open",
    occurredAt: null,
    description: seed.description ?? "cross-org join read test incident",
    resolutionSummary: null,
    resolvedAt: null,
    resolvedBy: null,
    reportedBy: fx.actorId,
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
  });
  return id;
}

describe("cross-org join reads stay tenant-scoped", () => {
  let db: Database;
  let cleanup: () => Promise<void>;
  let fx: Fixture;

  beforeAll(async () => {
    const result = await getIsolatedTestDb("cross-org-join");
    db = result.db;
    cleanup = result.cleanup;

    const organizationId = randomUUID();
    await insertOrganization(db, organizationId, "Caller Org");
    const courseId = await insertCourse(db, { organizationId });
    const actorId = await insertUser(db, {
      organizationId,
      name: "Actor",
      role: "Admin",
    });
    const candidateUserId = await insertUser(db, {
      organizationId,
      name: "Candidate A",
      role: "Candidate",
    });
    const proctorUserId = await insertUser(db, {
      organizationId,
      name: "Proctor A",
      role: "Proctor",
    });
    const candidateId = randomUUID();
    await db.insert(schema.candidateProfiles).values({
      id: candidateId,
      organizationId,
      userId: candidateUserId,
      fields: {},
      createdAt: NOW,
      updatedAt: NOW,
    });
    const examId = await insertExam(db, { organizationId, courseId });
    const enrollmentId = await insertEnrollment(db, {
      organizationId,
      examId,
      candidateId,
      attemptCount: 2,
    });
    const gradedAttemptId = await insertAttempt(
      db,
      { organizationId, examId, enrollmentId, candidateId },
      { attemptNo: 1, status: "graded", score: 85, passed: true },
    );
    const pendingAttemptId = await insertAttempt(
      db,
      { organizationId, examId, enrollmentId, candidateId },
      { attemptNo: 2 },
    );
    await db.insert(schema.examProctorAssignments).values({
      id: randomUUID(),
      organizationId,
      examId,
      proctorUserId,
      status: "active",
      assignedBy: actorId,
      assignedAt: NOW,
      revokedBy: null,
      revokedAt: null,
      createdAt: NOW,
      updatedAt: NOW,
    });

    fx = {
      organizationId,
      actorId,
      examId,
      candidateId,
      enrollmentId,
      gradedAttemptId,
      pendingAttemptId,
      ctx: context(organizationId, actorId),
    };
  }, 30_000);

  afterAll(async () => {
    await cleanup();
  }, 30_000);

  it("findCandidateWithUser does not project a foreign-org User through the candidate-profile join", async () => {
    const repo = createGradingQueueRepo(db);
    const foreignOrgId = randomUUID();
    const foreignUserId = randomUUID();
    const brokenProfileId = randomUUID();
    await insertOrganization(db, foreignOrgId, "Foreign Candidate Org");
    await insertUser(db, {
      id: foreignUserId,
      organizationId: foreignOrgId,
      name: "FOREIGN-CANDIDATE-B-NAME",
      role: "Candidate",
      passwordHash: "FOREIGN-HASH-B",
    });
    // FK-legitimate anomaly: the profile is in the caller org, but its
    // user_id points at another org's User (global FK, no org composite).
    await db.insert(schema.candidateProfiles).values({
      id: brokenProfileId,
      organizationId: fx.organizationId,
      userId: foreignUserId,
      fields: {},
      createdAt: NOW,
      updatedAt: NOW,
    });
    try {
      const control = await repo.findCandidateWithUser(fx.ctx, fx.candidateId);
      expect(control).not.toBeNull();
      expect(control!.user.organizationId).toBe(fx.organizationId);
      expect(control!.user.name).toBe("Candidate A");

      // The foreign User's identity (name, passwordHash) must never be
      // projected into the caller's process through this join.
      const broken = await repo.findCandidateWithUser(fx.ctx, brokenProfileId);
      expect(broken).toBeNull();
    } finally {
      await db
        .delete(schema.candidateProfiles)
        .where(eq(schema.candidateProfiles.id, brokenProfileId));
      await db.delete(schema.users).where(eq(schema.users.id, foreignUserId));
      await db
        .delete(schema.organizations)
        .where(eq(schema.organizations.id, foreignOrgId));
    }
  });

  it("listGradedByExam does not project a foreign-org candidate profile or user", async () => {
    const repo = createAttemptRepo(db);
    const foreignOrgId = randomUUID();
    const foreignUserId = randomUUID();
    const foreignProfileId = randomUUID();
    await insertOrganization(db, foreignOrgId, "Foreign Profile Org");
    await insertUser(db, {
      id: foreignUserId,
      organizationId: foreignOrgId,
      name: "FOREIGN-CANDIDATE-B-NAME",
      role: "Candidate",
    });
    await db.insert(schema.candidateProfiles).values({
      id: foreignProfileId,
      organizationId: foreignOrgId,
      userId: foreignUserId,
      fields: { studentNo: "FOREIGN-IDENTITY-777" },
      createdAt: NOW,
      updatedAt: NOW,
    });
    // FK-legitimate anomaly: the graded attempt belongs to the caller org,
    // but its candidateId points at another org's candidate profile.
    const foreignEnrollmentId = await insertEnrollment(db, {
      organizationId: fx.organizationId,
      examId: fx.examId,
      candidateId: foreignProfileId,
    });
    const foreignAttemptId = await insertAttempt(
      db,
      {
        organizationId: fx.organizationId,
        examId: fx.examId,
        enrollmentId: foreignEnrollmentId,
        candidateId: foreignProfileId,
      },
      { status: "graded", score: 90, passed: true },
    );
    try {
      const rows = await repo.listGradedByExam(fx.ctx, fx.examId);

      const control = rows.find((r) => r.attempt.id === fx.gradedAttemptId);
      expect(control).toBeDefined();
      expect(control!.candidateUser.organizationId).toBe(fx.organizationId);

      // The foreign attempt must not be projected with the foreign org's
      // profile (identity fields) or user (display name).
      expect(
        rows.find((r) => r.attempt.id === foreignAttemptId),
      ).toBeUndefined();
      for (const row of rows) {
        expect(row.candidateProfile.organizationId).toBe(fx.organizationId);
        expect(row.candidateUser.organizationId).toBe(fx.organizationId);
      }
    } finally {
      await db
        .delete(schema.examAttempts)
        .where(eq(schema.examAttempts.id, foreignAttemptId));
      await db
        .delete(schema.examEnrollments)
        .where(eq(schema.examEnrollments.id, foreignEnrollmentId));
      await db
        .delete(schema.candidateProfiles)
        .where(eq(schema.candidateProfiles.id, foreignProfileId));
      await db.delete(schema.users).where(eq(schema.users.id, foreignUserId));
      await db
        .delete(schema.organizations)
        .where(eq(schema.organizations.id, foreignOrgId));
    }
  });

  it("listPendingManualQueue does not project a foreign-org attempt, exam, or candidate", async () => {
    const repo = createAttemptGradingEntryRepo(db);
    // The caller org holds the pending grading entry, but the referenced
    // attempt (and through it the exam, profile, and user) lives in another
    // org — every link is a global FK, so plain INSERTs make this state.
    const foreignOrgId = randomUUID();
    await insertOrganization(db, foreignOrgId, "Foreign Exam Org");
    const foreignCourseId = await insertCourse(db, {
      organizationId: foreignOrgId,
    });
    const foreignExamId = await insertExam(
      db,
      { organizationId: foreignOrgId, courseId: foreignCourseId },
      { title: "FOREIGN-EXAM-B" },
    );
    const foreignUserId = await insertUser(db, {
      organizationId: foreignOrgId,
      name: "FOREIGN-CANDIDATE-B-NAME",
      role: "Candidate",
    });
    const foreignProfileId = randomUUID();
    await db.insert(schema.candidateProfiles).values({
      id: foreignProfileId,
      organizationId: foreignOrgId,
      userId: foreignUserId,
      fields: { studentNo: "FOREIGN-IDENTITY-777" },
      createdAt: NOW,
      updatedAt: NOW,
    });
    const foreignEnrollmentId = await insertEnrollment(db, {
      organizationId: foreignOrgId,
      examId: foreignExamId,
      candidateId: foreignProfileId,
    });
    const foreignAttemptId = await insertAttempt(db, {
      organizationId: foreignOrgId,
      examId: foreignExamId,
      enrollmentId: foreignEnrollmentId,
      candidateId: foreignProfileId,
    });
    const foreignEntryId = await insertPendingManualEntry(db, {
      organizationId: fx.organizationId,
      attemptId: foreignAttemptId,
      questionId: "q-foreign",
    });
    const controlEntryId = await insertPendingManualEntry(db, {
      organizationId: fx.organizationId,
      attemptId: fx.pendingAttemptId,
      questionId: "q-control",
    });
    try {
      const groups = await repo.listPendingManualQueue(fx.ctx);

      const control = groups.find((g) => g.attempt.id === fx.pendingAttemptId);
      expect(control).toBeDefined();
      expect(control!.exam.id).toBe(fx.examId);
      expect(control!.candidateUser.organizationId).toBe(fx.organizationId);

      // The foreign attempt must not surface in the caller's grading queue
      // with the foreign exam title, profile fields, or user name.
      expect(
        groups.find((g) => g.attempt.id === foreignAttemptId),
      ).toBeUndefined();
      for (const group of groups) {
        expect(group.exam.organizationId).toBe(fx.organizationId);
        expect(group.candidateProfile.organizationId).toBe(fx.organizationId);
        expect(group.candidateUser.organizationId).toBe(fx.organizationId);
      }
    } finally {
      await db
        .delete(schema.attemptGradingEntries)
        .where(eq(schema.attemptGradingEntries.id, foreignEntryId));
      await db
        .delete(schema.attemptGradingEntries)
        .where(eq(schema.attemptGradingEntries.id, controlEntryId));
      await db
        .delete(schema.examAttempts)
        .where(eq(schema.examAttempts.id, foreignAttemptId));
      await db
        .delete(schema.examEnrollments)
        .where(eq(schema.examEnrollments.id, foreignEnrollmentId));
      await db.delete(schema.exams).where(eq(schema.exams.id, foreignExamId));
      await db
        .delete(schema.courses)
        .where(eq(schema.courses.id, foreignCourseId));
      await db
        .delete(schema.candidateProfiles)
        .where(eq(schema.candidateProfiles.id, foreignProfileId));
      await db.delete(schema.users).where(eq(schema.users.id, foreignUserId));
      await db
        .delete(schema.organizations)
        .where(eq(schema.organizations.id, foreignOrgId));
    }
  });

  it("listIncidentQueue fails closed when an anchored candidate's user is foreign (RECOVERY_QUEUE_CANDIDATE_BROKEN)", async () => {
    const repo = createRecoveryRepo(db);
    const foreignOrgId = randomUUID();
    const foreignUserId = randomUUID();
    const brokenProfileId = randomUUID();
    await insertOrganization(db, foreignOrgId, "Foreign Anchor Org");
    await insertUser(db, {
      id: foreignUserId,
      organizationId: foreignOrgId,
      name: "FOREIGN-CANDIDATE-B-NAME",
      role: "Candidate",
    });
    await db.insert(schema.candidateProfiles).values({
      id: brokenProfileId,
      organizationId: fx.organizationId,
      userId: foreignUserId,
      fields: {},
      createdAt: NOW,
      updatedAt: NOW,
    });
    const incidentId = await insertIncident(db, fx, {
      examId: fx.examId,
      candidateId: brokenProfileId,
      description: "cross-org anchored candidate",
    });
    try {
      // Same corruption contract as the incident aggregate: a queue candidate
      // whose same-org User cannot resolve is tenant-graph corruption and
      // must fail closed, never project the foreign org's display name.
      await expect(
        repo.listIncidentQueue(fx.ctx, { limit: 20 }),
      ).rejects.toMatchObject({
        name: "AuthzUnavailableError",
        code: "AUTHZ_UNAVAILABLE",
        statusCode: 503,
        message: expect.stringContaining("RECOVERY_QUEUE_CANDIDATE_BROKEN"),
      });
    } finally {
      await db
        .delete(schema.examIncidents)
        .where(
          and(
            eq(schema.examIncidents.organizationId, fx.organizationId),
            eq(schema.examIncidents.id, incidentId),
          ),
        );
      await db
        .delete(schema.candidateProfiles)
        .where(eq(schema.candidateProfiles.id, brokenProfileId));
      await db.delete(schema.users).where(eq(schema.users.id, foreignUserId));
      await db
        .delete(schema.organizations)
        .where(eq(schema.organizations.id, foreignOrgId));
    }
  });

  it("listIncidentQueue fails closed when an active proctor's user is foreign (RECOVERY_QUEUE_PROCTOR_BROKEN)", async () => {
    const repo = createRecoveryRepo(db);
    const foreignOrgId = randomUUID();
    const foreignUserId = randomUUID();
    await insertOrganization(db, foreignOrgId, "Foreign Proctor Org");
    await insertUser(db, {
      id: foreignUserId,
      organizationId: foreignOrgId,
      name: "FOREIGN-PROCTOR-B",
      role: "Proctor",
    });
    // FK-legitimate anomaly: the active proctor assignment belongs to the
    // caller org, but the proctor user is another org's user.
    await db.insert(schema.examProctorAssignments).values({
      id: randomUUID(),
      organizationId: fx.organizationId,
      examId: fx.examId,
      proctorUserId: foreignUserId,
      status: "active",
      assignedBy: fx.actorId,
      assignedAt: NOW,
      revokedBy: null,
      revokedAt: null,
      createdAt: NOW,
      updatedAt: NOW,
    });
    const incidentId = await insertIncident(db, fx, {
      examId: fx.examId,
      description: "cross-org active proctor",
    });
    try {
      // Same fail-closed contract as the in-org missing user: a proctor
      // whose same-org User cannot resolve is corruption, never an
      // empty-name stub or a foreign display name.
      await expect(
        repo.listIncidentQueue(fx.ctx, { limit: 20 }),
      ).rejects.toMatchObject({
        name: "AuthzUnavailableError",
        code: "AUTHZ_UNAVAILABLE",
        statusCode: 503,
        message: expect.stringContaining("RECOVERY_QUEUE_PROCTOR_BROKEN"),
      });
    } finally {
      await db
        .delete(schema.examIncidents)
        .where(
          and(
            eq(schema.examIncidents.organizationId, fx.organizationId),
            eq(schema.examIncidents.id, incidentId),
          ),
        );
      await db
        .delete(schema.examProctorAssignments)
        .where(eq(schema.examProctorAssignments.proctorUserId, foreignUserId));
      await db.delete(schema.users).where(eq(schema.users.id, foreignUserId));
      await db
        .delete(schema.organizations)
        .where(eq(schema.organizations.id, foreignOrgId));
    }
  });
});
