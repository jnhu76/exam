import { describe, expect, it, beforeAll, afterAll } from "vitest";
import examRoutes from "./exam.js";
import courseRoutes from "./course.js";
import questionRoutes from "./question.js";
import candidateRoutes from "./candidate.js";
import attemptRoutes from "./attempts.js";
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

  it("PATCH /api/exams/:id returns 409 EXAM_NOT_DRAFT for published exam", async () => {
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
    expect(body.error.code).toBe("EXAM_NOT_DRAFT");
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
