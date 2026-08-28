import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { schema } from "@exam/db/src/schema/pg.js";
import { createAttemptRepo } from "@exam/db/src/repository/attemptRepo.js";
import { createExamRepo } from "@exam/db/src/repository/examRepo.js";
import type { TestContext } from "./testHelpers.js";
import {
  buildTestApp,
  createAssignedUserForTest,
  uniquePrefix,
} from "./testHelpers.js";
import examRoutes from "./exam.js";
import attemptRoutes from "./attempts.js";
import scoreRoutes from "./scores.js";

/**
 * P2D-J5a — Result Publishing Policy integration tests.
 *
 * Each test forces a resultPublicationMode through the create-exam API and
 * then exercises the score-route visibility rule. attempt.gradingStatus is
 * forced directly via repo.update() because P2D-J3's submit-time hook is not
 * merged yet; the gate accepts both 'auto_graded' and 'fully_graded' as
 * "grading done" so the Phase 1 happy path keeps working.
 */
describe("P2D-J5a: result publishing policy", () => {
  let ctx: TestContext;
  let courseId: string;
  let questionId: string;
  let candidateProfileId: string;

  beforeAll(async () => {
    ctx = await buildTestApp(async (fastify) => {
      await fastify.register(examRoutes, { prefix: "" });
      await fastify.register(attemptRoutes, { prefix: "" });
      await fastify.register(scoreRoutes, { prefix: "" });
    });
    courseId = crypto.randomUUID();
    questionId = crypto.randomUUID();
    candidateProfileId = crypto.randomUUID();
    await ctx.db.insert(schema.courses).values({
      id: courseId,
      organizationId: ctx.org.id,
      name: "Course",
      code: `J5A-${uniquePrefix()}`,
      description: "",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await ctx.db.insert(schema.questions).values({
      id: questionId,
      organizationId: ctx.org.id,
      courseId,
      type: "single_choice",
      content: "Choose A",
      options: [
        { id: "a", content: "A" },
        { id: "b", content: "B" },
      ],
      standardAnswer: "a",
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
    const existing = await ctx.db
      .select({ id: schema.candidateProfiles.id })
      .from(schema.candidateProfiles)
      .where(eq(schema.candidateProfiles.userId, ctx.candidate.id));
    if (existing[0]) {
      candidateProfileId = existing[0].id;
    } else {
      await ctx.db.insert(schema.candidateProfiles).values({
        id: candidateProfileId,
        organizationId: ctx.org.id,
        userId: ctx.candidate.id,
        fields: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  function adminCtx() {
    return {
      actorId: ctx.admin.id,
      organizationId: ctx.org.id,
      targetOrganizationId: ctx.org.id,
      role: "Admin" as const,
      permissions: [] as import("@exam/domain").Permission[],
      sessionId: "test",
    };
  }

  function candidateCtx() {
    return {
      actorId: ctx.candidate.id,
      organizationId: ctx.org.id,
      role: "Candidate" as const,
      permissions: [] as import("@exam/domain").Permission[],
      sessionId: "test",
    };
  }

  async function forceGradingStatus(
    attemptId: string,
    status: "auto_graded" | "pending_manual" | "fully_graded",
  ) {
    await createAttemptRepo(ctx.db).update(candidateCtx(), attemptId, {
      gradingStatus: status,
    });
  }

  /**
   * Creates + publishes an exam with the given publication mode, enrolls the
   * candidate, starts an attempt, answers correctly, and submits. Returns the
   * attemptId and examId. The attempt is graded by the auto-grader (gradingStatus
   * defaults to 'auto_graded' after submit).
   */
  async function createGradedAttemptForMode(
    resultPublicationMode: "immediate" | "after_grading" | "manual",
  ): Promise<{ attemptId: string; examId: string }> {
    const createResponse = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: {
        title: `J5a-${resultPublicationMode}`,
        description: "",
        courseId,
        timingMode: "timed_window",
        durationMinutes: 60,
        openAt: new Date(Date.now() - 3_600_000).toISOString(),
        closeAt: new Date(Date.now() + 86_400_000).toISOString(),
        passingScore: 6,
        totalScore: 10,
        questionSelectionMode: "manual",
        questionIds: [questionId],
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
        resultPublicationMode,
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    const examId = createResponse.json().id as string;
    await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/publish`,
      cookies: { "auth-token": ctx.adminToken },
    });
    await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/enrollments`,
      payload: { candidateIds: [candidateProfileId] },
      cookies: { "auth-token": ctx.adminToken },
    });
    const startResponse = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${examId}/start`,
      cookies: { "auth-token": ctx.candidateToken },
    });
    const attemptId = startResponse.json().id as string;
    await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${attemptId}/answers/${questionId}`,
      payload: {
        attemptId,
        questionId,
        answer: "a",
        clientSeq: 1,
        clientSavedAt: new Date().toISOString(),
        baseVersion: 0,
      },
      cookies: { "auth-token": ctx.candidateToken },
    });
    await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${attemptId}/submit`,
      cookies: { "auth-token": ctx.candidateToken },
    });
    return { attemptId, examId };
  }

  async function fetchCandidateResult(attemptId: string) {
    return ctx.app.inject({
      method: "GET",
      url: `/api/scores/attempts/${attemptId}`,
      cookies: { "auth-token": ctx.candidateToken },
    });
  }

  // ── Slice 1 ───────────────────────────────────────────────────────
  it("J5a-1: mode=immediate + auto_graded attempt → candidate sees full result", async () => {
    const { attemptId, examId } = await createGradedAttemptForMode("immediate");
    // Default gradingStatus after auto-grading is 'auto_graded'.

    // The mode must be persisted on the exam row (proves the field exists
    // end-to-end through create → schema).
    const stored = (await createExamRepo(ctx.db).findById(
      adminCtx(),
      examId,
    )) as { resultPublicationMode?: string } | null;
    expect(stored?.resultPublicationMode).toBe("immediate");

    const response = await fetchCandidateResult(attemptId);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: "graded",
      showResultImmediately: true,
      totalScore: 10,
      passed: true,
    });
    expect(response.json().questionResults).toHaveLength(1);
  });

  // ── Slice 2 ───────────────────────────────────────────────────────
  it("J5a-2: mode=manual + resultsPublishedAt=null → hidden, hiddenReason='pending_publish'", async () => {
    const { attemptId, examId } = await createGradedAttemptForMode("manual");

    // Sanity: manual mode persisted, no publish yet.
    const stored = (await createExamRepo(ctx.db).findById(
      adminCtx(),
      examId,
    )) as {
      resultPublicationMode?: string;
      resultsPublishedAt?: Date | null;
    } | null;
    expect(stored?.resultPublicationMode).toBe("manual");
    expect(stored?.resultsPublishedAt).toBeNull();

    const response = await fetchCandidateResult(attemptId);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      attemptId,
      status: "graded",
      showResultImmediately: false,
      hiddenReason: "pending_publish",
      examTitle: `J5a-manual`,
    });
  });

  // ── Slice 3 ───────────────────────────────────────────────────────
  it("J5a-3: mode=manual → POST /exams/:id/publish-results → candidate sees full result", async () => {
    const { attemptId, examId } = await createGradedAttemptForMode("manual");

    // Before publish: hidden.
    const before = await fetchCandidateResult(attemptId);
    expect(before.json().showResultImmediately).toBe(false);

    const publishResponse = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/publish-results`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(publishResponse.statusCode).toBe(200);
    expect(publishResponse.json()).toMatchObject({ ok: true });
    expect(publishResponse.json().resultsPublishedAt).toBeTruthy();

    // After publish: full result visible to candidate.
    const after = await fetchCandidateResult(attemptId);
    expect(after.statusCode).toBe(200);
    expect(after.json()).toMatchObject({
      status: "graded",
      showResultImmediately: true,
      totalScore: 10,
      passed: true,
    });
    expect(after.json().questionResults).toHaveLength(1);
  });

  // ── Slice 4 ───────────────────────────────────────────────────────
  it("J5a-4: publish-results idempotent — second call returns alreadyPublished=true, timestamp unchanged", async () => {
    const { examId } = await createGradedAttemptForMode("manual");

    const first = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/publish-results`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().alreadyPublished).toBe(false);
    const firstTs = first.json().resultsPublishedAt;

    const second = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/publish-results`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().alreadyPublished).toBe(true);
    expect(second.json().resultsPublishedAt).toBe(firstTs);

    const transitionAudits = await ctx.db
      .select({ id: schema.auditLogs.id })
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.action, "exam.publish_results"),
          eq(schema.auditLogs.targetId, examId),
        ),
      );
    expect(transitionAudits).toHaveLength(1);
  });

  // ── Slice 5 ───────────────────────────────────────────────────────
  it("J5a-5: publish-results rejects draft exam → 409 EXAM_PUBLISH_RESULTS_NOT_ALLOWED", async () => {
    // Create an exam but do NOT publish it — it stays in draft.
    const createResponse = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: {
        title: "J5a-draft",
        description: "",
        courseId,
        timingMode: "timed_window",
        durationMinutes: 60,
        openAt: new Date(Date.now() - 3_600_000).toISOString(),
        closeAt: new Date(Date.now() + 86_400_000).toISOString(),
        passingScore: 6,
        totalScore: 10,
        questionSelectionMode: "manual",
        questionIds: [questionId],
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
        resultPublicationMode: "manual",
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    const examId = createResponse.json().id as string;

    const response = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/publish-results`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("EXAM_PUBLISH_RESULTS_NOT_ALLOWED");
  });

  // ── Slice 6 ───────────────────────────────────────────────────────
  it("J5a-6: publish-results rejects canceled/archived exams → 409", async () => {
    const { examId } = await createGradedAttemptForMode("manual");
    // Move the exam to closed, then archive it.
    await createExamRepo(ctx.db).update(adminCtx(), examId, {
      status: "closed",
    });
    await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/archive`,
      cookies: { "auth-token": ctx.adminToken },
    });

    const response = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/publish-results`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("EXAM_PUBLISH_RESULTS_NOT_ALLOWED");
  });

  // ── Slice 7 ───────────────────────────────────────────────────────
  it("J5a-7: non-admin (candidate) publish-results → 403", async () => {
    const { examId } = await createGradedAttemptForMode("manual");
    const response = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/publish-results`,
      cookies: { "auth-token": ctx.candidateToken },
    });
    expect(response.statusCode).toBe(403);
  });

  // ── Slice 8 ───────────────────────────────────────────────────────
  it("J5a-8: mode=after_grading + gradingStatus=pending_manual → hidden, hiddenReason='not_graded'", async () => {
    const { attemptId } = await createGradedAttemptForMode("after_grading");
    // Force the attempt into pending_manual (J3's submit hook is not merged;
    // the visibility gate must treat pending_manual as not-ready regardless).
    await forceGradingStatus(attemptId, "pending_manual");

    const response = await fetchCandidateResult(attemptId);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      attemptId,
      status: "graded",
      showResultImmediately: false,
      hiddenReason: "not_graded",
      examTitle: "J5a-after_grading",
    });
  });

  // ── Slice 9 ───────────────────────────────────────────────────────
  it("J5a-9: mode=after_grading + gradingStatus=fully_graded → full result visible", async () => {
    const { attemptId } = await createGradedAttemptForMode("after_grading");
    // after_grading demands fully_graded; auto_graded (the default after
    // submit) is insufficient, so force fully_graded.
    await forceGradingStatus(attemptId, "fully_graded");

    const response = await fetchCandidateResult(attemptId);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: "graded",
      showResultImmediately: true,
      totalScore: 10,
      passed: true,
    });
  });

  // ── Slice 10 ──────────────────────────────────────────────────────
  it("J5a-10: mode=manual + resultsPublishedAt != null + gradingStatus=pending_manual → STILL hidden 'not_graded'", async () => {
    const { attemptId, examId } = await createGradedAttemptForMode("manual");
    await forceGradingStatus(attemptId, "pending_manual");
    // Admin publishes results.
    await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/publish-results`,
      cookies: { "auth-token": ctx.adminToken },
    });

    // Even though results are "published", grading is still pending → hidden.
    const response = await fetchCandidateResult(attemptId);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      attemptId,
      status: "graded",
      showResultImmediately: false,
      hiddenReason: "not_graded",
      examTitle: "J5a-manual",
    });
  });

  // ── Slice 11 ──────────────────────────────────────────────────────
  it("J5a-11: mode=immediate + gradingStatus=pending_manual → hidden 'not_graded'", async () => {
    const { attemptId } = await createGradedAttemptForMode("immediate");
    await forceGradingStatus(attemptId, "pending_manual");

    const response = await fetchCandidateResult(attemptId);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      attemptId,
      status: "graded",
      showResultImmediately: false,
      hiddenReason: "not_graded",
      examTitle: "J5a-immediate",
    });
  });

  // ── Slice 12 ──────────────────────────────────────────────────────
  it("J5a-12: migration backfill — legacy showResultImmediately=false coerces to manual mode", async () => {
    // Create an exam via the API sending ONLY the legacy flag (no
    // resultPublicationMode). The API boundary must coerce false → manual.
    const createResponse = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: {
        title: "J5a-legacy-false",
        description: "",
        courseId,
        timingMode: "timed_window",
        durationMinutes: 60,
        openAt: new Date(Date.now() - 3_600_000).toISOString(),
        closeAt: new Date(Date.now() + 86_400_000).toISOString(),
        passingScore: 6,
        totalScore: 10,
        questionSelectionMode: "manual",
        questionIds: [questionId],
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
          showResultImmediately: false,
        },
        retakePolicy: "unlimited",
        scoreStrategy: "highest",
        maxAttempts: 3,
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    const examId = createResponse.json().id as string;
    const stored = (await createExamRepo(ctx.db).findById(
      adminCtx(),
      examId,
    )) as { resultPublicationMode?: string } | null;
    expect(stored?.resultPublicationMode).toBe("manual");
  });

  // ── Slice 13 ──────────────────────────────────────────────────────
  it("J5a-13: admin sees full result regardless of mode (even manual + unpublished)", async () => {
    const { attemptId } = await createGradedAttemptForMode("manual");
    // No publish-results call; candidate would see hidden.
    const response = await ctx.app.inject({
      method: "GET",
      url: `/api/scores/attempts/${attemptId}`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: "graded",
      showResultImmediately: true,
      totalScore: 10,
      passed: true,
    });
    expect(response.json().questionResults).toHaveLength(1);
  });
});

/**
 * M8 — Teacher publish-results API proof.
 *
 * Proves the final P4 assignment-backed Teacher authority for
 * POST /exams/:id/publish-results. The Teacher is created via
 * createAssignedUserForTest (writes the users row + the primary active Teacher
 * assignment), so runtime authority resolves from active assignments — NOT from
 * a legacy JWT role string alone. The Teacher preset grants ExamResultPublish,
 * so the flat requireCapability(Permission.ExamResultPublish) gate on the route
 * allows publication of any same-org exam. Resource-scoped Teacher authorization
 * (T2, P3-R0 audit note T2) is deferred and deliberately not asserted here.
 */
describe("M8: Teacher publish-results capability", () => {
  let ctx: TestContext;
  let courseId: string;
  let questionId: string;
  let candidateProfileId: string;
  let teacherToken: string;

  beforeAll(async () => {
    ctx = await buildTestApp(async (fastify) => {
      await fastify.register(examRoutes, { prefix: "" });
      await fastify.register(attemptRoutes, { prefix: "" });
      await fastify.register(scoreRoutes, { prefix: "" });
    });
    courseId = crypto.randomUUID();
    questionId = crypto.randomUUID();
    candidateProfileId = crypto.randomUUID();
    await ctx.db.insert(schema.courses).values({
      id: courseId,
      organizationId: ctx.org.id,
      name: "Course",
      code: `M8-${uniquePrefix()}`,
      description: "",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await ctx.db.insert(schema.questions).values({
      id: questionId,
      organizationId: ctx.org.id,
      courseId,
      type: "single_choice",
      content: "Choose A",
      options: [
        { id: "a", content: "A" },
        { id: "b", content: "B" },
      ],
      standardAnswer: "a",
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
    const existing = await ctx.db
      .select({ id: schema.candidateProfiles.id })
      .from(schema.candidateProfiles)
      .where(eq(schema.candidateProfiles.userId, ctx.candidate.id));
    if (existing[0]) {
      candidateProfileId = existing[0].id;
    } else {
      await ctx.db.insert(schema.candidateProfiles).values({
        id: candidateProfileId,
        organizationId: ctx.org.id,
        userId: ctx.candidate.id,
        fields: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }
    // Teacher via assignment-backed authority (capability-driven, not role-name).
    const teacher = await createAssignedUserForTest(
      ctx.db,
      ctx.org.id,
      "Teacher",
      "m8-teacher",
    );
    teacherToken = teacher.token;
    // Issue #286: the Teacher publish-results gate requires an ACTIVE
    // teacher_course_assignments episode for the exam's course.
    const teacherNow = new Date();
    await ctx.db.insert(schema.teacherCourseAssignments).values({
      id: crypto.randomUUID(),
      organizationId: ctx.org.id,
      teacherUserId: teacher.user.id,
      courseId,
      status: "active",
      assignedBy: ctx.admin.id,
      assignedAt: teacherNow,
      revokedBy: null,
      revokedAt: null,
      createdAt: teacherNow,
      updatedAt: teacherNow,
    });
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  async function createPublishedManualExam(): Promise<string> {
    const createResponse = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: {
        title: `M8-manual-${uniquePrefix()}`,
        description: "",
        courseId,
        timingMode: "timed_window",
        durationMinutes: 60,
        openAt: new Date(Date.now() - 3_600_000).toISOString(),
        closeAt: new Date(Date.now() + 86_400_000).toISOString(),
        passingScore: 6,
        totalScore: 10,
        questionSelectionMode: "manual",
        questionIds: [questionId],
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
        resultPublicationMode: "manual",
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    const examId = createResponse.json().id as string;
    // Publish the exam (lifecycle) so results publication is allowed.
    await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/publish`,
      cookies: { "auth-token": ctx.adminToken },
    });
    return examId;
  }

  it("Teacher publish-results: first call publishes, repeat call is idempotent (one audit)", async () => {
    const examId = await createPublishedManualExam();

    // Sanity: unpublished manual-mode exam.
    const stored = (await createExamRepo(ctx.db).findById(
      {
        actorId: ctx.admin.id,
        organizationId: ctx.org.id,
        targetOrganizationId: ctx.org.id,
        role: "Admin" as const,
        permissions: [] as import("@exam/domain").Permission[],
        sessionId: "test",
      },
      examId,
    )) as { resultsPublishedAt?: Date | null } | null;
    expect(stored?.resultsPublishedAt).toBeNull();

    // ── Teacher first publish ─────────────────────────────────────────────
    const first = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/publish-results`,
      cookies: { "auth-token": teacherToken },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().alreadyPublished).toBe(false);
    expect(first.json().resultsPublishedAt).toBeTruthy();

    // Exam lifecycle status is unchanged (publication is NOT a status transition).
    const afterFirst = (await createExamRepo(ctx.db).findById(
      {
        actorId: ctx.admin.id,
        organizationId: ctx.org.id,
        targetOrganizationId: ctx.org.id,
        role: "Admin" as const,
        permissions: [] as import("@exam/domain").Permission[],
        sessionId: "test",
      },
      examId,
    )) as { status?: string; resultsPublishedAt?: Date | null } | null;
    expect(afterFirst?.status).toBe("published");
    expect(afterFirst?.resultsPublishedAt).toBeTruthy();

    // ── Teacher repeat publish (idempotent) ──────────────────────────────
    const second = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/publish-results`,
      cookies: { "auth-token": teacherToken },
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().alreadyPublished).toBe(true);
    expect(second.json().resultsPublishedAt).toBe(
      first.json().resultsPublishedAt,
    );

    // Exactly one exam.publish_results audit row exists.
    const transitionAudits = await ctx.db
      .select({ id: schema.auditLogs.id })
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.action, "exam.publish_results"),
          eq(schema.auditLogs.targetId, examId),
        ),
      );
    expect(transitionAudits).toHaveLength(1);
  });

  /**
   * M13 — Concurrent publication idempotency.
   *
   * Proves that two authorized publish-requests launched concurrently in the
   * same event-loop turn produce exactly one committed publication event: one
   * authoritative persisted timestamp and exactly one exam.publish_results audit
   * row. The invariant is "one committed publication event, one committed
   * publication audit" — NOT a specific internal PostgreSQL retry count. The
   * test starts two real concurrent app.inject() calls via Promise.all and
   * asserts the externally committed business result.
   */
  it("concurrent publish: two concurrent requests produce one committed publication", async () => {
    const examId = await createPublishedManualExam();

    // Sanity: unpublished manual-mode exam.
    const stored = (await createExamRepo(ctx.db).findById(
      {
        actorId: ctx.admin.id,
        organizationId: ctx.org.id,
        targetOrganizationId: ctx.org.id,
        role: "Admin" as const,
        permissions: [] as import("@exam/domain").Permission[],
        sessionId: "test",
      },
      examId,
    )) as { resultsPublishedAt?: Date | null } | null;
    expect(stored?.resultsPublishedAt).toBeNull();

    // Two independently authenticated actors: Admin + Teacher.
    // Launch BOTH requests concurrently in the same event-loop turn.
    const [responseA, responseB] = await Promise.all([
      ctx.app.inject({
        method: "POST",
        url: `/api/exams/${examId}/publish-results`,
        cookies: { "auth-token": ctx.adminToken },
      }),
      ctx.app.inject({
        method: "POST",
        url: `/api/exams/${examId}/publish-results`,
        cookies: { "auth-token": teacherToken },
      }),
    ]);

    // Both requests conform to the documented idempotent route behavior.
    expect(responseA.statusCode).toBe(200);
    expect(responseB.statusCode).toBe(200);
    const bodyA = responseA.json();
    const bodyB = responseB.json();
    expect(bodyA.ok).toBe(true);
    expect(bodyB.ok).toBe(true);

    // Stable under the current implementation: exactly one "winner"
    // (alreadyPublished=false) and exactly one "observer" (alreadyPublished=true).
    const alreadyPublishedFlags = [
      bodyA.alreadyPublished,
      bodyB.alreadyPublished,
    ].sort();
    expect(alreadyPublishedFlags).toEqual([false, true]);

    // The timestamps observed by both callers are identical (one committed event).
    expect(bodyA.resultsPublishedAt).toBe(bodyB.resultsPublishedAt);
    expect(bodyA.resultsPublishedAt).toBeTruthy();

    // ── Mandatory persisted invariants ────────────────────────────────────
    // Final exams.resultsPublishedAt is non-null (one authoritative timestamp).
    const finalExam = (await createExamRepo(ctx.db).findById(
      {
        actorId: ctx.admin.id,
        organizationId: ctx.org.id,
        targetOrganizationId: ctx.org.id,
        role: "Admin" as const,
        permissions: [] as import("@exam/domain").Permission[],
        sessionId: "test",
      },
      examId,
    )) as { resultsPublishedAt?: Date | null } | null;
    expect(finalExam?.resultsPublishedAt).toBeTruthy();

    // Exactly one exam.publish_results audit row exists (no double audit).
    const transitionAudits = await ctx.db
      .select({ id: schema.auditLogs.id })
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.action, "exam.publish_results"),
          eq(schema.auditLogs.targetId, examId),
        ),
      );
    expect(transitionAudits).toHaveLength(1);
  });
});
