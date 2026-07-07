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
import { createAttemptGradingEntryRepo } from "@exam/db/src/repository/attemptGradingEntryRepo.js";
import { createGradingQueueRepo } from "@exam/db/src/repository/gradingQueueRepo.js";
import { createAuditLogRepo } from "@exam/db/src/repository/auditLogRepo.js";
import { executeInTransaction } from "@exam/db/src/types.js";
import type { Database } from "@exam/db/src/types.js";
import {
  createAttemptRepoAdapter,
  createGradingWorksetRepoAdapter,
} from "../adapters/repoAdapters.js";
import {
  ensureTargetOrg,
  formatZodError,
  getRequestContext,
} from "./helpers.js";
import { cookieAuth } from "./attempts.shared.js";
import { Permission } from "@exam/authz";
import { recordAudit } from "./audit.js";

/**
 * Registers the admin manual-grading queue routes (P2D-J3 / P3-L0-2E Slice 3):
 * - GET  /admin/grading-queue
 * - GET  /admin/attempts/:attemptId/grading-details
 * - POST /admin/attempts/:attemptId/grade-question
 *
 * All routes are Admin-only (RBAC + organization boundary). Handlers mirror
 * attempts.admin.ts: validate -> ensureTargetOrg -> command/repo -> audit.
 *
 * Slice 3 ownership: the manual grading queue, grading-details view, and
 * manual-score write path are ALL sourced from the durable
 * `attempt_grading_entries` workset. The queue reads
 * `WHERE grading_mode='manual' AND status='pending_manual'`; manual scoring
 * flips `pending_manual → completed_manual` on the SAME entry; the public
 * response shape is preserved as a presentation projection over those entries.
 */
