import { describe, expect, it, beforeAll, afterAll } from "vitest";
import examRoutes from "./exam.js";
import courseRoutes from "./course.js";
import questionRoutes from "./question.js";
import candidateRoutes from "./candidate.js";
import attemptRoutes from "./attempts.js";
import scoreRoutes from "./scores.js";
import { exportRoutes } from "./export.js";
import auditRoutes from "./audit.js";
import {
  buildTestApp,
  uniquePrefix,
  createCandidateViaApi,
  submitExamAsCandidate,
} from "./testHelpers.js";

describe("exam routes", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;
  let courseId: string;
  let questionId: string;

  beforeAll(async () => {
    ctx = await buildTestApp(async (fastify) => {
      await fastify.register(courseRoutes);
      await fastify.register(questionRoutes);
      await fastify.register(examRoutes);
    });

    const courseRes = await ctx.app.inject({
      method: "POST",
      url: "/api/courses",
      payload: {
        name: "Exam Course",
        code: `EC-${uniquePrefix()}`,
        description: "",
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    courseId = courseRes.json().id;

    const qRes = await ctx.app.inject({
      method: "POST",
      url: "/api/questions",
      payload: {
        courseId,
        type: "true_false",
        content: "Test question.",
        standardAnswer: true,
        score: 100,
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    questionId = qRes.json().id;
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it("POST /api/exams creates a draft exam", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: {
        title: "Test Exam",
        courseId,
        durationMinutes: 60,
        openAt: new Date().toISOString(),
        closeAt: new Date(Date.now() + 86400000).toISOString(),
        passingScore: 60,
        totalScore: 100,
        questionIds: [questionId],
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.title).toBe("Test Exam");
    expect(body.status).toBe("draft");
    expect(body).toHaveProperty("id");
  });

  it("GET /api/exams returns list", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/exams",
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty("items");
    expect(body.items.length).toBeGreaterThanOrEqual(1);
    expect(body.items[0]).toHaveProperty("canDelete");
    expect(body.items[0]).toHaveProperty("canViewScores");
  });

  it("GET /api/exams/:id returns exam detail", async () => {
    const createRes = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: {
        title: "Detail Exam",
        courseId,
        durationMinutes: 30,
        openAt: new Date().toISOString(),
        closeAt: new Date(Date.now() + 86400000).toISOString(),
        passingScore: 50,
        totalScore: 100,
        questionIds: [questionId],
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    const created = createRes.json();

    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/exams/${created.id}`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().title).toBe("Detail Exam");
  });

  it("PATCH /api/exams/:id updates a draft exam", async () => {
    const createRes = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: {
        title: "Update Exam",
        courseId,
        durationMinutes: 30,
        openAt: new Date().toISOString(),
        closeAt: new Date(Date.now() + 86400000).toISOString(),
        passingScore: 50,
        totalScore: 100,
        questionIds: [questionId],
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    const created = createRes.json();

    const res = await ctx.app.inject({
      method: "PATCH",
      url: `/api/exams/${created.id}`,
      payload: { title: "Updated Title" },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().title).toBe("Updated Title");
  });

  it("POST /api/exams/:id/publish publishes a draft", async () => {
    const createRes = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: {
        title: "Publish Exam",
        courseId,
        durationMinutes: 60,
        openAt: new Date().toISOString(),
        closeAt: new Date(Date.now() + 86400000).toISOString(),
        passingScore: 60,
        totalScore: 100,
        questionIds: [questionId],
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    const created = createRes.json();

    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${created.id}/publish`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("published");
  });

  it("POST /api/exams/:id/publish rejects already published", async () => {
    const createRes = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: {
        title: "Already Published",
        courseId,
        durationMinutes: 60,
        openAt: new Date().toISOString(),
        closeAt: new Date(Date.now() + 86400000).toISOString(),
        passingScore: 60,
        totalScore: 100,
        questionIds: [questionId],
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    const created = createRes.json();

    await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${created.id}/publish`,
      cookies: { "auth-token": ctx.adminToken },
    });

    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${created.id}/publish`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.error.code).toBe("EXAM_ALREADY_PUBLISHED");
    expect(body.error.requestId).toBeDefined();
  });

  it("DELETE /api/exams/:id deletes draft exam", async () => {
    const createRes = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: {
        title: "Delete Exam",
        courseId,
        durationMinutes: 30,
        openAt: new Date().toISOString(),
        closeAt: new Date(Date.now() + 86400000).toISOString(),
        passingScore: 50,
        totalScore: 100,
        questionIds: [questionId],
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    const created = createRes.json();

    const res = await ctx.app.inject({
      method: "DELETE",
      url: `/api/exams/${created.id}`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(204);
  });

  it("DELETE /api/exams/:id rejects non-draft", async () => {
    const createRes = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: {
        title: "No Delete",
        courseId,
        durationMinutes: 60,
        openAt: new Date().toISOString(),
        closeAt: new Date(Date.now() + 86400000).toISOString(),
        passingScore: 60,
        totalScore: 100,
        questionIds: [questionId],
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    const created = createRes.json();

    await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${created.id}/publish`,
      cookies: { "auth-token": ctx.adminToken },
    });

    const res = await ctx.app.inject({
      method: "DELETE",
      url: `/api/exams/${created.id}`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.error.code).toBe("EXAM_NOT_DRAFT");
    expect(body.error.requestId).toBeDefined();
  });

  it("POST /api/exams/:id/publish works without body", async () => {
    const createRes = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: {
        title: "No Body Publish",
        courseId,
        durationMinutes: 60,
        openAt: new Date().toISOString(),
        closeAt: new Date(Date.now() + 86400000).toISOString(),
        passingScore: 60,
        totalScore: 100,
        questionIds: [questionId],
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    const created = createRes.json();

    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${created.id}/publish`,
      headers: { "content-type": "application/json" },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("published");
  });

  it("GET /api/exams/:id returns 404 ErrorResponse v0 for missing exam", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/exams/00000000-0000-0000-0000-000000000000",
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.error.code).toBe("RESOURCE_NOT_FOUND");
    expect(body.error.requestId).toBeDefined();
  });

  it("POST /api/exams returns 404 ErrorResponse v0 for invalid courseId", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: {
        title: "Bad Course Exam",
        courseId: "00000000-0000-0000-0000-000000000000",
        durationMinutes: 60,
        openAt: new Date().toISOString(),
        closeAt: new Date(Date.now() + 86400000).toISOString(),
        passingScore: 60,
        totalScore: 100,
        questionIds: [],
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    // Issue #286: the scoped-capability gate resolves the parent course
    // BEFORE the handler, so a missing course is the canonical ADR §3.9
    // resource_not_found -> 404 (anti-enumeration), not the legacy 400.
    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.error.code).toBe("RESOURCE_NOT_FOUND");
    expect(body.error.requestId).toBeDefined();
  });

  it("POST /api/exams emits machine field semantics for a cross-course question (C2 T8)", async () => {
    const otherCourseRes = await ctx.app.inject({
      method: "POST",
      url: "/api/courses",
      payload: {
        name: "Other Course",
        code: `EC-OTHER-${uniquePrefix()}`,
        description: "",
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    const otherCourseId = otherCourseRes.json().id;
    const foreignRes = await ctx.app.inject({
      method: "POST",
      url: "/api/questions",
      payload: {
        courseId: otherCourseId,
        type: "true_false",
        content: "Foreign question.",
        standardAnswer: true,
        score: 100,
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    const foreignQuestionId = foreignRes.json().id;

    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: {
        title: "Mismatched Question Exam",
        courseId,
        durationMinutes: 60,
        openAt: new Date().toISOString(),
        closeAt: new Date(Date.now() + 86400000).toISOString(),
        passingScore: 60,
        totalScore: 100,
        questionIds: [foreignQuestionId],
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.details.fields).toEqual([
      expect.objectContaining({
        field: "questionIds",
        code: "QUESTION_COURSE_MISMATCH",
      }),
    ]);
    // T6: the compatibility message remains required on the wire.
    expect(body.error.details.fields[0].message.length).toBeGreaterThan(0);
  });

  it("POST /api/exams emits machine field semantics for an unknown profile (C2 T8)", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: {
        title: "Unknown Profile Exam",
        courseId,
        durationMinutes: 60,
        openAt: new Date().toISOString(),
        closeAt: new Date(Date.now() + 86400000).toISOString(),
        passingScore: 60,
        totalScore: 100,
        questionIds: [],
        profileId: "00000000-0000-0000-0000-0000000000aa",
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error.details.fields).toEqual([
      expect.objectContaining({
        field: "profileId",
        code: "RESOURCE_NOT_FOUND",
        // Machine params per message contract D0.4/D0.7: which referenced
        // entity is missing is structural, not compatibility prose.
        params: { resource: "examProfile" },
      }),
    ]);
    expect(body.error.details.fields[0].message.length).toBeGreaterThan(0);
  });

  it("PATCH /api/exams/:id returns 409 EXAM_UPDATE_NOT_ALLOWED for published exam non-schedule field", async () => {
    const createRes = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: {
        title: "Patch Published",
        courseId,
        durationMinutes: 60,
        openAt: new Date().toISOString(),
        closeAt: new Date(Date.now() + 86400000).toISOString(),
        passingScore: 60,
        totalScore: 100,
        questionIds: [questionId],
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    const created = createRes.json();

    await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${created.id}/publish`,
      cookies: { "auth-token": ctx.adminToken },
    });

    const res = await ctx.app.inject({
      method: "PATCH",
      url: `/api/exams/${created.id}`,
      payload: { title: "Should Fail" },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.error.code).toBe("EXAM_UPDATE_NOT_ALLOWED");
    expect(body.error.requestId).toBeDefined();
  });

  it("GET /api/exams returns 401 ErrorResponse v0 without auth", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/exams",
    });
    expect(res.statusCode).toBe(401);
    const body = res.json();
    expect(body.error.code).toBe("AUTH_REQUIRED");
    expect(body.error.requestId).toBeDefined();
  });
});

// ADR-005 Slice 1 — POST /api/exams/:id/close
//
// Covers: success (open->closed), idempotent (closed->closed, no dup audit),
// reject non-open states, reject when unresolved attempts remain, RBAC, audit.
describe("exam close (ADR-005 Slice 1)", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;
  let courseId: string;
  let questionId: string;

  beforeAll(async () => {
    ctx = await buildTestApp(async (fastify) => {
      await fastify.register(courseRoutes);
      await fastify.register(questionRoutes);
      await fastify.register(candidateRoutes);
      await fastify.register(examRoutes);
      await fastify.register(attemptRoutes);
    });

    const courseRes = await ctx.app.inject({
      method: "POST",
      url: "/api/courses",
      payload: {
        name: "Close Course",
        code: `CC-${uniquePrefix()}`,
        description: "",
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    courseId = courseRes.json().id;

    const qRes = await ctx.app.inject({
      method: "POST",
      url: "/api/questions",
      payload: {
        courseId,
        type: "true_false",
        content: "Close question.",
        standardAnswer: true,
        score: 100,
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    questionId = qRes.json().id;
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  /** Creates + publishes an exam that auto-opens (openAt = now). Returns id. */
  async function createOpenExam(title: string): Promise<string> {
    const createRes = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: {
        title,
        courseId,
        durationMinutes: 60,
        openAt: new Date(Date.now() - 60_000).toISOString(),
        closeAt: new Date(Date.now() + 86_400_000).toISOString(),
        passingScore: 60,
        totalScore: 100,
        questionIds: [questionId],
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    const examId = createRes.json().id;
    const pubRes = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/publish`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(pubRes.statusCode).toBe(200);
    // Note: the exam stays "published" until a reconcile fires. The close
    // route itself reconciles (lock->reconcile->...), so it advances
    // published->open->closed in one request. Candidate start also reconciles.
    return examId;
  }

  it("closes an open exam -> closed (200)", async () => {
    const examId = await createOpenExam("Close OK");
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/close`,
      payload: {},
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("closed");

    const listRes = await ctx.app.inject({
      method: "GET",
      url: "/api/exams",
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(listRes.statusCode).toBe(200);
    // C1-D: the blocked reason is dual-emitted — legacy compatibility text
    // plus the machine code (message contract D0.8).
    expect(listRes.json().items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: examId,
          canViewScores: false,
          scoreViewDisabledReason: "暂无成绩数据",
          scoreViewDisabledReasonCode: "NO_GRADED_ATTEMPTS",
          canDelete: false,
          deleteDisabledReason: "仅草稿状态的考试允许删除",
          deleteDisabledReasonCode: "EXAM_NOT_DRAFT",
        }),
      ]),
    );
  });

  it("dual-emits null disabled reason codes for a deletable draft (C1-D)", async () => {
    const createRes = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: {
        title: "Draft Codes Null",
        courseId,
        durationMinutes: 60,
        openAt: new Date(Date.now() - 60_000).toISOString(),
        closeAt: new Date(Date.now() + 86_400_000).toISOString(),
        passingScore: 60,
        totalScore: 100,
        questionIds: [questionId],
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    const examId = createRes.json().id;

    const listRes = await ctx.app.inject({
      method: "GET",
      url: "/api/exams",
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(listRes.statusCode).toBe(200);
    // A draft exam is not ended yet -> the not-finished scoreView branch.
    expect(listRes.json().items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: examId,
          canViewScores: false,
          scoreViewDisabledReason: "考试尚未结束，暂不能查看成绩",
          scoreViewDisabledReasonCode: "EXAM_NOT_FINISHED",
          canDelete: true,
          deleteDisabledReason: null,
          deleteDisabledReasonCode: null,
        }),
      ]),
    );
  });

  it("dual-emits EXAM_CANCELED after canceling an exam (C1-D)", async () => {
    const createRes = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: {
        title: "Cancel Codes",
        courseId,
        durationMinutes: 60,
        openAt: new Date(Date.now() - 60_000).toISOString(),
        closeAt: new Date(Date.now() + 86_400_000).toISOString(),
        passingScore: 60,
        totalScore: 100,
        questionIds: [questionId],
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    const examId = createRes.json().id;
    await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/publish`,
      cookies: { "auth-token": ctx.adminToken },
    });
    const cancelRes = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/cancel`,
      payload: {},
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(cancelRes.statusCode).toBe(200);

    const listRes = await ctx.app.inject({
      method: "GET",
      url: "/api/exams",
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(listRes.statusCode).toBe(200);
    expect(listRes.json().items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: examId,
          canViewScores: false,
          scoreViewDisabledReason: "已取消的考试不提供成绩",
          scoreViewDisabledReasonCode: "EXAM_CANCELED",
        }),
      ]),
    );
  });

  it("is idempotent: closing an already-closed exam returns 200", async () => {
    const examId = await createOpenExam("Close Idempotent");
    const first = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/close`,
      payload: {},
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(first.statusCode).toBe(200);
    const second = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/close`,
      payload: {},
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().status).toBe("closed");
  });

  it("rejects closing a draft exam -> 409 EXAM_CLOSE_NOT_ALLOWED", async () => {
    const createRes = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: {
        title: "Close Draft",
        courseId,
        durationMinutes: 60,
        openAt: new Date(Date.now() - 60_000).toISOString(),
        closeAt: new Date(Date.now() + 86_400_000).toISOString(),
        passingScore: 60,
        totalScore: 100,
        questionIds: [questionId],
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    const examId = createRes.json().id;
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/close`,
      payload: {},
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("EXAM_CLOSE_NOT_ALLOWED");
  });

  it("rejects closing a published (not-open) exam -> 409", async () => {
    // Future openAt so publish does NOT auto-open.
    const createRes = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: {
        title: "Close Published",
        courseId,
        durationMinutes: 60,
        openAt: new Date(Date.now() + 3600_000).toISOString(),
        closeAt: new Date(Date.now() + 86_400_000 + 3600_000).toISOString(),
        passingScore: 60,
        totalScore: 100,
        questionIds: [questionId],
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    const examId = createRes.json().id;
    const pubRes = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/publish`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(pubRes.statusCode).toBe(200);
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/close`,
      payload: {},
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("EXAM_CLOSE_NOT_ALLOWED");
  });

  it("rejects close when an unresolved attempt exists -> 409 UNRESOLVED_ATTEMPTS_EXIST", async () => {
    const examId = await createOpenExam("Close Unresolved");

    // Enroll + START (not submit) an attempt -> it stays in_progress.
    const candidate = await createCandidateViaApi(
      ctx.app,
      ctx.adminToken,
      `cand-close-unres-${uniquePrefix()}`,
      ctx.org.id,
    );
    const enrollRes = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/enrollments`,
      payload: { candidateIds: [candidate.candidateProfileId] },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(enrollRes.statusCode).toBe(200);
    const startRes = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${examId}/start`,
      cookies: { "auth-token": candidate.token },
    });
    expect(startRes.statusCode).toBe(201);

    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/close`,
      payload: {},
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.error.code).toBe("EXAM_CLOSE_NOT_ALLOWED");
    expect(body.error.details?.reason).toBe("UNRESOLVED_ATTEMPTS_EXIST");
    expect(body.error.details?.activeAttemptCount).toBeGreaterThanOrEqual(1);
  });

  it("closes after the candidate submits the attempt (no unresolved)", async () => {
    const examId = await createOpenExam("Close After Submit");
    // submitExamAsCandidate runs the grading engine synchronously on submit,
    // so the attempt reaches a finalized (`graded`) state. The exam is still
    // `open` (window not elapsed) — scores stay 409 — but close only needs
    // zero unresolved attempts, which is true once the attempt is graded.
    const submitted = await submitExamAsCandidate(
      ctx.app,
      ctx.adminToken,
      ctx.org.id,
      examId,
      `cand-close-after-${uniquePrefix()}`,
    );
    expect(submitted).toBeDefined();

    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/close`,
      payload: {},
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("closed");
  });

  it("requires Admin role: candidate token -> 403", async () => {
    const examId = await createOpenExam("Close RBAC");
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/close`,
      payload: {},
      cookies: { "auth-token": ctx.candidateToken },
    });
    expect(res.statusCode).toBe(403);
  });
});

// ADR-005 Slice 2 — unpublish / extend / PATCH-clarify
describe("exam unpublish / extend / PATCH-clarify (ADR-005 Slice 2)", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;
  let courseId: string;
  let questionId: string;

  beforeAll(async () => {
    ctx = await buildTestApp(async (fastify) => {
      await fastify.register(courseRoutes);
      await fastify.register(questionRoutes);
      await fastify.register(examRoutes);
    });

    const courseRes = await ctx.app.inject({
      method: "POST",
      url: "/api/courses",
      payload: {
        name: "Slice2 Course",
        code: `S2C-${uniquePrefix()}`,
        description: "",
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    courseId = courseRes.json().id;

    const qRes = await ctx.app.inject({
      method: "POST",
      url: "/api/questions",
      payload: {
        courseId,
        type: "true_false",
        content: "Slice2 question.",
        standardAnswer: true,
        score: 100,
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    questionId = qRes.json().id;
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  /** Creates + publishes an exam with a FUTURE openAt (stays `published`). */
  async function createPublishedExam(title: string): Promise<string> {
    const createRes = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: {
        title,
        courseId,
        durationMinutes: 60,
        openAt: new Date(Date.now() + 3600_000).toISOString(),
        closeAt: new Date(Date.now() + 86_400_000 + 3600_000).toISOString(),
        passingScore: 60,
        totalScore: 100,
        questionIds: [questionId],
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    const examId = createRes.json().id;
    const pubRes = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/publish`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(pubRes.statusCode).toBe(200);
    expect(pubRes.json().status).toBe("published");
    return examId;
  }

  /** Creates + publishes + touches to reconcile to `open` (openAt in past). */
  async function createOpenExam(title: string): Promise<string> {
    const createRes = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: {
        title,
        courseId,
        durationMinutes: 60,
        openAt: new Date(Date.now() - 60_000).toISOString(),
        closeAt: new Date(Date.now() + 86_400_000).toISOString(),
        passingScore: 60,
        totalScore: 100,
        questionIds: [questionId],
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    const examId = createRes.json().id;
    await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/publish`,
      cookies: { "auth-token": ctx.adminToken },
    });
    // Candidate-less: touch via GET won't reconcile. Use extend/close to
    // trigger reconcile instead — but simplest: rely on the op itself.
    return examId;
  }

  // ---- unpublish ----
  it("unpublishes a published exam -> draft (200)", async () => {
    const examId = await createPublishedExam("Unpublish OK");
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/unpublish`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("draft");
  });

  it("rejects unpublish of a draft exam -> 409 EXAM_UNPUBLISH_NOT_ALLOWED", async () => {
    const createRes = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: {
        title: "Unpublish Draft",
        courseId,
        durationMinutes: 60,
        openAt: new Date(Date.now() + 3600_000).toISOString(),
        closeAt: new Date(Date.now() + 86_400_000 + 3600_000).toISOString(),
        passingScore: 60,
        totalScore: 100,
        questionIds: [questionId],
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${createRes.json().id}/unpublish`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("EXAM_UNPUBLISH_NOT_ALLOWED");
  });

  it("rejects unpublish of a stale published (now open) exam -> 409", async () => {
    // published with past openAt: the route reconciles to open, then rejects.
    const examId = await createOpenExam("Unpublish Stale");
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/unpublish`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("EXAM_UNPUBLISH_NOT_ALLOWED");
  });

  // ---- extend ----
  it("extends an open exam's closeAt -> 200", async () => {
    const examId = await createOpenExam("Extend OK");
    const beforeRes = await ctx.app.inject({
      method: "GET",
      url: `/api/exams/${examId}`,
      cookies: { "auth-token": ctx.adminToken },
    });
    const beforeClose = beforeRes.json().closeAt;
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/extend`,
      payload: { extendMinutes: 15 },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);
    expect(new Date(res.json().closeAt).getTime()).toBeGreaterThan(
      new Date(beforeClose).getTime(),
    );
  });

  it("rejects extend of a published (not open) exam -> 409", async () => {
    const examId = await createPublishedExam("Extend Published");
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/extend`,
      payload: { extendMinutes: 15 },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("EXAM_EXTEND_NOT_ALLOWED");
  });

  it("rejects extend with non-positive extendMinutes -> 400", async () => {
    const examId = await createOpenExam("Extend Bad");
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/extend`,
      payload: { extendMinutes: -5 },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(400);
  });

  // ---- PATCH-clarify ----
  it("PATCH published allows schedule (openAt/closeAt) edit -> 200", async () => {
    const examId = await createPublishedExam("PATCH Schedule");
    const res = await ctx.app.inject({
      method: "PATCH",
      url: `/api/exams/${examId}`,
      payload: {
        closeAt: new Date(Date.now() + 172_800_000 + 3600_000).toISOString(),
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);
  });

  it("PATCH published rejects non-schedule field (title) -> 409 EXAM_UPDATE_NOT_ALLOWED", async () => {
    const examId = await createPublishedExam("PATCH Forbidden");
    const res = await ctx.app.inject({
      method: "PATCH",
      url: `/api/exams/${examId}`,
      payload: { title: "Changed Title" },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("EXAM_UPDATE_NOT_ALLOWED");
  });

  it("PATCH draft still allows full edit -> 200", async () => {
    const createRes = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: {
        title: "PATCH Draft",
        courseId,
        durationMinutes: 60,
        openAt: new Date(Date.now() + 3600_000).toISOString(),
        closeAt: new Date(Date.now() + 86_400_000 + 3600_000).toISOString(),
        passingScore: 60,
        totalScore: 100,
        questionIds: [questionId],
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    const res = await ctx.app.inject({
      method: "PATCH",
      url: `/api/exams/${createRes.json().id}`,
      payload: { title: "Renamed", passingScore: 70 },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);
  });

  // ADR-005 construction hard rule: PATCH must reconcile first, so a stale
  // `published` exam whose openAt already passed (logically `open`) is rejected
  // — it cannot be edited as if still published.
  it("PATCH rejects a stale published (now open) exam -> 409 EXAM_UPDATE_NOT_ALLOWED", async () => {
    const examId = await createOpenExam("PATCH Stale");
    const res = await ctx.app.inject({
      method: "PATCH",
      url: `/api/exams/${examId}`,
      payload: {
        closeAt: new Date(Date.now() + 172_800_000).toISOString(),
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("EXAM_UPDATE_NOT_ALLOWED");
  });

  it("PATCH draft with empty body returns 200 without mutation or audit", async () => {
    const createRes = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: {
        title: "Noop Draft",
        courseId,
        durationMinutes: 60,
        openAt: new Date(Date.now() + 3600_000).toISOString(),
        closeAt: new Date(Date.now() + 86_400_000 + 3600_000).toISOString(),
        passingScore: 60,
        totalScore: 100,
        questionIds: [questionId],
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    const created = createRes.json();
    const updatedAtBefore = created.updatedAt;

    const res = await ctx.app.inject({
      method: "PATCH",
      url: `/api/exams/${created.id}`,
      payload: {},
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().updatedAt).toBe(updatedAtBefore);
  });

  it("PATCH draft with same-value fields returns 200 without mutation or audit", async () => {
    const createRes = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: {
        title: "Noop Draft Fields",
        courseId,
        durationMinutes: 60,
        openAt: new Date(Date.now() + 3600_000).toISOString(),
        closeAt: new Date(Date.now() + 86_400_000 + 3600_000).toISOString(),
        passingScore: 60,
        totalScore: 100,
        questionIds: [questionId],
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    const created = createRes.json();
    const updatedAtBefore = created.updatedAt;

    const res = await ctx.app.inject({
      method: "PATCH",
      url: `/api/exams/${created.id}`,
      payload: {
        title: created.title,
        passingScore: created.passingScore,
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().updatedAt).toBe(updatedAtBefore);
  });

  it("PATCH published with same closeAt returns 200 without mutation or audit", async () => {
    const examId = await createPublishedExam("Noop Published");
    const getRes = await ctx.app.inject({
      method: "GET",
      url: `/api/exams/${examId}`,
      cookies: { "auth-token": ctx.adminToken },
    });
    const exam = getRes.json();
    const updatedAtBefore = exam.updatedAt;

    const res = await ctx.app.inject({
      method: "PATCH",
      url: `/api/exams/${examId}`,
      payload: { closeAt: exam.closeAt },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().updatedAt).toBe(updatedAtBefore);
  });

  it("PATCH published with empty body returns 200 without mutation or audit", async () => {
    const examId = await createPublishedExam("Noop Published Empty");
    const getRes = await ctx.app.inject({
      method: "GET",
      url: `/api/exams/${examId}`,
      cookies: { "auth-token": ctx.adminToken },
    });
    const updatedAtBefore = getRes.json().updatedAt;

    const res = await ctx.app.inject({
      method: "PATCH",
      url: `/api/exams/${examId}`,
      payload: {},
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().updatedAt).toBe(updatedAtBefore);
  });
});

// ADR-005 Slice 4 (cancel-minimal) — POST /api/exams/:id/cancel
describe("exam cancel (ADR-005 Slice 4)", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;
  let courseId: string;
  let questionId: string;

  beforeAll(async () => {
    ctx = await buildTestApp(async (fastify) => {
      await fastify.register(courseRoutes);
      await fastify.register(questionRoutes);
      await fastify.register(candidateRoutes);
      await fastify.register(examRoutes);
      await fastify.register(attemptRoutes);
      await fastify.register(scoreRoutes);
      await fastify.register(exportRoutes);
      await fastify.register(auditRoutes);
    });

    const courseRes = await ctx.app.inject({
      method: "POST",
      url: "/api/courses",
      payload: {
        name: "Cancel Course",
        code: `CC4-${uniquePrefix()}`,
        description: "",
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    courseId = courseRes.json().id;

    const qRes = await ctx.app.inject({
      method: "POST",
      url: "/api/questions",
      payload: {
        courseId,
        type: "true_false",
        content: "Cancel question.",
        standardAnswer: true,
        score: 100,
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    questionId = qRes.json().id;
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  /** Creates + publishes an exam with a FUTURE openAt (stays `published`). */
  async function createPublishedExam(title: string): Promise<string> {
    const createRes = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: {
        title,
        courseId,
        durationMinutes: 60,
        openAt: new Date(Date.now() + 3600_000).toISOString(),
        closeAt: new Date(Date.now() + 86_400_000 + 3600_000).toISOString(),
        passingScore: 60,
        totalScore: 100,
        questionIds: [questionId],
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    const examId = createRes.json().id;
    await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/publish`,
      cookies: { "auth-token": ctx.adminToken },
    });
    return examId;
  }

  it("cancels a published exam -> canceled (200)", async () => {
    const examId = await createPublishedExam("Cancel Pub");
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/cancel`,
      payload: { reason: "test" },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("canceled");
  });

  it("cancels an open exam with no active attempts -> canceled (200)", async () => {
    // Create exam with openAt in the past so it reconciles to open.
    const createRes = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: {
        title: "Cancel Open NoActive",
        courseId,
        durationMinutes: 60,
        openAt: new Date(Date.now() - 3600_000).toISOString(),
        closeAt: new Date(Date.now() + 86_400_000).toISOString(),
        passingScore: 60,
        totalScore: 100,
        questionIds: [questionId],
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    const examId = createRes.json().id;
    await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/publish`,
      cookies: { "auth-token": ctx.adminToken },
    });
    // No candidate started -> no active attempts.
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/cancel`,
      payload: {},
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("canceled");
  });

  it("rejects cancel of an open exam with an active attempt -> 409 UNRESOLVED_ATTEMPTS_EXIST", async () => {
    const createRes = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: {
        title: "Cancel Open Active",
        courseId,
        durationMinutes: 60,
        openAt: new Date(Date.now() - 60_000).toISOString(),
        closeAt: new Date(Date.now() + 86_400_000).toISOString(),
        passingScore: 60,
        totalScore: 100,
        questionIds: [questionId],
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    const examId = createRes.json().id;
    await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/publish`,
      cookies: { "auth-token": ctx.adminToken },
    });
    const candidate = await createCandidateViaApi(
      ctx.app,
      ctx.adminToken,
      `cand-cancel-active-${uniquePrefix()}`,
      ctx.org.id,
    );
    await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/enrollments`,
      payload: { candidateIds: [candidate.candidateProfileId] },
      cookies: { "auth-token": ctx.adminToken },
    });
    const startRes = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${examId}/start`,
      cookies: { "auth-token": candidate.token },
    });
    expect(startRes.statusCode).toBe(201);

    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/cancel`,
      payload: { reason: "try" },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.error.code).toBe("EXAM_CANCEL_NOT_ALLOWED");
    expect(body.error.details?.reason).toBe("UNRESOLVED_ATTEMPTS_EXIST");
    expect(body.error.details?.activeAttemptCount).toBeGreaterThanOrEqual(1);
  });

  it("rejects cancel of a draft exam -> 409 EXAM_CANCEL_NOT_ALLOWED (no UNRESOLVED reason)", async () => {
    const createRes = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: {
        title: "Cancel Draft",
        courseId,
        durationMinutes: 60,
        openAt: new Date(Date.now() + 3600_000).toISOString(),
        closeAt: new Date(Date.now() + 86_400_000 + 3600_000).toISOString(),
        passingScore: 60,
        totalScore: 100,
        questionIds: [questionId],
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${createRes.json().id}/cancel`,
      payload: {},
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("EXAM_CANCEL_NOT_ALLOWED");
    // Non-open rejection has no UNRESOLVED reason.
    expect(res.json().error.details?.reason).toBeUndefined();
  });

  it("scores of a canceled exam -> 409 EXAM_CANCELED_RESULTS_UNAVAILABLE", async () => {
    const examId = await createPublishedExam("Cancel Scores Reject");
    const cancelRes = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/cancel`,
      payload: {},
      cookies: { "auth-token": ctx.adminToken },
    });
    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/exams/${examId}/scores?page=1&passFilter=all`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("EXAM_CANCELED_RESULTS_UNAVAILABLE");
    expect(res.json().error.details?.reason).toBe(
      "CANCELLATION_MARKER_NOT_IMPLEMENTED",
    );
  });

  it("export of a canceled exam -> 409 EXAM_CANCELED_RESULTS_UNAVAILABLE", async () => {
    const examId = await createPublishedExam("Cancel Export Reject");
    await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/cancel`,
      payload: {},
      cookies: { "auth-token": ctx.adminToken },
    });
    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/exams/${examId}/export/scores`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("EXAM_CANCELED_RESULTS_UNAVAILABLE");
  });

  it("a canceled exam can be archived -> 200 archived", async () => {
    const examId = await createPublishedExam("Cancel Then Archive");
    await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/cancel`,
      payload: {},
      cookies: { "auth-token": ctx.adminToken },
    });
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/archive`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("archived");
  });

  // ADR-005 construction hard rule applied to archive (P2B-J2 follow-up #3):
  // lock -> reconcile -> assert -> mutate inside executeInTransaction, with
  // 404 for missing exam, 409 for invalid transition, and idempotent already-
  // archived behavior (no duplicate audit).
  it("archive returns 404 for a missing exam", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/00000000-0000-0000-0000-000000000000/archive`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(404);
  });

  it("archive of a draft exam is rejected with 409 (must publish first)", async () => {
    const createRes = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: {
        title: "Archive Draft Reject",
        courseId,
        durationMinutes: 60,
        openAt: new Date(Date.now() + 3600_000).toISOString(),
        closeAt: new Date(Date.now() + 86_400_000 + 3600_000).toISOString(),
        passingScore: 60,
        totalScore: 100,
        questionIds: [questionId],
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    const examId = createRes.json().id;
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/archive`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("EXAM_ARCHIVE_NOT_ALLOWED");
  });

  it("already-archived exam returns 200 and does not duplicate exam.archive audit", async () => {
    const examId = await createPublishedExam("Archive Idempotent");
    // First archive: genuine transition -> 200 + one audit event.
    const first = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/archive`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().status).toBe("archived");

    const readAuditCount = async () => {
      const auditRes = await ctx.app.inject({
        method: "GET",
        url: `/api/admin/audit-logs?action=exam.archive`,
        cookies: { "auth-token": ctx.adminToken },
      });
      expect(auditRes.statusCode).toBe(200);
      const rows = auditRes.json().items ?? [];
      return rows.filter((row: { targetId: string }) => row.targetId === examId)
        .length;
    };
    expect(await readAuditCount()).toBe(1);

    // Second archive: idempotent no-op -> 200, NO additional audit.
    const second = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/archive`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().status).toBe("archived");
    expect(await readAuditCount()).toBe(1);
  });

  it("successful archive writes exactly one exam.archive audit event", async () => {
    const examId = await createPublishedExam("Archive Audit");
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/archive`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);

    const auditRes = await ctx.app.inject({
      method: "GET",
      url: `/api/admin/audit-logs?action=exam.archive`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(auditRes.statusCode).toBe(200);
    const rows = (auditRes.json().items ?? []).filter(
      (row: { targetId: string }) => row.targetId === examId,
    );
    expect(rows.length).toBe(1);
  });

  it("successful cancel writes exactly one exam.cancel audit event", async () => {
    const examId = await createPublishedExam("Cancel Audit");
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/cancel`,
      payload: { reason: "audit-check" },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);

    const auditRes = await ctx.app.inject({
      method: "GET",
      url: `/api/admin/audit-logs?action=exam.cancel`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(auditRes.statusCode).toBe(200);
    const rows = (auditRes.json().items ?? []).filter(
      (row: { targetId: string }) => row.targetId === examId,
    );
    expect(rows.length).toBe(1);
  });

  it("rejected cancel (active attempts) writes NO audit event", async () => {
    const createRes = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: {
        title: "Cancel NoAudit",
        courseId,
        durationMinutes: 60,
        openAt: new Date(Date.now() - 60_000).toISOString(),
        closeAt: new Date(Date.now() + 86_400_000).toISOString(),
        passingScore: 60,
        totalScore: 100,
        questionIds: [questionId],
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    const examId = createRes.json().id;
    await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/publish`,
      cookies: { "auth-token": ctx.adminToken },
    });
    const candidate = await createCandidateViaApi(
      ctx.app,
      ctx.adminToken,
      `cand-cancel-noaudit-${uniquePrefix()}`,
      ctx.org.id,
    );
    await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/enrollments`,
      payload: { candidateIds: [candidate.candidateProfileId] },
      cookies: { "auth-token": ctx.adminToken },
    });
    await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${examId}/start`,
      cookies: { "auth-token": candidate.token },
    });
    const cancelRes = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/cancel`,
      payload: {},
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(cancelRes.statusCode).toBe(409);
    const auditRes = await ctx.app.inject({
      method: "GET",
      url: `/api/admin/audit-logs?action=exam.cancel`,
      cookies: { "auth-token": ctx.adminToken },
    });
    const allRows =
      auditRes.statusCode === 200 ? (auditRes.json().items ?? []) : [];
    const rows = allRows.filter((r: any) => r.targetId === examId);
    expect(rows.length).toBe(0);
  });
});

describe("exam passing-score invariant (EXAM-SCORE-INV-1)", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;
  let courseId: string;
  let questionId: string;

  beforeAll(async () => {
    ctx = await buildTestApp(async (fastify) => {
      await fastify.register(courseRoutes);
      await fastify.register(questionRoutes);
      await fastify.register(examRoutes);
    });

    const courseRes = await ctx.app.inject({
      method: "POST",
      url: "/api/courses",
      payload: {
        name: "Score Inv Course",
        code: `SIC-${uniquePrefix()}`,
        description: "",
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    courseId = courseRes.json().id;

    const qRes = await ctx.app.inject({
      method: "POST",
      url: "/api/questions",
      payload: {
        courseId,
        type: "true_false",
        content: "Zero-pass question.",
        standardAnswer: true,
        score: 100,
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    questionId = qRes.json().id;
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  function examPayload(overrides: Record<string, unknown> = {}) {
    return {
      title: "Score Invariant Exam",
      courseId,
      durationMinutes: 60,
      openAt: new Date().toISOString(),
      closeAt: new Date(Date.now() + 86400000).toISOString(),
      passingScore: 60,
      totalScore: 100,
      questionIds: [],
      ...overrides,
    };
  }

  it("POST create rejects passingScore > totalScore", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: examPayload({ passingScore: 101, totalScore: 100 }),
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.details.fields[0].field).toBe("passingScore");
  });

  it("POST create accepts passingScore = totalScore", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: examPayload({ passingScore: 100, totalScore: 100 }),
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().passingScore).toBe(100);
  });

  it("POST create accepts passingScore = 0", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: examPayload({ passingScore: 0, totalScore: 100 }),
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().passingScore).toBe(0);
  });

  it("POST create rejects passingScore < 0", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: examPayload({ passingScore: -1, totalScore: 100 }),
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST create rejects totalScore <= 0", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: examPayload({ passingScore: 0, totalScore: 0 }),
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(400);
  });

  it("PATCH totalScore below existing passingScore is rejected", async () => {
    const createRes = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: examPayload({ passingScore: 60, totalScore: 100 }),
      cookies: { "auth-token": ctx.adminToken },
    });
    const examId = createRes.json().id;

    const res = await ctx.app.inject({
      method: "PATCH",
      url: `/api/exams/${examId}`,
      payload: { totalScore: 50 },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");

    const getRes = await ctx.app.inject({
      method: "GET",
      url: `/api/exams/${examId}`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(getRes.json().passingScore).toBe(60);
    expect(getRes.json().totalScore).toBe(100);
  });

  it("PATCH passingScore above existing totalScore is rejected", async () => {
    const createRes = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: examPayload({ passingScore: 60, totalScore: 100 }),
      cookies: { "auth-token": ctx.adminToken },
    });
    const examId = createRes.json().id;

    const res = await ctx.app.inject({
      method: "PATCH",
      url: `/api/exams/${examId}`,
      payload: { passingScore: 120 },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(400);

    const getRes = await ctx.app.inject({
      method: "GET",
      url: `/api/exams/${examId}`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(getRes.json().passingScore).toBe(60);
    expect(getRes.json().totalScore).toBe(100);
  });

  it("PATCH both fields to valid pair succeeds", async () => {
    const createRes = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: examPayload({ passingScore: 60, totalScore: 100 }),
      cookies: { "auth-token": ctx.adminToken },
    });
    const examId = createRes.json().id;

    const res = await ctx.app.inject({
      method: "PATCH",
      url: `/api/exams/${examId}`,
      payload: { passingScore: 40, totalScore: 50 },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().passingScore).toBe(40);
    expect(res.json().totalScore).toBe(50);
  });

  it("PATCH passingScore = totalScore succeeds", async () => {
    const createRes = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: examPayload({ passingScore: 60, totalScore: 100 }),
      cookies: { "auth-token": ctx.adminToken },
    });
    const examId = createRes.json().id;

    const res = await ctx.app.inject({
      method: "PATCH",
      url: `/api/exams/${examId}`,
      payload: { passingScore: 50, totalScore: 50 },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().passingScore).toBe(50);
    expect(res.json().totalScore).toBe(50);
  });

  it("PATCH passingScore = 0 succeeds", async () => {
    const createRes = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: examPayload({ passingScore: 60, totalScore: 100 }),
      cookies: { "auth-token": ctx.adminToken },
    });
    const examId = createRes.json().id;

    const res = await ctx.app.inject({
      method: "PATCH",
      url: `/api/exams/${examId}`,
      payload: { passingScore: 0 },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().passingScore).toBe(0);
  });

  it("PATCH unrelated field preserves valid scores", async () => {
    const createRes = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: examPayload({ passingScore: 60, totalScore: 100 }),
      cookies: { "auth-token": ctx.adminToken },
    });
    const examId = createRes.json().id;

    const res = await ctx.app.inject({
      method: "PATCH",
      url: `/api/exams/${examId}`,
      payload: { title: "Renamed Exam" },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().passingScore).toBe(60);
    expect(res.json().totalScore).toBe(100);
  });

  it("publishes a zero-passing-score exam through the full API path", async () => {
    const createRes = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: examPayload({
        passingScore: 0,
        totalScore: 100,
        questionIds: [questionId],
      }),
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(createRes.statusCode).toBe(201);
    const examId = createRes.json().id;

    const pubRes = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/publish`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(pubRes.statusCode).toBe(200);
    expect(pubRes.json().status).toBe("published");
    expect(pubRes.json().passingScore).toBe(0);
  });
});

// ADR-013 §3 / REC-I4-I3A: interruption time-compensation policy authoring
// surface. Substantive authoring fields exposed through Exam create/update;
// draft-only mutation; cross-field validation per ADR-013.
describe("exam interruption policy authoring (ADR-013 / REC-I4-I3A)", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;
  let courseId: string;
  let questionId: string;

  function examPayload(overrides: Record<string, unknown> = {}) {
    return {
      title: `I3A-${uniquePrefix()}`,
      courseId,
      durationMinutes: 60,
      openAt: new Date().toISOString(),
      closeAt: new Date(Date.now() + 86400000).toISOString(),
      passingScore: 0,
      totalScore: 100,
      questionIds: [questionId],
      ...overrides,
    };
  }

  beforeAll(async () => {
    ctx = await buildTestApp(async (fastify) => {
      await fastify.register(courseRoutes);
      await fastify.register(questionRoutes);
      await fastify.register(examRoutes);
    });

    const courseRes = await ctx.app.inject({
      method: "POST",
      url: "/api/courses",
      payload: {
        name: "I3A Course",
        code: `I3A-${uniquePrefix()}`,
        description: "",
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    courseId = courseRes.json().id;

    const qRes = await ctx.app.inject({
      method: "POST",
      url: "/api/questions",
      payload: {
        courseId,
        type: "true_false",
        content: "I3A question.",
        standardAnswer: true,
        score: 100,
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    questionId = qRes.json().id;
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it("creates an exam with the default strict interruption policy when omitted", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: examPayload(),
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.interruptionTimePolicy).toBe("strict");
    expect(body.interruptionGracePerIncidentSeconds).toBeNull();
    expect(body.interruptionGracePerAttemptSeconds).toBeNull();
  });

  it("creates an exam with an explicit bounded_grace policy", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: examPayload({
        interruptionTimePolicy: "bounded_grace",
        interruptionGracePerIncidentSeconds: 120,
        interruptionGracePerAttemptSeconds: 300,
      }),
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.interruptionTimePolicy).toBe("bounded_grace");
    expect(body.interruptionGracePerIncidentSeconds).toBe(120);
    expect(body.interruptionGracePerAttemptSeconds).toBe(300);
  });

  it("rejects bounded_grace creation without caps (ADR-013 cross-field)", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: examPayload({
        interruptionTimePolicy: "bounded_grace",
      }),
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects bounded_grace creation with perIncident > perAttempt", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: examPayload({
        interruptionTimePolicy: "bounded_grace",
        interruptionGracePerIncidentSeconds: 600,
        interruptionGracePerAttemptSeconds: 300,
      }),
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(400);
  });

  it("updates interruption policy on a draft exam", async () => {
    const createRes = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: examPayload(),
      cookies: { "auth-token": ctx.adminToken },
    });
    const examId = createRes.json().id;

    const patchRes = await ctx.app.inject({
      method: "PATCH",
      url: `/api/exams/${examId}`,
      payload: {
        interruptionTimePolicy: "bounded_grace",
        interruptionGracePerIncidentSeconds: 90,
        interruptionGracePerAttemptSeconds: 240,
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(patchRes.statusCode).toBe(200);
    const body = patchRes.json();
    expect(body.interruptionTimePolicy).toBe("bounded_grace");
    expect(body.interruptionGracePerIncidentSeconds).toBe(90);
    expect(body.interruptionGracePerAttemptSeconds).toBe(240);
  });

  it("rejects interruption policy mutation on a published exam (draft-only)", async () => {
    const createRes = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: examPayload(),
      cookies: { "auth-token": ctx.adminToken },
    });
    const examId = createRes.json().id;

    await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/publish`,
      cookies: { "auth-token": ctx.adminToken },
    });

    const patchRes = await ctx.app.inject({
      method: "PATCH",
      url: `/api/exams/${examId}`,
      payload: {
        interruptionTimePolicy: "bounded_grace",
        interruptionGracePerIncidentSeconds: 90,
        interruptionGracePerAttemptSeconds: 240,
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    // Published exams accept schedule fields only; interruption policy is a
    // substantive authoring field frozen at publish.
    expect(patchRes.statusCode).toBe(409);
    expect(patchRes.json().error.code).toBe("EXAM_UPDATE_NOT_ALLOWED");
  });

  it("rejects partial bounded_grace update missing caps (cross-field merge)", async () => {
    // Start strict, then try to switch policy to bounded_grace via PATCH
    // without supplying caps. The route merges the partial input with the
    // existing (null) caps, which still violates bounded_grace requirements.
    const createRes = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: examPayload(),
      cookies: { "auth-token": ctx.adminToken },
    });
    const examId = createRes.json().id;

    const patchRes = await ctx.app.inject({
      method: "PATCH",
      url: `/api/exams/${examId}`,
      payload: {
        interruptionTimePolicy: "bounded_grace",
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(patchRes.statusCode).toBe(400);
    // The route normalizes the normalizer failure into the VALIDATION_ERROR
    // contract (details.fields), mapping the bounded_grace-without-caps issue
    // onto the policy field (cross-field rules carry an empty normalizer path).
    const body = patchRes.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.details.fields).toBeDefined();
    expect(body.error.details.fields[0].field).toBe("interruptionTimePolicy");
  });
});
