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
import { gradeQuestion, lockEnrollmentAndAttempt } from "@exam/exam-engine";
import { createAttemptRepo } from "@exam/db/src/repository/attemptRepo.js";
import { createAttemptGradingEntryRepo } from "@exam/db/src/repository/attemptGradingEntryRepo.js";
import { createEnrollmentRepo } from "@exam/db/src/repository/enrollmentRepo.js";
import { createExamRepo } from "@exam/db/src/repository/examRepo.js";
import { createGradingQueueRepo } from "@exam/db/src/repository/gradingQueueRepo.js";
import { executeInTransaction } from "@exam/db/src/types.js";
import {
  createExamEngineRepos,
  createGradingWorksetRepoAdapter,
} from "../adapters/repoAdapters.js";
import {
  ensureTargetOrg,
  formatZodError,
  getRequestContext,
} from "./helpers.js";
import { cookieAuth } from "./attempts.shared.js";
import { resolveGraderExamScope } from "./graderScope.js";
import { Permission } from "@exam/authz";
import {
  recordAtomicHttpAudit,
  recordSensitiveReadAudit,
} from "../audit/auditWriter.js";

/**
 * Registers the admin manual-grading queue routes (P2D-J3 / P3-L0-2E Slice 3):
 * - GET  /admin/grading-queue
 * - GET  /admin/attempts/:attemptId/grading-details
 * - POST /admin/attempts/:attemptId/grade-question
 *
 * Admin is org-wide. Issue #296: Grader actors are assignment-scoped — the
 * queue LIST filters to their active grader_exam_assignments exams in SQL
 * BEFORE pagination and total count, and grading detail/write additionally
 * require an active assignment on the attempt's exam (graderAccess gate,
 * missing assignment → 404 anti-enumeration). Handlers mirror
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
        "x-role": ["Admin", "Grader"],
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

      // Issue #296: non-Admin actors (Grader) see only their assigned exams.
      // Resolved fresh per request; an empty scope means zero rows + zero
      // total BY CONTRACT. The scope intersects any examId query filter, and
      // list + count receive the SAME filter so pagination totals agree.
      const scope = await resolveGraderExamScope(fastify.db, ctx);
      const scopedFilter = scope
        ? examId
          ? scope.includes(examId)
            ? [examId]
            : []
          : scope
        : null;
      const [rows, total] = await Promise.all([
        entryRepo.listPendingManualQueue(ctx, {
          ...(scopedFilter !== null
            ? { examIds: scopedFilter }
            : examId
              ? { examId }
              : {}),
          limit: pageSize,
          offset,
        }),
        entryRepo.countPendingManualQueue(
          ctx,
          scopedFilter !== null
            ? { examIds: scopedFilter }
            : examId
              ? { examId }
              : {},
        ),
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
        fastify.requireScopedCapability(
          Permission.GradingDetailView,
          "attempt",
          "attemptId",
          // Issue #296: non-Admin actors must hold an active Grader-to-Exam
          // assignment to the attempt's exam (attempt→exam chain node).
          { graderAccess: "exam_assignment_scoped" },
        ),
      ],
      schema: {
        params: AttemptIdParamsSchema,
        security: cookieAuth,
        "x-role": ["Admin", "Grader"],
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
            // Frozen grading metadata from QuestionSnapshot (never JOIN live
            // questions). standardAnswer is the applicable reference answer;
            // rubric is the frozen scoring guide for text_response questions.
            standardAnswer: q.standardAnswer ?? null,
            rubric: q.rubric ?? null,
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
      await recordSensitiveReadAudit(fastify.db, request, ctx, {
        action: "grading.detail_viewed",
        targetType: "attempt",
        targetId: attemptId,
        metadata: {
          examId: attempt.examId,
          candidateId: attempt.candidateId,
        },
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
        fastify.requireScopedCapability(
          Permission.GradingScoreWrite,
          "attempt",
          "attemptId",
          // Issue #296: non-Admin actors must hold an active Grader-to-Exam
          // assignment to the attempt's exam (attempt→exam chain node).
          { graderAccess: "exam_assignment_scoped" },
        ),
      ],
      schema: {
        params: AttemptIdParamsSchema,
        body: GradeQuestionRequestSchema,
        security: cookieAuth,
        "x-role": ["Admin", "Grader"],
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

      // Load the exam for the terminal closure (P3-FORMAL-P0-A): gradeQuestion
      // now delegates terminal projection to finalizeTerminalGrading, which
      // needs the full Exam (passingScore, scoreStrategy, retakePolicy, etc.).
      const gradingQueueRepo = createGradingQueueRepo(fastify.db);
      const exam = await gradingQueueRepo.findExamById(ctx, preAttempt.examId);
      if (!exam) {
        throw new NotFoundError("Attempt grading context not found");
      }

      // P3-FORMAL-P0-D2: the pre-tx enrollment pre-fetch that previously fed
      // `enrollmentId` into gradeQuestion is removed. The capability minted
      // inside the transaction carries enrollment identity (proven by the
      // canonical seam), so gradeQuestion + finalizeTerminalGrading no longer
      // take an enrollmentId argument.

      const result = await executeInTransaction(fastify.db, async (tx) => {
        // P3-FORMAL-P0-D2: build the engine repo pair once, mint the EA
        // capability via the canonical seam, and thread the SAME instances +
        // capability into gradeQuestion → finalizeTerminalGrading. Switched
        // from granular adapters to createExamEngineRepos so one object pair
        // flows from mint to consumer (HR-6: exact repo object identity).
        const txAttemptRepo = createAttemptRepo(tx);
        const txEnrollmentRepo = createEnrollmentRepo(tx);
        const txEntryRepo = createAttemptGradingEntryRepo(tx);
        const { enrollments, attempts } = createExamEngineRepos(
          {
            examRepo: createExamRepo(tx),
            attemptRepo: txAttemptRepo,
            enrollmentRepo: txEnrollmentRepo,
          },
          ctx,
        );
        const cap = await lockEnrollmentAndAttempt(
          enrollments,
          attempts,
          attemptId,
        );
        const graded = await gradeQuestion(
          attempts,
          enrollments,
          createGradingWorksetRepoAdapter(txEntryRepo, ctx),
          cap,
          questionId,
          score,
          comment,
          ctx.actorId,
          now,
          // The DB-layer findExamById returns the raw Drizzle row (status:
          // string); gradeQuestion's canonical closure expects the domain Exam
          // type (status: ExamStatus). The row IS a valid Exam at runtime
          // (Postgres enums map 1:1); the cast narrows the string-literal type
          // for TypeScript. Mirrors how other engine callers bridge DB rows to
          // the domain type.
          exam as unknown as import("@exam/domain").Exam,
        );
        await recordAtomicHttpAudit(tx, request, ctx, {
          action: "grading.score_entered",
          targetType: "attempt",
          targetId: attemptId,
          metadata: {
            questionId,
            score,
            maxScore,
            previousScore,
            graderId: ctx.actorId,
          },
        });
        if (graded.fullyGraded) {
          await recordAtomicHttpAudit(tx, request, ctx, {
            action: "grading.finalized",
            targetType: "attempt",
            targetId: attemptId,
            metadata: {
              gradingStatus: "fully_graded",
              graderId: ctx.actorId,
            },
          });
        }
        return graded;
      });

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