export async function registerGradingQueueRoutes(fastify: FastifyInstance) {
  /**
   * GET /admin/grading-queue - lists attempts that have at least one pending
   * manual grading entry, with pagination and optional exam filter.
   *
   * Slice 3: the work source is `attempt_grading_entries` filtered to
   * `grading_mode='manual' AND status='pending_manual'`, NOT
   * `exam_attempts.gradingStatus` or any `questionSnapshot` rescan. Attempt
   * lifecycle state alone cannot fabricate queue work.
   */
  fastify.get(
    "/admin/grading-queue",
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireCapability(Permission.GradingQueueView),
      ],
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
      const entryRepo = createAttemptGradingEntryRepo(fastify.db);
      const offset = (page - 1) * pageSize;
      const [rows, total] = await Promise.all([
        entryRepo.listPendingManualQueue(ctx, {
          ...(examId ? { examId } : {}),
          limit: pageSize,
          offset,
        }),
        entryRepo.countPendingManualQueue(ctx, examId ? { examId } : {}),
      ]);

      // Presentation projection: each attempt-level row carries its
      // authoritative pending-manual entry count (count(attempt_grading_entries.id)
      // from the repo). No questionSnapshot rescan, no standardAnswer heuristic.
      const items = rows.map((r) => ({
        attemptId: r.attempt.id,
        examId: r.exam.id,
        examTitle: r.exam.title,
        candidateId: r.candidateProfile.id,
        candidateName: r.candidateUser.name,
        submittedAt: r.attempt.submittedAt
          ? r.attempt.submittedAt.toISOString()
          : null,
        gradingStatus: r.attempt.gradingStatus ?? "auto_graded",
        pendingQuestionCount: r.pendingCount,
      }));

      return reply.send({ items, total, page, pageSize });
    },
  );

  /**
   * GET /admin/attempts/:attemptId/grading-details - returns the attempt's
   * manual-mode questions with their current grading-entry state.
   *
   * Slice 3: the question universe is projected from the frozen
   * `questionSnapshot` (presentation only — content/type/maxScore/expected
   * question IDs). The per-question grading state and candidate answer come
   * from the authoritative `attempt_grading_entries` rows, NOT from a legacy
   * manual-score table.
   */
  fastify.get(
    "/admin/attempts/:attemptId/grading-details",
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireCapability(Permission.GradingDetailView),
      ],
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
      const entryRepo = createAttemptGradingEntryRepo(fastify.db);
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

      // Authoritative per-question grading state. Keyed by questionId — the
      // entry's `candidateAnswer` is the frozen submitted answer (identical to
      // `submittedAnswers`), so we read display data from the entry.
      const entries = await entryRepo.findByAttempt(ctx, attemptId);
      const entryByQuestion = new Map(entries.map((e) => [e.questionId, e]));
      const questions = attempt.questionSnapshot
        .filter((q) => entryByQuestion.has(q.originalQuestionId))
        .filter(
          (q) =>
            entryByQuestion.get(q.originalQuestionId)?.gradingMode === "manual",
        )
        .map((q) => {
          const entry = entryByQuestion.get(q.originalQuestionId)!;
          return {
            questionId: q.originalQuestionId,
            type: q.type,
            content: q.content,
            maxScore: q.score,
            candidateAnswer: entry.candidateAnswer ?? null,
            entry:
              entry.status === "completed_manual"
                ? {
                    score: entry.earnedScore ?? 0,
                    comment: entry.comment,
                    gradedBy: entry.gradedBy ?? "",
                    gradedAt: (entry.gradedAt ?? new Date(0)).toISOString(),
                  }
                : null,
          };
        });

      // AUDIT-M2: sensitive read of candidate answers / grading detail. Audit
      // the FACT of access only — metadata carries opaque ids, never the
      // candidateAnswer payload (ADR sec.3.8).
      recordAudit(
        fastify,
        request,
        ctx,
        "grading.detail_viewed",
        "attempt",
        attemptId,
        {
          examId: attempt.examId,
          candidateId: attempt.candidateId,
        },
      );

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
   *
   * Slice 3: the command updates the SAME `attempt_grading_entries` row that
   * the freeze barrier materialized (pending_manual → completed_manual). It
   * fails closed when no entry exists and rejects attempts to score an
   * auto-graded entry. The route pre-fetches attempt/exam metadata for audit
   * only; the authoritative maxScore and entry lookup live in the command.
   */
  fastify.post(
    "/admin/attempts/:attemptId/grade-question",
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireCapability(Permission.GradingScoreWrite),
      ],
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

      // Pre-fetch the attempt + grading entry for audit metadata only. The
      // authoritative maxScore/previousScore come from the frozen workset.
      const attemptRepo = createAttemptRepo(fastify.db);
      const entryRepo = createAttemptGradingEntryRepo(fastify.db);
      const preAttempt = await attemptRepo.findById(ctx, attemptId);
      if (!preAttempt) {
        throw new NotFoundError("Attempt grading context not found");
      }
      const preEntry = await entryRepo.findByAttemptAndQuestion(
        ctx,
        attemptId,
        questionId,
      );
      const maxScore = preEntry?.maxScore ?? 0;
      const previousScore = preEntry?.earnedScore ?? null;

      // Load the exam to read passingScore for manual-score reconciliation.
      const gradingQueueRepo = createGradingQueueRepo(fastify.db);
      const exam = await gradingQueueRepo.findExamById(ctx, preAttempt.examId);
      if (!exam) {
        throw new NotFoundError("Attempt grading context not found");
      }
      const passingScore = exam.passingScore;

      const result = await executeInTransaction(fastify.db, async (tx) => {
        const txAttemptRepo = createAttemptRepo(tx);
        const txEntryRepo = createAttemptGradingEntryRepo(tx);
        // Lock the attempt row for the duration of the grade (§17).
        await txAttemptRepo.findByIdForUpdate(ctx, attemptId);
        return gradeQuestion(
          createAttemptRepoAdapter(txAttemptRepo, ctx),
          createGradingWorksetRepoAdapter(txEntryRepo, ctx),
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
