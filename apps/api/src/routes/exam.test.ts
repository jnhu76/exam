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

  it("GET /api/exams returns 401 without auth", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/exams",
    });
    expect(res.statusCode).toBe(401);
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

  it("POST /api/exams returns 400 ErrorResponse v0 for invalid courseId", async () => {
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
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.requestId).toBeDefined();
    expect(body.error.details.fields).toBeDefined();
    expect(body.error.details.fields[0].field).toBe("courseId");
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
