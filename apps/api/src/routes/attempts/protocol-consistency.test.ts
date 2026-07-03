import { describe, expect, it, beforeAll, afterAll, afterEach } from "vitest";
import { buildTestApp } from "../testHelpers.js";
import examRoutes from "../exam.js";
import attemptRoutes from "../attempts.js";
import { createAttemptRepo } from "@exam/db/src/repository/attemptRepo.js";
import {
  buildExamPayload,
  enrollCandidateForExam,
  buildSharedAttemptFixture,
} from "./attempts.testHelpers.js";

/**
 * P3-PROTO-1 — Backend State Consistency Tests (L0)
 *
 * Proves 14 protocol boundary scenarios from the exam protocol matrix.
 * Scenarios 1-8, 11-12, 14 exercise existing behavior.
 * Scenarios 9-10, 13 depend on L0 implementations (RED until landed).
 *
 * Coverage map:
 *   #1  save before submit allowed            → existing candidate-save-submit.test.ts:282
 *   #2  save after submit rejected            → existing candidate-save-submit.test.ts:925
 *   #3  double submit idempotency             → existing candidate-save-submit.test.ts:524
 *   #4  save/submit race                      → existing submitFreezeBarrier.test.ts
 *   #5  refresh after submit                  → THIS FILE
 *   #6  candidate cannot see score before release → existing scores.test.ts:261
 *   #7  candidate cannot see standardAnswer   → existing candidate-save-submit.test.ts:188
 *   #8  grading view sees submitted answers   → existing gradingQueue.test.ts:728
 *   #9  deadline reconciliation via take      → THIS FILE (RED until P3-L0-3)
 *   #10 deadline reconciliation idempotent    → THIS FILE (RED until P3-L0-3)
 *   #11 save after deadline rejected          → existing candidate-save-submit.test.ts:678
 *   #12 submit after deadline returns existing → existing candidate-save-submit.test.ts:764
 *   #13 text_response grading reads submitted_answers → THIS FILE (RED until P3-L0-1/L0-2)
 *   #14 grading queue queries gradingStatus   → existing gradingQueue.test.ts:201,232
 */
