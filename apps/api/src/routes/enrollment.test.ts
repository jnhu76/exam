import { describe, expect, it, beforeAll, afterAll } from "vitest";
import examRoutes from "./exam.js";
import courseRoutes from "./course.js";
import questionRoutes from "./question.js";
import candidateRoutes from "./candidate.js";
import { buildTestApp, uniquePrefix } from "./testHelpers.js";

describe("exam enrollment routes", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;
  let courseId: string;
  let questionId: string;
  let examId: string;
  let candidateProfileId: string;

  beforeAll(async () => {
    ctx = await buildTestApp(async (fastify) => {
      await fastify.register(courseRoutes);
      await fastify.register(questionRoutes);
      await fastify.register(candidateRoutes);
      await fastify.register(examRoutes);
    });

    const courseRes = await ctx.app.inject({
      method: "POST",
      url: "/api/courses",
      payload: {
        name: "Enrollment Course",
        code: `ENR-${uniquePrefix()}`,
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
        content: "Enrollment question.",
        standardAnswer: true,
        score: 100,
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    questionId = qRes.json().id;

    const candRes = await ctx.app.inject({
      method: "POST",
      url: "/api/candidates",
      payload: {
        username: `enroll-cand-${uniquePrefix()}`,
        password: "password123",
        name: "Enroll Candidate",
        fields: {},
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    candidateProfileId = candRes.json().id;

    const examRes = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: {
        title: "Enrollment Exam",
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
    examId = examRes.json().id;

    await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/publish`,
      cookies: { "auth-token": ctx.adminToken },
    });
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it("POST /api/exams/:examId/enrollments adds a candidate", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/enrollments`,
      payload: { candidateIds: [candidateProfileId] },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.added).toBe(1);
    expect(body.skipped).toBe(0);
    expect(body.enrollments).toHaveLength(1);
    expect(body.enrollments[0].candidateId).toBe(candidateProfileId);
    expect(body.enrollments[0].status).toBe("assigned");
    // No skips on a clean add; skippedCandidates is empty (not undefined).
    expect(body.skippedCandidates).toEqual([]);
  });

  it("GET /api/exams/:examId/enrollments lists enrollments", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/exams/${examId}/enrollments`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(1);
    expect(body[0].candidateId).toBe(candidateProfileId);
  });

  it("POST /api/exams/:examId/enrollments skips duplicate", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/enrollments`,
      payload: { candidateIds: [candidateProfileId] },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.added).toBe(0);
    expect(body.skipped).toBe(1);
    // Backward-compat: the enrollments array holds only newly-added rows, so a
    // pure-duplicate batch adds nothing.
    expect(body.enrollments).toHaveLength(0);
    // Per-skip reason reporting: the duplicate is reported with its reason.
    expect(body.skippedCandidates).toEqual([
      { candidateId: candidateProfileId, reason: "DUPLICATE" },
    ]);
  });

  it("DELETE /api/exams/:examId/enrollments/:id removes assigned enrollment", async () => {
    const listRes = await ctx.app.inject({
      method: "GET",
      url: `/api/exams/${examId}/enrollments`,
      cookies: { "auth-token": ctx.adminToken },
    });
    const enrollmentId = listRes.json()[0].id;

    const res = await ctx.app.inject({
      method: "DELETE",
      url: `/api/exams/${examId}/enrollments/${enrollmentId}`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(204);

    const afterList = await ctx.app.inject({
      method: "GET",
      url: `/api/exams/${examId}/enrollments`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(afterList.json()).toHaveLength(0);
  });

  it("POST /api/exams/:examId/enrollments skips non-existent candidate", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/enrollments`,
      payload: {
        candidateIds: ["00000000-0000-0000-0000-000000000000"],
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().added).toBe(0);
    expect(res.json().skipped).toBe(1);
    // Per-skip reason reporting: a non-existent candidate is NOT_FOUND.
    expect(res.json().skippedCandidates).toEqual([
      {
        candidateId: "00000000-0000-0000-0000-000000000000",
        reason: "NOT_FOUND",
      },
    ]);
  });

  it("POST /api/exams/:examId/enrollments reports mixed skips + keeps added/skipped/enrollments backward-compatible", async () => {
    // Create a fresh candidate that WILL be added.
    const freshRes = await ctx.app.inject({
      method: "POST",
      url: "/api/candidates",
      payload: {
        username: `enroll-mix-${uniquePrefix()}`,
        password: "password123",
        name: "Mix Candidate",
        fields: {},
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    const freshId = freshRes.json().id;

    // Ensure candidateProfileId is enrolled (state from earlier tests is not
    // guaranteed — the DELETE test may have removed it). Enroll it fresh so the
    // DUPLICATE case below is deterministic.
    await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/enrollments`,
      payload: { candidateIds: [candidateProfileId] },
      cookies: { "auth-token": ctx.adminToken },
    });

    // Batch: one already-enrolled (candidateProfileId, DUPLICATE), one
    // non-existent (NOT_FOUND), one fresh (added).
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/enrollments`,
      payload: {
        candidateIds: [
          candidateProfileId,
          "00000000-0000-0000-0000-000000000000",
          freshId,
        ],
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // Backward-compatible counts.
    expect(body.added).toBe(1);
    expect(body.skipped).toBe(2);
    expect(body.enrollments).toHaveLength(1); // only freshId newly added
    expect(
      body.enrollments.map((e: { candidateId: string }) => e.candidateId),
    ).toContain(freshId);
    // Per-skip reasons, in input order.
    expect(body.skippedCandidates).toEqual([
      { candidateId: candidateProfileId, reason: "DUPLICATE" },
      {
        candidateId: "00000000-0000-0000-0000-000000000000",
        reason: "NOT_FOUND",
      },
    ]);
  });
});
