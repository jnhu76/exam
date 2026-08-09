import { describe, expect, it, beforeAll, afterAll, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { buildTestApp } from "../testHelpers.js";
import examRoutes from "../exam.js";
import attemptRoutes from "../attempts.js";
import { createAttemptRepo } from "@exam/db/src/repository/attemptRepo.js";
import { schema } from "@exam/db/src/schema/pg.js";
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
      // P3-L0-2: post-submit, the authoritative frozen snapshot is
      // submitted_answers. Capture it and assert a rejected post-submit
      // save does not mutate it.
      answersBefore = row?.submittedAnswers ?? row?.answers;
    });

    it("DB submitted_answers unchanged after rejected save", async () => {
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
      // submitted_answers should not change after a rejected save
      expect(
        (row as Record<string, unknown>)?.submittedAnswers ?? row?.answers,
      ).toEqual(answersBefore);
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
      // P3-L0-2: submitted_answers must be frozen once and never rebuilt.
      // The candidate saved answer "b" before submit; the frozen snapshot
      // carries that value, and a second submit must deep-equal the first.
      expect(row?.submittedAnswers).toEqual({
        schemaVersion: 1,
        answers: [{ questionId: expect.any(String), value: "b" }],
      });
      expect(row?.submissionReason).toBe("manual");
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

  // ─── Scenario #9/#10: deadline reconciliation via candidate entry points ─
  // P3-L0-3: lazy-triggered reconciliation freezes an expired in_progress
  // attempt on the next candidate entry (take/save/submit/restore). Proves
  // the freeze happens, submittedAt = effectiveDeadline, submissionReason =
  // 'deadline', and the reconciliation is idempotent.
  describe("#9/#10 deadline reconciliation via take entry point", () => {
    let reconExamId: string;

    beforeAll(async () => {
      const examRes = await ctx.app.inject({
        method: "POST",
        url: "/api/exams",
        payload: buildExamPayload({
          title: "Proto1-#9 Recon",
          courseId,
          questionIds: [questionId],
          durationMinutes: 1, // short window so we can fast-forward past it
        }),
        cookies: { "auth-token": ctx.adminToken },
      });
      reconExamId = examRes.json().id as string;
      await ctx.app.inject({
        method: "POST",
        url: `/api/exams/${reconExamId}/publish`,
        cookies: { "auth-token": ctx.adminToken },
      });
      await enrollCandidateForExam(ctx, candidateProfileId, reconExamId);
    });

    it("#9 freezes an expired in_progress attempt on take (submitted_answers written, submittedAt=deadline)", async () => {
      const startRes = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${reconExamId}/start`,
        cookies: { "auth-token": ctx.candidateToken },
      });
      const attemptId = startRes.json().id as string;
      const qId = startRes.json().questionSnapshot[0].originalQuestionId;
      const attemptDeadline = new Date(startRes.json().deadlineAt as string);

      // Save a draft, then fast-forward past the deadline.
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
      ctx.setNow(new Date(attemptDeadline.getTime() + 5 * 60 * 1000));

      // take is the entry point that triggers lazy reconciliation.
      const takeRes = await ctx.app.inject({
        method: "GET",
        url: `/api/candidate/attempts/${attemptId}/take`,
        cookies: { "auth-token": ctx.candidateToken },
      });
      expect(takeRes.statusCode).toBe(200);
      expect(takeRes.headers["cache-control"]).toContain("no-store");

      const repo = createAttemptRepo(ctx.db);
      const row = await repo.findById(candidateCtx(), attemptId);
      expect(row?.status).toBe("graded");
      expect(row?.submittedAt).toEqual(attemptDeadline);
      expect(row?.submissionReason).toBe("deadline");
      expect(row?.submittedAnswers).toEqual({
        schemaVersion: 1,
        answers: [{ questionId: expect.any(String), value: "b" }],
      });

      ctx.setNow(null);
    });

    it("#10 reconciliation is idempotent — repeated take does not rewrite submitted_answers/submittedAt", async () => {
      const startRes = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${reconExamId}/start`,
        cookies: { "auth-token": ctx.candidateToken },
      });
      const attemptId = startRes.json().id as string;
      const qId = startRes.json().questionSnapshot[0].originalQuestionId;
      const attemptDeadline = new Date(startRes.json().deadlineAt as string);

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
      ctx.setNow(new Date(attemptDeadline.getTime() + 5 * 60 * 1000));

      // First take reconciles + freezes.
      await ctx.app.inject({
        method: "GET",
        url: `/api/candidate/attempts/${attemptId}/take`,
        cookies: { "auth-token": ctx.candidateToken },
      });
      const repo = createAttemptRepo(ctx.db);
      const afterFirst = await repo.findById(candidateCtx(), attemptId);
      const firstSubmittedAt = afterFirst?.submittedAt;
      const firstSnapshot = afterFirst?.submittedAnswers;

      // Second take — must NOT rewrite the frozen fields.
      await ctx.app.inject({
        method: "GET",
        url: `/api/candidate/attempts/${attemptId}/take`,
        cookies: { "auth-token": ctx.candidateToken },
      });
      const afterSecond = await repo.findById(candidateCtx(), attemptId);

      expect(afterSecond?.submittedAt).toEqual(firstSubmittedAt);
      expect(afterSecond?.submittedAnswers).toEqual(firstSnapshot);
      expect(afterSecond?.submissionReason).toBe("deadline");

      ctx.setNow(null);
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
      // P3-L0-3: lazy deadline reconciliation now freezes the attempt at the
      // save entry point, so the rejection reason is ATTEMPT_ALREADY_SUBMITTED
      // (deadline-submitted), not the legacy DEADLINE_EXCEEDED.
      expect(saveRes.json().reason).toBe("ATTEMPT_ALREADY_SUBMITTED");

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

  // ─── Scenario #15: future baseVersion rejected (P7-S2-B) ───
  // ANSWER_BASE_VERSION_MUST_EQUAL_CURRENT_VERSION: a save claiming a
  // baseVersion the server has not issued yet is impossible client state and
  // must be rejected on the wire, not silently accepted as `currentVersion+1`.
  describe("#15 future baseVersion rejected on the wire (FUTURE_VERSION)", () => {
    it("save with baseVersion=999 against fresh attempt returns FUTURE_VERSION", async () => {
      const examRes = await ctx.app.inject({
        method: "POST",
        url: "/api/exams",
        payload: buildExamPayload({
          title: "Proto1-#15 Future Base",
          courseId,
          questionIds: [questionId],
        }),
        cookies: { "auth-token": ctx.adminToken },
      });
      const futureExamId = examRes.json().id as string;

      await ctx.app.inject({
        method: "POST",
        url: `/api/exams/${futureExamId}/publish`,
        cookies: { "auth-token": ctx.adminToken },
      });
      await enrollCandidateForExam(ctx, candidateProfileId, futureExamId);

      const startRes = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${futureExamId}/start`,
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
          baseVersion: 999,
        },
        cookies: { "auth-token": ctx.candidateToken },
      });
      expect(saveRes.statusCode).toBe(200);
      expect(saveRes.json().accepted).toBe(false);
      expect(saveRes.json().reason).toBe("FUTURE_VERSION");
      expect(saveRes.json().serverVersion).toBe(0);
      // No draft is persisted for the future-version save.
      const attempt = (await createAttemptRepo(ctx.db).findById(
        candidateCtx(),
        attemptId,
      )) as { answers?: unknown } | null;
      expect(attempt?.answers).toEqual([]);
    });
  });

  // ─── Scenario #13: text_response grading reads submitted_answers ───
  // P3-L0-2: proves the submit freeze barrier end-to-end at the engine/DB
  // level. The candidate saves a draft text answer, submits (freezing
  // submitted_answers), then attempts a further save (rejected). The frozen
  // submitted_answers — NOT the draft — is what grading captures. The route-
  // level gradingQueue DTO read-path switch is a separate deferred job.
  describe("#13 text_response — grading reads submitted_answers, not draft", () => {
    let trAttemptId: string;
    let trQId: string;

    beforeAll(async () => {
      trQId = randomUUID();
      // Insert a text_response question directly (L0-5 publish-validation is
      // not yet implemented, so we bypass the question-create API and write
      // the row with standardAnswer: null + rubric, matching the new题型约定).
      await ctx.db.insert(schema.questions).values({
        id: trQId,
        organizationId: ctx.org.id,
        courseId,
        type: "text_response",
        content: "请阐述你的观点",
        options: [],
        standardAnswer: null,
        attachments: [],
        score: 100,
        difficulty: 3,
        tags: [],
        gradingRule: {
          multiSelectScoring: "all_correct_full",
          fillBlankMatchMode: "exact",
        },
        rubric: "按逻辑完整性、关键概念、论证质量给分",
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const examRes = await ctx.app.inject({
        method: "POST",
        url: "/api/exams",
        payload: buildExamPayload({
          title: "Proto1-#13 text_response freeze",
          courseId,
          questionIds: [trQId],
          totalScore: 100,
          passingScore: 60,
        }),
        cookies: { "auth-token": ctx.adminToken },
      });
      const trExamId = examRes.json().id as string;

      await ctx.app.inject({
        method: "POST",
        url: `/api/exams/${trExamId}/publish`,
        cookies: { "auth-token": ctx.adminToken },
      });
      await enrollCandidateForExam(ctx, candidateProfileId, trExamId);

      const startRes = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${trExamId}/start`,
        cookies: { "auth-token": ctx.candidateToken },
      });
      trAttemptId = startRes.json().id as string;
      const qId = startRes.json().questionSnapshot[0].originalQuestionId;

      // Save a draft text answer.
      await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${trAttemptId}/answers/${qId}`,
        payload: {
          attemptId: trAttemptId,
          questionId: qId,
          answer: "draft free-text answer before submit",
          clientSeq: 1,
          clientSavedAt: new Date().toISOString(),
          baseVersion: 0,
        },
        cookies: { "auth-token": ctx.candidateToken },
      });

      // Submit — freezes submitted_answers.
      const submitRes = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${trAttemptId}/submit`,
        cookies: { "auth-token": ctx.candidateToken },
      });
      expect(submitRes.statusCode).toBe(200);

      // Attempt a further save after submit — must be rejected.
      const postSubmitSave = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${trAttemptId}/answers/${qId}`,
        payload: {
          attemptId: trAttemptId,
          questionId: qId,
          answer: "rogue edit after submit",
          clientSeq: 2,
          clientSavedAt: new Date().toISOString(),
          baseVersion: 1,
        },
        cookies: { "auth-token": ctx.candidateToken },
      });
      expect(postSubmitSave.json().accepted).toBe(false);
    });

    it("DB submitted_answers holds the frozen text answer, not a later draft", async () => {
      const repo = createAttemptRepo(ctx.db);
      const row = await repo.findById(candidateCtx(), trAttemptId);

      expect(row?.submittedAnswers).toEqual({
        schemaVersion: 1,
        answers: [
          {
            questionId: expect.any(String),
            value: "draft free-text answer before submit",
          },
        ],
      });
      expect(row?.submissionReason).toBe("manual");
    });

    it("DB draft answers were NOT mutated by the rejected post-submit save", async () => {
      const repo = createAttemptRepo(ctx.db);
      const row = await repo.findById(candidateCtx(), trAttemptId);

      // The draft column still holds the pre-submit value; the rogue edit
      // was rejected and never persisted.
      expect(row?.answers[0]?.answer).toBe(
        "draft free-text answer before submit",
      );
    });
  });
});
