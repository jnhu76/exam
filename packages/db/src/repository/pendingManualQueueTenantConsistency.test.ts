import { randomUUID } from "node:crypto";
import type { RequestContext } from "@exam/domain";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { schema } from "../schema/pg.js";
import { getIsolatedTestDb } from "../testDb.js";
import type { Database } from "../types.js";
import { createAttemptGradingEntryRepo } from "./attemptGradingEntryRepo.js";

/**
 * Tenant-consistency contract for the pending-manual grading queue
 * (Owner review HOLD on PR #1068 / WP-05 R-DB-1).
 *
 * listPendingManualQueue and countPendingManualQueue feed the same
 * GET /admin/grading-queue response: the count IS the pagination total for
 * the rows list projects under the SAME filter (apps/api grading-queue
 * route: "list + count receive the SAME filter so pagination totals
 * agree").
 *
 * The links attempt_grading_entries.attempt_id, exam_attempts.exam_id,
 * exam_attempts.candidate_id and candidate_profiles.user_id are GLOBAL
 * foreign keys, so rows can be FK-legitimate yet tenant-inconsistent. Under
 * that anomaly these tests pin two invariants:
 *
 * 1. Neither method may surface an attempt row of another organization:
 *    list must not project it and count must not total it.
 * 2. count must equal the unpaginated list length under every filter shape
 *    (no filter, examId, examIds non-empty; examIds empty is the
 *    zero-rows contract for both).
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
  seed: { id: string; organizationId: string; name: string },
): Promise<void> {
  await db.insert(schema.users).values({
    id: seed.id,
    organizationId: seed.organizationId,
    username: `${seed.name.replace(/\s+/g, "-").toLowerCase()}-${seed.id}`,
    passwordHash: "hash",
    name: seed.name,
    role: "Candidate",
    isActive: true,
    createdAt: NOW,
    updatedAt: NOW,
  });
}

async function insertCourse(
  db: Database,
  organizationId: string,
): Promise<string> {
  const id = randomUUID();
  await db.insert(schema.courses).values({
    id,
    organizationId,
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
  seed: { organizationId: string; courseId: string; title?: string },
): Promise<string> {
  const id = randomUUID();
  await db.insert(schema.exams).values({
    id,
    organizationId: seed.organizationId,
    title: seed.title ?? "Exam",
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

async function insertProfile(
  db: Database,
  seed: { id: string; organizationId: string; userId: string },
): Promise<void> {
  await db.insert(schema.candidateProfiles).values({
    id: seed.id,
    organizationId: seed.organizationId,
    userId: seed.userId,
    fields: {},
    createdAt: NOW,
    updatedAt: NOW,
  });
}

async function insertEnrollment(
  db: Database,
  seed: { organizationId: string; examId: string; candidateId: string },
): Promise<string> {
  const id = randomUUID();
  await db.insert(schema.examEnrollments).values({
    id,
    organizationId: seed.organizationId,
    examId: seed.examId,
    candidateId: seed.candidateId,
    status: "started",
    attemptCount: 1,
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
): Promise<string> {
  const id = randomUUID();
  await db.insert(schema.examAttempts).values({
    id,
    organizationId: seed.organizationId,
    examId: seed.examId,
    enrollmentId: seed.enrollmentId,
    candidateId: seed.candidateId,
    attemptNo: 1,
    status: "in_progress",
    questionSnapshot: [],
    answers: [],
    startedAt: NOW,
    deadlineAt: new Date("2026-01-01T01:00:00.000Z"),
    submittedAt: NOW,
    gradedAt: null,
    score: null,
    passed: null,
    lastActivityAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
  });
  return id;
}

async function insertPendingEntry(
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

describe("pending manual queue tenant consistency", () => {
  let db: Database;
  let cleanup: () => Promise<void>;

  // Caller-org skeleton: org, two exams, one in-org candidate chain, one
  // enrollment and one healthy attempt the per-scenario tests hang their
  // in-org control entries on.
  let orgId: string;
  let examAId: string;
  let examBId: string;
  let enrollmentId: string;
  let healthyAttemptId: string;
  let callerProfileId: string;
  let ctx: RequestContext;

  beforeAll(async () => {
    const result = await getIsolatedTestDb("pq-tenant-consistency");
    db = result.db;
    cleanup = result.cleanup;

    orgId = randomUUID();
    await insertOrganization(db, orgId, "Caller Org");
    const courseId = await insertCourse(db, orgId);
    examAId = await insertExam(db, {
      organizationId: orgId,
      courseId,
      title: "Exam A",
    });
    examBId = await insertExam(db, {
      organizationId: orgId,
      courseId,
      title: "Exam B",
    });
    const candidateUserId = randomUUID();
    await insertUser(db, {
      id: candidateUserId,
      organizationId: orgId,
      name: "Candidate A",
    });
    const candidateId = randomUUID();
    await insertProfile(db, {
      id: candidateId,
      organizationId: orgId,
      userId: candidateUserId,
    });
    callerProfileId = candidateId;
    enrollmentId = await insertEnrollment(db, {
      organizationId: orgId,
      examId: examAId,
      candidateId,
    });
    healthyAttemptId = await insertAttempt(db, {
      organizationId: orgId,
      examId: examAId,
      enrollmentId,
      candidateId,
    });
    ctx = context(orgId, randomUUID());
  }, 30_000);

  afterAll(async () => {
    await cleanup();
  }, 30_000);

  /**
   * In-org control entry so every scenario asserts against a working
   * same-org row, not an empty queue.
   */
  async function insertControlEntry(questionId: string): Promise<string> {
    return insertPendingEntry(db, {
      organizationId: orgId,
      attemptId: healthyAttemptId,
      questionId,
    });
  }

  it("count and list agree when the attempt's candidate profile is foreign-org (FK-legitimate)", async () => {
    const repo = createAttemptGradingEntryRepo(db);
    const foreignOrgId = randomUUID();
    const foreignUserId = randomUUID();
    const foreignProfileId = randomUUID();
    await insertOrganization(db, foreignOrgId, "Foreign Profile Org");
    await insertUser(db, {
      id: foreignUserId,
      organizationId: foreignOrgId,
      name: "FOREIGN-CANDIDATE-B-NAME",
    });
    await insertProfile(db, {
      id: foreignProfileId,
      organizationId: foreignOrgId,
      userId: foreignUserId,
    });
    // FK-legitimate anomaly: the attempt and its grading entry belong to the
    // caller org, but attempt.candidate_id resolves to a foreign-org profile.
    // Dedicated enrollment keeps the (org, enrollment, attempt_no) unique
    // key clear of the healthy attempt.
    const anomalousEnrollmentId = await insertEnrollment(db, {
      organizationId: orgId,
      examId: examAId,
      candidateId: foreignProfileId,
    });
    const anomalousAttemptId = await insertAttempt(db, {
      organizationId: orgId,
      examId: examAId,
      enrollmentId: anomalousEnrollmentId,
      candidateId: foreignProfileId,
    });
    const controlEntryId = await insertControlEntry("q-control-1");
    const anomalousEntryId = await insertPendingEntry(db, {
      organizationId: orgId,
      attemptId: anomalousAttemptId,
      questionId: "q-anomaly-1",
    });
    try {
      const all = await repo.listPendingManualQueue(ctx, {});
      const total = await repo.countPendingManualQueue(ctx, {});

      // The healthy row keeps the queue working.
      expect(all.find((r) => r.attempt.id === healthyAttemptId)).toBeDefined();
      // The anomalous attempt must not be projected with foreign identity…
      expect(
        all.find((r) => r.attempt.id === anomalousAttemptId),
      ).toBeUndefined();
      // …and the pagination total must not count rows list drops.
      expect(total).toBe(all.length);
    } finally {
      await db
        .delete(schema.attemptGradingEntries)
        .where(eq(schema.attemptGradingEntries.id, anomalousEntryId));
      await db
        .delete(schema.attemptGradingEntries)
        .where(eq(schema.attemptGradingEntries.id, controlEntryId));
      await db
        .delete(schema.examAttempts)
        .where(eq(schema.examAttempts.id, anomalousAttemptId));
      await db
        .delete(schema.examEnrollments)
        .where(eq(schema.examEnrollments.id, anomalousEnrollmentId));
      await db
        .delete(schema.candidateProfiles)
        .where(eq(schema.candidateProfiles.id, foreignProfileId));
      await db.delete(schema.users).where(eq(schema.users.id, foreignUserId));
      await db
        .delete(schema.organizations)
        .where(eq(schema.organizations.id, foreignOrgId));
    }
  });

  it("count and list agree when the candidate profile's user is foreign-org (FK-legitimate)", async () => {
    const repo = createAttemptGradingEntryRepo(db);
    const foreignOrgId = randomUUID();
    const foreignUserId = randomUUID();
    const brokenProfileId = randomUUID();
    await insertOrganization(db, foreignOrgId, "Foreign User Org");
    await insertUser(db, {
      id: foreignUserId,
      organizationId: foreignOrgId,
      name: "FOREIGN-USER-B-NAME",
    });
    // FK-legitimate anomaly: in-org profile whose user_id resolves to a
    // foreign-org user; the attempt and entry are in-org.
    await insertProfile(db, {
      id: brokenProfileId,
      organizationId: orgId,
      userId: foreignUserId,
    });
    const anomalousEnrollmentId = await insertEnrollment(db, {
      organizationId: orgId,
      examId: examAId,
      candidateId: brokenProfileId,
    });
    const anomalousAttemptId = await insertAttempt(db, {
      organizationId: orgId,
      examId: examAId,
      enrollmentId: anomalousEnrollmentId,
      candidateId: brokenProfileId,
    });
    const controlEntryId = await insertControlEntry("q-control-2");
    const anomalousEntryId = await insertPendingEntry(db, {
      organizationId: orgId,
      attemptId: anomalousAttemptId,
      questionId: "q-anomaly-2",
    });
    try {
      const all = await repo.listPendingManualQueue(ctx, {});
      const total = await repo.countPendingManualQueue(ctx, {});

      expect(all.find((r) => r.attempt.id === healthyAttemptId)).toBeDefined();
      expect(
        all.find((r) => r.attempt.id === anomalousAttemptId),
      ).toBeUndefined();
      expect(total).toBe(all.length);
    } finally {
      await db
        .delete(schema.attemptGradingEntries)
        .where(eq(schema.attemptGradingEntries.id, anomalousEntryId));
      await db
        .delete(schema.attemptGradingEntries)
        .where(eq(schema.attemptGradingEntries.id, controlEntryId));
      await db
        .delete(schema.examAttempts)
        .where(eq(schema.examAttempts.id, anomalousAttemptId));
      await db
        .delete(schema.examEnrollments)
        .where(eq(schema.examEnrollments.id, anomalousEnrollmentId));
      await db
        .delete(schema.candidateProfiles)
        .where(eq(schema.candidateProfiles.id, brokenProfileId));
      await db.delete(schema.users).where(eq(schema.users.id, foreignUserId));
      await db
        .delete(schema.organizations)
        .where(eq(schema.organizations.id, foreignOrgId));
    }
  });

  it("list never projects a foreign-org attempt row, even when its exam/profile/user chain resolves in-org", async () => {
    const repo = createAttemptGradingEntryRepo(db);
    const foreignOrgId = randomUUID();
    await insertOrganization(db, foreignOrgId, "Foreign Attempt Org");
    // FK-legitimate anomaly: the attempt ROW belongs to a foreign org, but
    // every joined row it points at (exam, enrollment, profile, user) is
    // caller-org, and the caller org holds the pending grading entry. The
    // joined same-org predicates alone cannot stop this attempt row from
    // being projected.
    const foreignEnrollmentId = await insertEnrollment(db, {
      organizationId: foreignOrgId,
      examId: examAId,
      candidateId: callerProfileId,
    });
    const foreignAttemptId = await insertAttempt(db, {
      organizationId: foreignOrgId,
      examId: examAId,
      enrollmentId: foreignEnrollmentId,
      candidateId: callerProfileId,
    });
    const controlEntryId = await insertControlEntry("q-control-3");
    const foreignEntryId = await insertPendingEntry(db, {
      organizationId: orgId,
      attemptId: foreignAttemptId,
      questionId: "q-anomaly-3",
    });
    try {
      const all = await repo.listPendingManualQueue(ctx, {});
      const total = await repo.countPendingManualQueue(ctx, {});

      expect(all.find((r) => r.attempt.id === healthyAttemptId)).toBeDefined();
      // The foreign-org attempt row must not be projected at all.
      expect(
        all.find((r) => r.attempt.id === foreignAttemptId),
      ).toBeUndefined();
      for (const row of all) {
        expect(row.attempt.organizationId).toBe(orgId);
      }
      // Same-filter agreement: count must not total the dropped row either.
      expect(total).toBe(all.length);

      // examId filter must not smuggle the anomalous attempt in through the
      // in-org exam it references.
      const filtered = await repo.listPendingManualQueue(ctx, {
        examId: examAId,
      });
      const filteredTotal = await repo.countPendingManualQueue(ctx, {
        examId: examAId,
      });
      expect(
        filtered.find((r) => r.attempt.id === foreignAttemptId),
      ).toBeUndefined();
      expect(filteredTotal).toBe(filtered.length);
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
      await db
        .delete(schema.organizations)
        .where(eq(schema.organizations.id, foreignOrgId));
    }
  });

  it("filters keep list/count agreement: examId, examIds non-empty, examIds empty zero-contract, pagination total", async () => {
    const repo = createAttemptGradingEntryRepo(db);
    // Healthy rows across both exams: one attempt on exam A (the shared
    // healthy attempt) and one on exam B.
    const examBEnrollmentId = await insertEnrollment(db, {
      organizationId: orgId,
      examId: examBId,
      candidateId: callerProfileId,
    });
    const examBAttemptId = await insertAttempt(db, {
      organizationId: orgId,
      examId: examBId,
      enrollmentId: examBEnrollmentId,
      candidateId: callerProfileId,
    });
    const controlA = await insertControlEntry("q-filter-a");
    const entryB = await insertPendingEntry(db, {
      organizationId: orgId,
      attemptId: examBAttemptId,
      questionId: "q-filter-b",
    });
    try {
      // No filter: two attempts, total agrees with the unpaginated list.
      const all = await repo.listPendingManualQueue(ctx, {});
      const total = await repo.countPendingManualQueue(ctx, {});
      expect(all).toHaveLength(2);
      expect(total).toBe(all.length);

      // examId filter: one row per exam, both methods agree.
      const onlyA = await repo.listPendingManualQueue(ctx, { examId: examAId });
      const onlyACount = await repo.countPendingManualQueue(ctx, {
        examId: examAId,
      });
      expect(onlyA).toHaveLength(1);
      expect(onlyA[0]!.attempt.id).toBe(healthyAttemptId);
      expect(onlyACount).toBe(onlyA.length);

      // examIds scope filter: non-empty scope selects, empty scope is the
      // zero-rows contract for BOTH methods (route: grader assigned to
      // nothing sees zero rows + zero total).
      const scoped = await repo.listPendingManualQueue(ctx, {
        examIds: [examBId],
      });
      const scopedCount = await repo.countPendingManualQueue(ctx, {
        examIds: [examBId],
      });
      expect(scoped).toHaveLength(1);
      expect(scoped[0]!.attempt.id).toBe(examBAttemptId);
      expect(scopedCount).toBe(scoped.length);

      const emptyScope = await repo.listPendingManualQueue(ctx, {
        examIds: [],
      });
      const emptyScopeCount = await repo.countPendingManualQueue(ctx, {
        examIds: [],
      });
      expect(emptyScope).toHaveLength(0);
      expect(emptyScopeCount).toBe(0);

      // Pagination shape (route usage): a page window never changes total.
      const page = await repo.listPendingManualQueue(ctx, {
        limit: 1,
        offset: 0,
      });
      const pageTotal = await repo.countPendingManualQueue(ctx, {});
      expect(page).toHaveLength(1);
      expect(pageTotal).toBe(all.length);
    } finally {
      await db
        .delete(schema.attemptGradingEntries)
        .where(eq(schema.attemptGradingEntries.id, entryB));
      await db
        .delete(schema.attemptGradingEntries)
        .where(eq(schema.attemptGradingEntries.id, controlA));
      await db
        .delete(schema.examAttempts)
        .where(eq(schema.examAttempts.id, examBAttemptId));
      await db
        .delete(schema.examEnrollments)
        .where(eq(schema.examEnrollments.id, examBEnrollmentId));
    }
  });
});
