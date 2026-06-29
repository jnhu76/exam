import type { FastifyInstance } from "fastify";
import {
  AttemptIdParamsSchema,
  ErrorResponseSchema,
  GradingDetailsResponseSchema,
  GradingQueueListQuerySchema,
  GradingQueueListResponseSchema,
  GradeQuestionRequestSchema,
  GradeQuestionResponseSchema,
} from "@exam/contracts";
import type { RequestContext } from "@exam/domain";
import { NotFoundError } from "@exam/domain";
import { gradeQuestion } from "@exam/exam-engine";
import { createAttemptRepo } from "@exam/db/src/repository/attemptRepo.js";
import { createManualGradingRepo } from "@exam/db/src/repository/manualGradingRepo.js";
import { createGradingQueueRepo } from "@exam/db/src/repository/gradingQueueRepo.js";
import { createAuditLogRepo } from "@exam/db/src/repository/auditLogRepo.js";
import { executeInTransaction } from "@exam/db/src/types.js";
import type { Database } from "@exam/db/src/types.js";
import {
  createAttemptRepoAdapter,
  createManualGradingRepoAdapter,
} from "../adapters/repoAdapters.js";
import {
  ensureTargetOrg,
  formatZodError,
  getRequestContext,
} from "./helpers.js";
import { cookieAuth } from "./attempts.shared.js";

/**
 * Registers the admin manual-grading queue routes (P2D-J3):
 * - GET  /admin/grading-queue
 * - GET  /admin/attempts/:attemptId/grading-details
 * - POST /admin/attempts/:attemptId/grade-question
 *
 * All routes are Admin-only (RBAC + organization boundary). Handlers mirror
 * attempts.admin.ts: validate -> ensureTargetOrg -> command/repo -> audit.
 */
