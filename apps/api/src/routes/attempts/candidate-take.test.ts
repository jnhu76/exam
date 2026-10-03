import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { buildTestApp } from "../testHelpers.js";
import examRoutes from "../exam.js";
import attemptRoutes from "../attempts.js";
import {
  buildExamPayload,
  enrollCandidateForExam,
  buildSharedAttemptFixture,
} from "./__tests__/attempts.testHelpers.js";

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
      // D2 (#669): currentClientSeq is restored from the replay-receipt
      // table now that the draft JSONB no longer carries clientSeq.
      expect(q.currentClientSeq).toBe(1);
      expect(q.currentVersion).toBe(1);
    });

    it("restores currentClientSeq after multiple accepted saves (reloaded-client regression)", async () => {
      // Mirrors the E2E refresh-during-exam contract: after a reload the
      // client must continue AFTER its last accepted clientSeq, never replay
      // an already-accepted key. Continues the shared attempt from the
      // previous test (q[0] is at clientSeq 1, version 1).
      const startRes = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${examId}/start`,
        cookies: { "auth-token": ctx.candidateToken },
      });
      const attemptId = startRes.json().id as string;
      const qId = startRes.json().questionSnapshot[0].originalQuestionId;

      const secondSave = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${attemptId}/answers/${qId}`,
        payload: {
          attemptId,
          questionId: qId,
          answer: "c",
          clientSeq: 2,
          clientSavedAt: new Date().toISOString(),
          baseVersion: 1,
        },
        cookies: { "auth-token": ctx.candidateToken },
      });
      expect(secondSave.statusCode).toBe(200);
      expect(secondSave.json().accepted).toBe(true);
      expect(secondSave.json().serverVersion).toBe(2);

      // A reloaded client sends clientSeq 3 (currentClientSeq 2 + 1); the
      // server must treat it as a fresh save, not a replay of seq 1 or 2.
      const reloadedSave = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${attemptId}/answers/${qId}`,
        payload: {
          attemptId,
          questionId: qId,
          answer: "a",
          clientSeq: 3,
          clientSavedAt: new Date().toISOString(),
          baseVersion: 2,
        },
        cookies: { "auth-token": ctx.candidateToken },
      });
      expect(reloadedSave.statusCode).toBe(200);
      expect(reloadedSave.json().accepted).toBe(true);
      expect(reloadedSave.json().serverVersion).toBe(3);

      const takeRes = await ctx.app.inject({
        method: "GET",
        url: `/api/candidate/attempts/${attemptId}/take`,
        cookies: { "auth-token": ctx.candidateToken },
      });
      expect(takeRes.statusCode).toBe(200);
      const q = takeRes.json().questions[0];
      expect(q.answerSource).toBe("draft");
      expect(q.answerValue).toBe("a");
      expect(q.currentClientSeq).toBe(3);
      expect(q.currentVersion).toBe(3);
    });

    it("returns answerSource=submitted after submitting", async () => {
      // P3-L0-2 has landed: the submit freeze barrier writes submitted_answers
      // with one entry per snapshot question, so a fresh submit resolves to
      // "submitted". The "none" arm stays legal for legacy rows whose
      // submitted_answers was never populated (see the fallback branch in
      // attempts.shared.ts and the backfill-submitted-answers script).
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
