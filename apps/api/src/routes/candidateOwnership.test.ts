import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  buildTestApp,
  createCandidateViaApi,
  createExamViaApi,
  publishExamViaApi,
  uniquePrefix,
} from "./testHelpers.js";
import attemptRoutes from "./attempts.js";
import candidateRoutes from "./candidate.js";
import examRoutes from "./exam.js";
import courseRoutes from "./course.js";
import questionRoutes from "./question.js";
import scoreRoutes from "./scores.js";

/**
 * P4-3 — Candidate ownership boundary proof (task 9.2 cross-candidate matrix).
 *
 * The candidate runtime is requireRole(["Candidate"]) + an own-attempt /
 * own-enrollment / own-score ownership predicate (getOwnedAttempt /
 * findByIdAndCandidate / findByExamAndCandidate). This test proves that
 * predicate holds: Candidate A, holding a real attempt, cannot read/answer/
 * submit/restore/heartbeat/score Candidate B's attempt, and cannot see an exam
 * B is enrolled in that A is not. Per the anti-enumeration norm, direct
 * cross-candidate access returns 404 — never leaking B's existence,
 * answers, status, score, or enrollment.
 *
 * The ownership predicate is the security boundary and must not be replaced
 * by a bare capability check (R4).
 */
describe("P4-3 candidate ownership boundary (cross-candidate attack matrix)", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;
  let examId: string;
  let candidateBOnlyExamId: string;
  let candidateA: { candidateProfileId: string; userId: string; token: string };
  let candidateB: { candidateProfileId: string; userId: string; token: string };
  let attemptBId: string;
  let sharedQuestionId: string;

  beforeAll(async () => {
    ctx = await buildTestApp(async (fastify) => {
      await fastify.register(courseRoutes);
      await fastify.register(questionRoutes);
      await fastify.register(candidateRoutes);
      await fastify.register(examRoutes);
      await fastify.register(attemptRoutes);
      await fastify.register(scoreRoutes);
    });

    // Seed a published exam with one true_false question; enroll both candidates.
    examId = await createExamViaApi(ctx.app, ctx.adminToken, {
      examTitle: "P4-3 Exam",
      courseCode: "P43",
      courseName: "P4-3 Course",
      questionContent: "P4-3 question.",
      questionAnswer: true,
      questionScore: 100,
      durationMinutes: 60,
      passingScore: 50,
      totalScore: 100,
    });
    await publishExamViaApi(ctx.app, ctx.adminToken, examId);

    // Fetch the exam's question id (shared by both candidates' snapshots) so the
    // save-answer attack uses a valid questionId — isolating the ownership check
    // from the questionId validation that otherwise 400s first.
    const examDetail = await ctx.app.inject({
      method: "GET",
      url: `/api/exams/${examId}`,
      cookies: { "auth-token": ctx.adminToken },
    });
    sharedQuestionId = examDetail.json().questionIds[0] as string;

    candidateA = await createCandidateViaApi(
      ctx.app,
      ctx.adminToken,
      `p43-a-${uniquePrefix()}`,
      ctx.org.id,
    );
    candidateB = await createCandidateViaApi(
      ctx.app,
      ctx.adminToken,
      `p43-b-${uniquePrefix()}`,
      ctx.org.id,
    );

    // Enroll both candidates so the shared exam is visible to each, but only B
    // starts an attempt. A will try to attack B's attempt.
    for (const cand of [candidateA, candidateB]) {
      const enrollment = await ctx.app.inject({
        method: "POST",
        url: `/api/exams/${examId}/enrollments`,
        payload: { candidateIds: [cand.candidateProfileId] },
        cookies: { "auth-token": ctx.adminToken },
      });
      expect(enrollment.statusCode).toBe(200);
    }

    candidateBOnlyExamId = await createExamViaApi(ctx.app, ctx.adminToken, {
      examTitle: "P4-3 Candidate B Only Exam",
      courseCode: `P43B-${uniquePrefix()}`,
      courseName: "P4-3 Candidate B Only Course",
      questionContent: "P4-3 candidate B only question.",
      questionAnswer: true,
      questionScore: 100,
      durationMinutes: 60,
      passingScore: 50,
      totalScore: 100,
    });
    await publishExamViaApi(ctx.app, ctx.adminToken, candidateBOnlyExamId);
    const bOnlyEnrollment = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${candidateBOnlyExamId}/enrollments`,
      payload: { candidateIds: [candidateB.candidateProfileId] },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(bOnlyEnrollment.statusCode).toBe(200);

    // B starts an attempt.
    const startRes = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${examId}/start`,
      cookies: { "auth-token": candidateB.token },
    });
    expect(startRes.statusCode).toBe(201);
    attemptBId = startRes.json().id;
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  // Helper: A attacks B's resource. Returns the status code.
  function attackA(method: string, url: string, payload?: unknown) {
    return ctx.app.inject({
      method: method as never,
      url,
      payload: payload as never,
      cookies: { "auth-token": candidateA.token },
    });
  }

  it("A cannot read B's attempt (GET /attempts/:id -> 404, not B's data)", async () => {
    const res = await attackA("GET", `/api/attempts/${attemptBId}`);
    expect(res.statusCode).toBe(404);
  });

  it("A cannot read B's take snapshot (GET /candidate/attempts/:id/take -> 404)", async () => {
    const res = await attackA(
      "GET",
      `/api/candidate/attempts/${attemptBId}/take`,
    );
    expect(res.statusCode).toBe(404);
    // Must never return B's questions/answers.
    const body = res.json();
    expect(JSON.stringify(body)).not.toContain("questionSnapshot");
  });

  it("A cannot save an answer to B's attempt (POST .../answers/:qid -> deny)", async () => {
    const res = await attackA(
      "POST",
      `/api/attempts/${attemptBId}/answers/${sharedQuestionId}`,
      {
        attemptId: attemptBId,
        questionId: sharedQuestionId,
        answer: true,
        clientSeq: 1,
        clientSavedAt: new Date().toISOString(),
        baseVersion: 0,
      },
    );
    expect(res.statusCode).toBe(404);
  });

  it("A cannot submit B's attempt (POST .../submit -> deny)", async () => {
    const res = await attackA("POST", `/api/attempts/${attemptBId}/submit`);
    expect(res.statusCode).toBe(404);
  });

  it("A cannot heartbeat B's attempt (POST .../heartbeat -> deny)", async () => {
    const res = await attackA("POST", `/api/attempts/${attemptBId}/heartbeat`);
    expect(res.statusCode).toBe(404);
  });

  it("A cannot restore B's attempt (POST .../restore -> deny)", async () => {
    const res = await attackA("POST", `/api/attempts/${attemptBId}/restore`);
    expect(res.statusCode).toBe(404);
  });

  it("A cannot read B's result (GET /scores/attempts/:id -> not B's full result)", async () => {
    const res = await attackA("GET", `/api/scores/attempts/${attemptBId}`);
    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.showResultImmediately).not.toBe(true);
    expect(JSON.stringify(body)).not.toContain("questionResults");
  });

  it("A sees no detail for an exam enrolled only to B", async () => {
    const res = await attackA(
      "GET",
      `/api/candidate/exams/${candidateBOnlyExamId}`,
    );
    expect(res.statusCode).toBe(404);
  });

  it("A cannot join the queue for an exam enrolled only to B", async () => {
    const res = await attackA(
      "POST",
      `/api/attempts/${candidateBOnlyExamId}/queue`,
    );
    expect(res.statusCode).toBe(404);
  });

  it("A's exam list excludes an exam enrolled only to B", async () => {
    const res = await attackA("GET", "/api/candidate/exams");
    expect(res.statusCode).toBe(200);
    expect(res.json()).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ examId: candidateBOnlyExamId }),
      ]),
    );
  });

  it("A repeated start returns A's existing attempt instead of creating another", async () => {
    const ownStart = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${examId}/start`,
      cookies: { "auth-token": candidateA.token },
    });
    expect(ownStart.statusCode).toBe(201);
    expect(ownStart.json().id).not.toBe(attemptBId);

    const repeatedStart = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${examId}/start`,
      cookies: { "auth-token": candidateA.token },
    });
    expect(repeatedStart.statusCode).toBe(200);
    expect(repeatedStart.json().id).toBe(ownStart.json().id);
  });

  // ── Other roles cannot use the candidate runtime (task 9.3) ──
  const candidateRuntimeRequests = [
    {
      name: "exam list",
      method: "GET",
      url: () => "/api/candidate/exams",
    },
    {
      name: "exam detail",
      method: "GET",
      url: () => `/api/candidate/exams/${candidateBOnlyExamId}`,
    },
    {
      name: "attempt detail",
      method: "GET",
      url: () => `/api/attempts/${attemptBId}`,
    },
    {
      name: "take snapshot",
      method: "GET",
      url: () => `/api/candidate/attempts/${attemptBId}/take`,
    },
    {
      name: "save answer",
      method: "POST",
      url: () => `/api/attempts/${attemptBId}/answers/${sharedQuestionId}`,
      payload: () => ({
        attemptId: attemptBId,
        questionId: sharedQuestionId,
        answer: true,
        clientSeq: 1,
        clientSavedAt: new Date().toISOString(),
        baseVersion: 0,
      }),
    },
    {
      name: "submit",
      method: "POST",
      url: () => `/api/attempts/${attemptBId}/submit`,
    },
    {
      name: "heartbeat",
      method: "POST",
      url: () => `/api/attempts/${attemptBId}/heartbeat`,
    },
    {
      name: "restore",
      method: "POST",
      url: () => `/api/attempts/${attemptBId}/restore`,
    },
    {
      name: "queue",
      method: "POST",
      url: () => `/api/attempts/${candidateBOnlyExamId}/queue`,
    },
    {
      name: "start",
      method: "POST",
      url: () => `/api/attempts/${examId}/start`,
    },
  ];

  it.each(candidateRuntimeRequests)(
    "Admin is denied on candidate-only $name",
    async ({ method, url, payload }) => {
      const res = await ctx.app.inject({
        method: method as never,
        url: url(),
        payload: payload?.() as never,
        cookies: { "auth-token": ctx.adminToken },
      });
      expect(res.statusCode).toBe(403);
    },
  );

  it.each(candidateRuntimeRequests)(
    "unauthenticated requests receive 401 on candidate-only $name",
    async ({ method, url, payload }) => {
      const res = await ctx.app.inject({
        method: method as never,
        url: url(),
        payload: payload?.() as never,
      });
      expect(res.statusCode).toBe(401);
    },
  );
});