export async function registerGradingQueueRoutes(fastify: FastifyInstance) {
  /**
   * GET /admin/grading-queue - lists attempts awaiting manual scoring
   * (gradingStatus = pending_manual), with pagination and optional exam filter.
   */
  fastify.get(
    "/admin/grading-queue",
    {
      preHandler: [fastify.authenticate, fastify.requireRole(["Admin"])],
      schema: {
        querystring: GradingQueueListQuerySchema,
        security: cookieAuth,
        "x-role": ["Admin"],
        response: {
          200: GradingQueueListResponseSchema,
          400: ErrorResponseSchema,
          403: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const ctx = ensureTargetOrg(getRequestContext(request));
      const parsed = GradingQueueListQuerySchema.safeParse(request.query ?? {});
      if (!parsed.success) {
        return reply.code(400).send(formatZodError(request.id, parsed.error));
      }
      const { page, pageSize, examId } = parsed.data;
      const attemptRepo = createAttemptRepo(fastify.db);
      const offset = (page - 1) * pageSize;
      const [rows, total] = await Promise.all([
        attemptRepo.listPendingManual(ctx, {
          ...(examId ? { examId } : {}),
          limit: pageSize,
          offset,
        }),
        attemptRepo.countPendingManual(ctx, examId ? { examId } : {}),
      ]);

      const items = rows.map((r) => {
        // Subjective question count comes from the snapshot; scored count from
        // the joined manual_grading_entries.
        const subjectiveCount = r.attempt.questionSnapshot.filter(
          (q) => q.standardAnswer == null,
        ).length;
        const pendingQuestionCount = Math.max(
          0,
          subjectiveCount - r.scoredCount,
        );
        return {
          attemptId: r.attempt.id,
          examId: r.exam.id,
          examTitle: r.exam.title,
          candidateId: r.candidateProfile.id,
          candidateName: r.candidateUser.name,
          submittedAt: r.attempt.submittedAt
            ? r.attempt.submittedAt.toISOString()
            : null,
          gradingStatus: r.attempt.gradingStatus ?? "auto_graded",
          pendingQuestionCount,
        };
      });

      return reply.send({ items, total, page, pageSize });
    },
  );

  /**
   * GET /admin/attempts/:attemptId/grading-details - returns the attempt's
   * subjective questions with their current manual-grading state.
   */
  fastify.get(
    "/admin/attempts/:attemptId/grading-details",
    {
      preHandler: [fastify.authenticate, fastify.requireRole(["Admin"])],
      schema: {
        params: AttemptIdParamsSchema,
        security: cookieAuth,
        "x-role": ["Admin"],
        response: {
          200: GradingDetailsResponseSchema,
          400: ErrorResponseSchema,
          403: ErrorResponseSchema,
          404: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const params = AttemptIdParamsSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send(formatZodError(request.id, params.error));
      }
      const ctx = ensureTargetOrg(getRequestContext(request));
      const { attemptId } = params.data;

      const attemptRepo = createAttemptRepo(fastify.db);
      const manualGradingRepo = createManualGradingRepo(fastify.db);
      const gradingQueueRepo = createGradingQueueRepo(fastify.db);

      const attempt = await attemptRepo.findById(ctx, attemptId);
      if (!attempt) {
        throw new NotFoundError("Attempt not found");
      }
      // Load exam + candidate identity for display.
      const exam = await gradingQueueRepo.findExamById(ctx, attempt.examId);
      const candidate = await gradingQueueRepo.findCandidateWithUser(
        ctx,
        attempt.candidateId,
      );
      if (!exam || !candidate) {
        throw new NotFoundError("Attempt grading context not found");
      }

      const entries = await manualGradingRepo.findByAttempt(ctx, attemptId);
      const entryByQuestion = new Map(entries.map((e) => [e.questionId, e]));
      const answerByQuestion = new Map(
        attempt.answers.map((a) => [a.questionId, a.answer]),
      );
      const questions = attempt.questionSnapshot
        .filter((q) => q.standardAnswer == null)
        .map((q) => {
          const entry = entryByQuestion.get(q.originalQuestionId);
          return {
            questionId: q.originalQuestionId,
            type: q.type,
            content: q.content,
            maxScore: q.score,
            candidateAnswer: answerByQuestion.has(q.originalQuestionId)
              ? (answerByQuestion.get(q.originalQuestionId) ?? null)
              : null,
            entry: entry
              ? {
                  score: entry.score,
                  comment: entry.comment,
                  gradedBy: entry.gradedBy,
                  gradedAt: entry.gradedAt.toISOString(),
                }
              : null,
          };
        });

      return reply.send({
        attemptId: attempt.id,
        examId: attempt.examId,
        examTitle: exam.title,
        candidateId: candidate.profile.id,
        candidateName: candidate.user.name,
        gradingStatus: attempt.gradingStatus ?? "auto_graded",
        questions,
      });
    },
  );

  /**
   * POST /admin/attempts/:attemptId/grade-question - saves (or overwrites)
   * one manual grading entry. Transactional with a row lock on the attempt.
   * Audit: grading.score_entered.
   */
  fastify.post(
    "/admin/attempts/:attemptId/grade-question",
    {
      preHandler: [fastify.authenticate, fastify.requireRole(["Admin"])],
      schema: {
        params: AttemptIdParamsSchema,
        body: GradeQuestionRequestSchema,
        security: cookieAuth,
        "x-role": ["Admin"],
        response: {
          200: GradeQuestionResponseSchema,
          400: ErrorResponseSchema,
          403: ErrorResponseSchema,
          404: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const params = AttemptIdParamsSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send(formatZodError(request.id, params.error));
      }
      const body = GradeQuestionRequestSchema.safeParse(request.body ?? {});
      if (!body.success) {
        return reply.code(400).send(formatZodError(request.id, body.error));
      }
      const ctx = ensureTargetOrg(getRequestContext(request));
      const { attemptId } = params.data;
      const { questionId, score, comment } = body.data;
      const now = fastify.now();

      // Pre-fetch the attempt to read maxScore and previousScore for audit metadata.
      const attemptRepo = createAttemptRepo(fastify.db);
      const preAttempt = await attemptRepo.findById(ctx, attemptId);
      const questionSnapshot = preAttempt?.questionSnapshot;
      const targetQuestion = questionSnapshot?.find(
        (q) => q.originalQuestionId === questionId,
      );
      const maxScore = targetQuestion?.score ?? 0;

      // Load the exam to read passingScore for manual-score reconciliation
      // (the attempt total is recomputed as objective + manual on full grading).
      const gradingQueueRepo = createGradingQueueRepo(fastify.db);
      const exam = preAttempt
        ? await gradingQueueRepo.findExamById(ctx, preAttempt.examId)
        : null;
      if (!preAttempt || !exam) {
        throw new NotFoundError("Attempt grading context not found");
      }
      const passingScore = exam.passingScore;

      const manualGradingRepo = createManualGradingRepo(fastify.db);
      const existingEntries = await manualGradingRepo.findByAttempt(
        ctx,
        attemptId,
      );
      const previousEntry = existingEntries.find(
        (e) => e.questionId === questionId,
      );
      const previousScore = previousEntry?.score ?? null;

      const result = await executeInTransaction(fastify.db, async (tx) => {
        const txAttemptRepo = createAttemptRepo(tx);
        const txManualGradingRepo = createManualGradingRepo(tx);
        // Lock the attempt row for the duration of the grade (§17).
        await txAttemptRepo.findByIdForUpdate(ctx, attemptId);
        return gradeQuestion(
          createAttemptRepoAdapter(txAttemptRepo, ctx),
          createManualGradingRepoAdapter(txManualGradingRepo, ctx),
          attemptId,
          questionId,
          score,
          comment,
          ctx.actorId,
          now,
          passingScore,
        );
      });

      // Audit is awaited + best-effort (deterministic for tests).
      try {
        await createAuditLogRepo(fastify.db as Database).create(ctx, {
          actorId: ctx.actorId,
          action: "grading.score_entered",
          targetType: "attempt",
          targetId: attemptId,
          metadata: {
            requestId: request.id,
            questionId,
            score,
            maxScore,
            previousScore,
            graderId: ctx.actorId,
          },
        });
      } catch (err) {
        request.log.error(
          {
            err,
            attemptId,
            questionId,
            action: "grading.score_entered",
          },
          "Failed to record manual-grading audit",
        );
      }

      // Record grading.finalized when the attempt becomes fully_graded.
      if (result.fullyGraded) {
        try {
          await createAuditLogRepo(fastify.db as Database).create(ctx, {
            actorId: ctx.actorId,
            action: "grading.finalized",
            targetType: "attempt",
            targetId: attemptId,
            metadata: {
              requestId: request.id,
              gradingStatus: "fully_graded",
              graderId: ctx.actorId,
            },
          });
        } catch (err) {
          request.log.error(
            {
              err,
              attemptId,
              action: "grading.finalized",
            },
            "Failed to record grading-finalized audit",
          );
        }
      }

      return reply.send({
        attemptId,
        gradingStatus: result.gradingStatus ?? "auto_graded",
        questionId,
        score,
        fullyGraded: result.fullyGraded,
        ...(result.totalScore != null ? { totalScore: result.totalScore } : {}),
        ...(result.passed != null ? { passed: result.passed } : {}),
      });
    },
  );
}