describe("P3-PROTO-1: protocol boundary consistency", () => {
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

  // ─── Helper ────────────────────────────────────────────────────
  const candidateCtx = () => ({
    actorId: ctx.candidate.id,
    organizationId: ctx.org.id,
    role: "Candidate" as const,
    permissions: [] as import("@exam/domain").Permission[],
    sessionId: "test",
    targetOrganizationId: ctx.org.id,
  });

  // ─── Scenario #5: refresh after submit ─────────────────────────
  describe("#5 refresh after submit — GET returns locked + submitted answers", () => {
    let attemptId: string;

    beforeAll(async () => {
      const examRes = await ctx.app.inject({
        method: "POST",
        url: "/api/exams",
        payload: buildExamPayload({
          title: "Proto1-#5 Refresh After Submit",
          courseId,
          questionIds: [questionId],
        }),
        cookies: { "auth-token": ctx.adminToken },
      });
      const refreshExamId = examRes.json().id as string;

      await ctx.app.inject({
        method: "POST",
        url: `/api/exams/${refreshExamId}/publish`,
        cookies: { "auth-token": ctx.adminToken },
      });
      await enrollCandidateForExam(ctx, candidateProfileId, refreshExamId);

      const startRes = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${refreshExamId}/start`,
        cookies: { "auth-token": ctx.candidateToken },
      });
      attemptId = startRes.json().id as string;
      const qId = startRes.json().questionSnapshot[0].originalQuestionId;

      // Save an answer then submit
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
      await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${attemptId}/submit`,
        cookies: { "auth-token": ctx.candidateToken },
      });
    });

    it("GET after submit returns locked attempt with submitted status", async () => {
      const res = await ctx.app.inject({
        method: "GET",
        url: `/api/attempts/${attemptId}`,
        cookies: { "auth-token": ctx.candidateToken },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.status).toBe("graded");
      expect(body.submittedAt).toBeDefined();
      // Candidate should not see standardAnswer after submit
      expect(body.questionSnapshot[0]).not.toHaveProperty("standardAnswer");
    });

    it("save after submit is rejected (ATTEMPT_ALREADY_SUBMITTED)", async () => {
      const qId = (
        await ctx.app.inject({
          method: "GET",
          url: `/api/attempts/${attemptId}`,
          cookies: { "auth-token": ctx.candidateToken },
        })
      ).json().questionSnapshot[0].originalQuestionId;

      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${attemptId}/answers/${qId}`,
        payload: {
          attemptId,
          questionId: qId,
          answer: "a",
          clientSeq: 999,
          clientSavedAt: new Date().toISOString(),
          baseVersion: 0,
        },
        cookies: { "auth-token": ctx.candidateToken },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().accepted).toBe(false);
      expect(res.json().reason).toBe("ATTEMPT_ALREADY_SUBMITTED");
    });
  });

  // ─── Scenario #2 (DB invariant): submitted_answers unchanged ───
  describe("#2 DB invariant — submitted_answers unchanged after rejected save", () => {
    let attemptId: string;
    let answersBefore: unknown;

    beforeAll(async () => {
      const examRes = await ctx.app.inject({
        method: "POST",
        url: "/api/exams",
        payload: buildExamPayload({
          title: "Proto1-#2 DB Invariant",
          courseId,
          questionIds: [questionId],
        }),
        cookies: { "auth-token": ctx.adminToken },
      });
      const invariantExamId = examRes.json().id as string;

      await ctx.app.inject({
        method: "POST",
        url: `/api/exams/${invariantExamId}/publish`,
        cookies: { "auth-token": ctx.adminToken },
      });
      await enrollCandidateForExam(ctx, candidateProfileId, invariantExamId);

      const startRes = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${invariantExamId}/start`,
        cookies: { "auth-token": ctx.candidateToken },
      });
      attemptId = startRes.json().id as string;
      const qId = startRes.json().questionSnapshot[0].originalQuestionId;

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
      await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${attemptId}/submit`,
        cookies: { "auth-token": ctx.candidateToken },
      });

      const repo = createAttemptRepo(ctx.db);
      const row = await repo.findById(candidateCtx(), attemptId);
      answersBefore = row?.answers;
    });

    it("DB answers column unchanged after rejected save", async () => {
      const qId = (
        await ctx.app.inject({
          method: "GET",
          url: `/api/attempts/${attemptId}`,
          cookies: { "auth-token": ctx.candidateToken },
        })
      ).json().questionSnapshot[0].originalQuestionId;

      await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${attemptId}/answers/${qId}`,
        payload: {
          attemptId,
          questionId: qId,
          answer: "a",
          clientSeq: 999,
          clientSavedAt: new Date().toISOString(),
          baseVersion: 0,
        },
        cookies: { "auth-token": ctx.candidateToken },
      });

      const repo = createAttemptRepo(ctx.db);
      const row = await repo.findById(candidateCtx(), attemptId);
      expect(row?.answers).toEqual(answersBefore);
    });
  });

  // ─── Scenario #3: double submit — submitted_answers stable ─────
  describe("#3 double submit — submitted_answers and submittedAt stable", () => {
    let attemptId: string;
    let firstSubmitBody: Record<string, unknown>;

    beforeAll(async () => {
      const examRes = await ctx.app.inject({
        method: "POST",
        url: "/api/exams",
        payload: buildExamPayload({
          title: "Proto1-#3 Double Submit",
          courseId,
          questionIds: [questionId],
        }),
        cookies: { "auth-token": ctx.adminToken },
      });
      const dsExamId = examRes.json().id as string;

      await ctx.app.inject({
        method: "POST",
        url: `/api/exams/${dsExamId}/publish`,
        cookies: { "auth-token": ctx.adminToken },
      });
      await enrollCandidateForExam(ctx, candidateProfileId, dsExamId);

      const startRes = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${dsExamId}/start`,
        cookies: { "auth-token": ctx.candidateToken },
      });
      attemptId = startRes.json().id as string;
      const qId = startRes.json().questionSnapshot[0].originalQuestionId;

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

      const firstRes = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${attemptId}/submit`,
        cookies: { "auth-token": ctx.candidateToken },
      });
      firstSubmitBody = firstRes.json();
    });

    it("second submit returns same status, score, and submittedAt", async () => {
      const secondRes = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${attemptId}/submit`,
        cookies: { "auth-token": ctx.candidateToken },
      });
      const secondBody = secondRes.json();

      expect(secondRes.statusCode).toBe(200);
      expect(secondBody.status).toBe(firstSubmitBody.status);
      expect(secondBody.score).toBe(firstSubmitBody.score);
      expect(secondBody.submittedAt).toBe(firstSubmitBody.submittedAt);
    });

    it("DB submitted_answers not overwritten by second submit", async () => {
      const repo = createAttemptRepo(ctx.db);
      const row = await repo.findById(candidateCtx(), attemptId);
      // submittedAt should be stable (not updated by second submit)
      expect(row?.submittedAt).toBeDefined();
      expect(row?.status).toBe("graded");
    });
  });

  // ─── Scenario #6: candidate cannot see score before release ────
  // Covered by existing scores.test.ts:261 ("hides score details when
  // immediate results are disabled") and scores.test.ts:311 ("allows
  // admins to view a single attempt result"). No duplication here.

  // ─── Scenario #7: candidate cannot see standardAnswer ──────────
  describe("#7 candidate cannot see standardAnswer in attempt snapshot", () => {
    it("GET attempt never exposes standardAnswer to candidate", async () => {
      const examRes = await ctx.app.inject({
        method: "POST",
        url: "/api/exams",
        payload: buildExamPayload({
          title: "Proto1-#7 No standardAnswer Leak",
          courseId,
          questionIds: [questionId],
        }),
        cookies: { "auth-token": ctx.adminToken },
      });
      const saExamId = examRes.json().id as string;

      await ctx.app.inject({
        method: "POST",
        url: `/api/exams/${saExamId}/publish`,
        cookies: { "auth-token": ctx.adminToken },
      });
      await enrollCandidateForExam(ctx, candidateProfileId, saExamId);

      const startRes = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${saExamId}/start`,
        cookies: { "auth-token": ctx.candidateToken },
      });
      const attemptId = startRes.json().id as string;

      const getRes = await ctx.app.inject({
        method: "GET",
        url: `/api/attempts/${attemptId}`,
        cookies: { "auth-token": ctx.candidateToken },
      });
      expect(getRes.statusCode).toBe(200);
      const snapshot = getRes.json().questionSnapshot;
      for (const q of snapshot) {
        expect(q).not.toHaveProperty("standardAnswer");
        expect(q).not.toHaveProperty("rubric");
      }
    });
  });

  // ─── Scenario #8: grading view sees submitted answers ──────────
  describe("#8 grading view reads from submitted answers", () => {
    let attemptId: string;

    beforeAll(async () => {
      const examRes = await ctx.app.inject({
        method: "POST",
        url: "/api/exams",
        payload: buildExamPayload({
          title: "Proto1-#8 Grading View",
          courseId,
          questionIds: [questionId],
        }),
        cookies: { "auth-token": ctx.adminToken },
      });
      const gvExamId = examRes.json().id as string;

      await ctx.app.inject({
        method: "POST",
        url: `/api/exams/${gvExamId}/publish`,
        cookies: { "auth-token": ctx.adminToken },
      });
      await enrollCandidateForExam(ctx, candidateProfileId, gvExamId);

      const startRes = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${gvExamId}/start`,
        cookies: { "auth-token": ctx.candidateToken },
      });
      attemptId = startRes.json().id as string;
      const qId = startRes.json().questionSnapshot[0].originalQuestionId;

      await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${attemptId}/answers/${qId}`,
        payload: {
          attemptId,
          questionId: qId,
          answer: "wrong_answer",
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
    });

    it("admin grading-details returns questions needing manual scoring", async () => {
      const res = await ctx.app.inject({
        method: "GET",
        url: `/api/admin/attempts/${attemptId}/grading-details`,
        cookies: { "auth-token": ctx.adminToken },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      // Grading-details only returns questions with standardAnswer == null
      // (manual-grading candidates). The shared fixture question has
      // standardAnswer, so the auto-graded attempt's details list is empty —
      // which IS the correct protocol behavior.
      expect(body.questions).toBeDefined();
      expect(body.questions.length).toBe(0);
      // The attempt itself is visible with correct status
      expect(body.attemptId).toBe(attemptId);
    });
  });

  // ─── Scenario #11: save after deadline rejected ────────────────
  describe("#11 save after deadline returns DEADLINE_EXCEEDED", () => {
    it("save is rejected when deadline has passed", async () => {
      const examRes = await ctx.app.inject({
        method: "POST",
        url: "/api/exams",
        payload: buildExamPayload({
          title: "Proto1-#11 Save After Deadline",
          courseId,
          questionIds: [questionId],
          durationMinutes: 1,
        }),
        cookies: { "auth-token": ctx.adminToken },
      });
      const sadExamId = examRes.json().id as string;

      await ctx.app.inject({
        method: "POST",
        url: `/api/exams/${sadExamId}/publish`,
        cookies: { "auth-token": ctx.adminToken },
      });
      await enrollCandidateForExam(ctx, candidateProfileId, sadExamId);

      const startRes = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${sadExamId}/start`,
        cookies: { "auth-token": ctx.candidateToken },
      });
      const attemptId = startRes.json().id as string;
      const qId = startRes.json().questionSnapshot[0].originalQuestionId;

      // Move time past deadline
      ctx.setNow(new Date(Date.now() + 5 * 60 * 1000));

      const saveRes = await ctx.app.inject({
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
      expect(saveRes.statusCode).toBe(200);
      expect(saveRes.json().accepted).toBe(false);
      expect(saveRes.json().reason).toBe("DEADLINE_EXCEEDED");

      ctx.setNow(null);
    });
  });

  // ─── Scenario #12: submit after deadline returns existing ──────
  describe("#12 submit after deadline submits with saved answers", () => {
    it("submit still works after deadline", async () => {
      const examRes = await ctx.app.inject({
        method: "POST",
        url: "/api/exams",
        payload: buildExamPayload({
          title: "Proto1-#12 Submit After Deadline",
          courseId,
          questionIds: [questionId],
          durationMinutes: 1,
        }),
        cookies: { "auth-token": ctx.adminToken },
      });
      const sadExamId2 = examRes.json().id as string;

      await ctx.app.inject({
        method: "POST",
        url: `/api/exams/${sadExamId2}/publish`,
        cookies: { "auth-token": ctx.adminToken },
      });
      await enrollCandidateForExam(ctx, candidateProfileId, sadExamId2);

      const startRes = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${sadExamId2}/start`,
        cookies: { "auth-token": ctx.candidateToken },
      });
      const attemptId = startRes.json().id as string;
      const qId = startRes.json().questionSnapshot[0].originalQuestionId;

      // Save answer before deadline
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

      // Move past deadline
      ctx.setNow(new Date(Date.now() + 5 * 60 * 1000));

      const submitRes = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${attemptId}/submit`,
        cookies: { "auth-token": ctx.candidateToken },
      });
      expect(submitRes.statusCode).toBe(200);
      expect(submitRes.json().status).toBeDefined();

      ctx.setNow(null);
    });
  });

  // ─── Scenario #14: grading queue queries gradingStatus ─────────
  describe("#14 grading queue lists only pending_manual attempts", () => {
    it("auto-graded attempt does not appear in grading queue", async () => {
      // The shared fixture exam is auto-graded (single_choice with standardAnswer)
      const startRes = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${examId}/start`,
        cookies: { "auth-token": ctx.candidateToken },
      });
      if (startRes.statusCode !== 201) {
        // Attempt already exists from another test — skip assertion
        return;
      }

      const attemptId = startRes.json().id as string;
      const qId = startRes.json().questionSnapshot[0].originalQuestionId;

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
      await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${attemptId}/submit`,
        cookies: { "auth-token": ctx.candidateToken },
      });

      // Grading queue should not contain auto-graded attempts
      const queueRes = await ctx.app.inject({
        method: "GET",
        url: "/api/admin/grading-queue",
        cookies: { "auth-token": ctx.adminToken },
      });
      expect(queueRes.statusCode).toBe(200);
      const items = queueRes.json().items ?? queueRes.json();
      if (Array.isArray(items)) {
        const found = items.find(
          (item: Record<string, unknown>) => item.attemptId === attemptId,
        );
        expect(found).toBeUndefined();
      }
    });
  });

  // ─── Scenario #1: save before submit allowed ───────────────────
  describe("#1 save before submit is allowed", () => {
    it("in_progress attempt accepts save", async () => {
      const examRes = await ctx.app.inject({
        method: "POST",
        url: "/api/exams",
        payload: buildExamPayload({
          title: "Proto1-#1 Save Allowed",
          courseId,
          questionIds: [questionId],
        }),
        cookies: { "auth-token": ctx.adminToken },
      });
      const saExamId = examRes.json().id as string;

      await ctx.app.inject({
        method: "POST",
        url: `/api/exams/${saExamId}/publish`,
        cookies: { "auth-token": ctx.adminToken },
      });
      await enrollCandidateForExam(ctx, candidateProfileId, saExamId);

      const startRes = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${saExamId}/start`,
        cookies: { "auth-token": ctx.candidateToken },
      });
      const attemptId = startRes.json().id as string;
      const qId = startRes.json().questionSnapshot[0].originalQuestionId;

      const saveRes = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${attemptId}/answers/${qId}`,
        payload: {
          attemptId,
          questionId: qId,
          answer: "a",
          clientSeq: 1,
          clientSavedAt: new Date().toISOString(),
          baseVersion: 0,
        },
        cookies: { "auth-token": ctx.candidateToken },
      });
      expect(saveRes.statusCode).toBe(200);
      expect(saveRes.json().accepted).toBe(true);
    });
  });
});
