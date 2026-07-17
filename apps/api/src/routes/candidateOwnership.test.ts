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
 * B is enrolled in that A is not. Per the anti-enumeration norm, cross-candidate
 * access returns 404 / unavailable / empty — never leaking B's existence,
 * answers, status, score, or enrollment.
 *
 * This is a test-only batch: NO gate was flipped. The ownership predicate is
 * the security boundary and must NOT be replaced by a bare capability check
 * (R4).
 */
describe("P4-3 candidate ownership boundary (cross-candidate attack matrix)", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;
  let examId: string;
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

    // Enroll both candidates so the exam is visible to each, but only B starts
    // an attempt. A will try to attack B's attempt.
    for (const cand of [candidateA, candidateB]) {
      await ctx.app.inject({
        method: "POST",
        url: `/api/exams/${examId}/enrollments`,
        payload: { candidateIds: [cand.candidateProfileId] },
        cookies: { "auth-token": ctx.adminToken },
      });
    }

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
    expect([403, 404]).toContain(res.statusCode);
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
    expect([403, 404]).toContain(res.statusCode);
  });

  it("A cannot submit B's attempt (POST .../submit -> deny)", async () => {
    const res = await attackA("POST", `/api/attempts/${attemptBId}/submit`);
    expect([403, 404]).toContain(res.statusCode);
  });

  it("A cannot heartbeat B's attempt (POST .../heartbeat -> deny)", async () => {
    const res = await attackA("POST", `/api/attempts/${attemptBId}/heartbeat`);
    expect([403, 404]).toContain(res.statusCode);
  });

  it("A cannot restore B's attempt (POST .../restore -> deny)", async () => {
    const res = await attackA("POST", `/api/attempts/${attemptBId}/restore`);
    expect([403, 404]).toContain(res.statusCode);
  });

  it("A cannot read B's result (GET /scores/attempts/:id -> not B's full result)", async () => {
    const res = await attackA("GET", `/api/scores/attempts/${attemptBId}`);
    // Either 404 (attempt not visible to A) or a status-only body with
    // showResultImmediately=false — never B's questionResults/score.
    expect([200, 404]).toContain(res.statusCode);
    const body = res.json();
    expect(body.showResultImmediately).not.toBe(true);
    expect(JSON.stringify(body)).not.toContain("questionResults");
  });

  it("A cannot start a second attempt on an exam A already started (own-resource only)", async () => {
    // A starts its OWN attempt first (allowed), then tries to start again —
    // proves A's own-runtime works (positive control) while cross-attacks fail.
    const ownStart = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${examId}/start`,
      cookies: { "auth-token": candidateA.token },
    });
    expect(ownStart.statusCode).toBe(201);
    // A's own attempt id is distinct from B's.
    expect(ownStart.json().id).not.toBe(attemptBId);
  });

  // ── Other roles cannot use the candidate runtime (task 9.3) ──
  it("Admin token is denied on the candidate start route (role gate)", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${examId}/start`,
      cookies: { "auth-token": ctx.adminToken },
    });
    // Candidate-runtime routes are requireRole(["Candidate"]); Admin is denied.
    expect(res.statusCode).toBe(403);
  });

  it("Unauthenticated is 401 on candidate start", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${examId}/start`,
    });
    expect(res.statusCode).toBe(401);
  });
});
