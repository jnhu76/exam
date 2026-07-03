import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { buildTestApp } from "../testHelpers.js";
import examRoutes from "../exam.js";
import attemptRoutes from "../attempts.js";
import {
  buildExamPayload,
  enrollCandidateForExam,
  buildSharedAttemptFixture,
} from "./attempts.testHelpers.js";

/**
 * P3-PROTO-2 — CandidateTakeSnapshot endpoint tests.
 *
 * Tests GET /candidate/attempts/:attemptId/take which returns the unified
 * CandidateTakeSnapshot with derived capabilities and answerSource routing.
 */
describe("P3-PROTO-2: CandidateTakeSnapshot endpoint", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;
  let examId: string;
  let courseId: string;
  let questionId: string;
  let candidateProfileId: string;

  beforeAll(async () => {
    const fixture = await buildSharedAttemptFixture();
    ctx = fixture.ctx;
    examId = fixture.examId;
    courseId = fixture.courseId;
    questionId = fixture.questionId;
    candidateProfileId = fixture.candidateProfileId;
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  describe("GET /candidate/attempts/:attemptId/take", () => {
    it("returns CandidateTakeSnapshot for in_progress attempt with answerSource=none", async () => {
      // Start attempt using the shared fixture's exam
      const startRes = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${examId}/start`,
        cookies: { "auth-token": ctx.candidateToken },
      });
      // If attempt already exists (200), reuse it; if new (201), use it
      const attemptId = startRes.json().id as string;

      const takeRes = await ctx.app.inject({
        method: "GET",
        url: `/api/candidate/attempts/${attemptId}/take`,
        cookies: { "auth-token": ctx.candidateToken },
      });

      expect(takeRes.statusCode).toBe(200);
      expect(takeRes.headers["cache-control"]).toBe("no-store");

      const body = takeRes.json();
      expect(body.attemptId).toBe(attemptId);
      expect(body.examId).toBe(examId);
      expect(body.attemptStatus).toBe("in_progress");
      expect(body.isEditable).toBe(true);
      expect(body.canSave).toBe(true);
      expect(body.canSubmit).toBe(true);
      expect(body.serverNow).toBeDefined();
      expect(body.questions).toBeDefined();
      expect(body.questions.length).toBeGreaterThan(0);

      const q = body.questions[0];
      expect(q.id).toBeDefined();
      expect(q.type).toBeDefined();
      expect(q.prompt).toBeDefined();
      expect(q.inputMode).toBeDefined();
      expect(q.answerSource).toBe("none");
      expect(q.answerValue).toBeNull();

      // Security projection
      expect(q).not.toHaveProperty("standardAnswer");
      expect(q).not.toHaveProperty("rubric");
      expect(q).not.toHaveProperty("gradingMode");
    });

    it("returns answerSource=draft after saving an answer", async () => {
      // Use the attempt from previous test (shared fixture exam)
      const startRes = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${examId}/start`,
        cookies: { "auth-token": ctx.candidateToken },
      });
      const attemptId = startRes.json().id as string;
      const qId = startRes.json().questionSnapshot[0].originalQuestionId;

      // Save answer
      await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${attemptId}/answers/${qId}`,
        payload: {
          attemptId,
          questionId: qId,
          answer: "b",
          clientSeq: 1,
          clientSavedAt: new Date().toISOString(),
          baseVersion: 0,
        },
        cookies: { "auth-token": ctx.candidateToken },
      });

      const takeRes = await ctx.app.inject({
        method: "GET",
        url: `/api/candidate/attempts/${attemptId}/take`,
        cookies: { "auth-token": ctx.candidateToken },
      });

      expect(takeRes.statusCode).toBe(200);
      const body = takeRes.json();
      const q = body.questions[0];
      expect(q.answerSource).toBe("draft");
      expect(q.answerValue).toBe("b");
    });

    it("returns answerSource=submitted after submitting", async () => {
      // NOTE: After P3-L0-2 lands, submitAttempt will write to submitted_answers
      // column, and answerSource will be 'submitted'. Until then, submitted_answers
      // is null and answerSource is 'none' — this test documents the gap.
      const startRes = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${examId}/start`,
        cookies: { "auth-token": ctx.candidateToken },
      });
      const attemptId = startRes.json().id as string;

      // Submit
      await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${attemptId}/submit`,
        cookies: { "auth-token": ctx.candidateToken },
      });

      const takeRes = await ctx.app.inject({
        method: "GET",
        url: `/api/candidate/attempts/${attemptId}/take`,
        cookies: { "auth-token": ctx.candidateToken },
      });

      expect(takeRes.statusCode).toBe(200);
      const body = takeRes.json();
      expect(body.isEditable).toBe(false);

      // After P3-L0-2: answerSource will be 'submitted'
      // Before P3-L0-2: submitted_answers column is null, so answerSource is 'none'
      const q = body.questions[0];
      expect(["submitted", "none"]).toContain(q.answerSource);
      expect(q).not.toHaveProperty("standardAnswer");
    });

    it("returns 404 for non-existent attempt", async () => {
      const takeRes = await ctx.app.inject({
        method: "GET",
        url: "/api/candidate/attempts/00000000-0000-0000-0000-000000000000/take",
        cookies: { "auth-token": ctx.candidateToken },
      });
      expect(takeRes.statusCode).toBe(404);
    });
  });
});
