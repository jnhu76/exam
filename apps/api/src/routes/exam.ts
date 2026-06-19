import {
  FastifyPluginAsync,
  type FastifyRequest,
  type FastifyReply,
} from "fastify";
import { z } from "zod";
import {
  CreateExamRequestSchema,
  UpdateExamRequestSchema,
  PaginationParamsSchema,
  EnrollCandidatesRequestSchema,
  ExamSchema,
  ErrorResponseSchema,
} from "@exam/contracts";
import { createExamRepo } from "@exam/db/src/repository/examRepo.js";
import { createQuestionRepo } from "@exam/db/src/repository/questionRepo.js";
import { createCourseRepo } from "@exam/db/src/repository/courseRepo.js";
import { createEnrollmentRepo } from "@exam/db/src/repository/enrollmentRepo.js";
import { createCandidateRepo } from "@exam/db/src/repository/candidateRepo.js";
import { createUserRepo } from "@exam/db/src/repository/userRepo.js";
import { createAttemptRepo } from "@exam/db/src/repository/attemptRepo.js";
import { executeInTransaction } from "@exam/db/src/types.js";
import type { Database } from "@exam/db/src/types.js";
import {
  archiveExam,
  closeExam,
  cancelExam,
  unpublishExam,
  extendExam,
  checkAndUpdateExamStatus,
  publishExam,
  type ExamRepository,
} from "@exam/exam-engine";
import type { RequestContext, Exam, Question } from "@exam/domain";
import {
  InvalidStateTransitionError,
  ExamAlreadyPublishedError,
  ExamNotDraftError,
  ValidationError,
  ExamCloseNotAllowedError,
  ExamArchiveNotAllowedError,
  ExamUnpublishNotAllowedError,
  ExamExtendNotAllowedError,
  ExamUpdateNotAllowedError,
  ExamCancelNotAllowedError,
} from "@exam/domain";
import { ensureTargetOrg } from "./helpers.js";
import { recordAudit } from "./audit.js";
import {
  buildErrorResponse,
  buildValidationErrorResponse,
} from "../lib/errorResponse.js";

/** Convert an Exam domain entity to the API response shape with ISO date strings. */
function toExamResponse(exam: Exam) {
  return {
    id: exam.id,
    organizationId: exam.organizationId,
    title: exam.title,
    description: exam.description,
    courseId: exam.courseId,
    status: exam.status,
    timingMode: exam.timingMode,
    durationMinutes: exam.durationMinutes,
    openAt: exam.openAt.toISOString(),
    closeAt: exam.closeAt.toISOString(),
    passingScore: exam.passingScore,
    totalScore: exam.totalScore,
    questionSelectionMode: exam.questionSelectionMode,
    questionIds: exam.questionIds,
    controlFlags: exam.controlFlags,
    retakePolicy: exam.retakePolicy,
    scoreStrategy: exam.scoreStrategy,
    maxAttempts: exam.maxAttempts,
    latestStartOffsetMinutes: exam.latestStartOffsetMinutes,
    minSubmitAfterStartMinutes: exam.minSubmitAfterStartMinutes,
    createdAt: exam.createdAt.toISOString(),
    updatedAt: exam.updatedAt.toISOString(),
  };
}

/**
 * Fetch all participants enrolled in a given exam.
 * Resolves candidate and user details for display names and custom fields.
 * Optionally accepts pre-fetched enrollments to avoid duplicate DB queries.
 */
async function getExamParticipants(
  db: Database,
  ctx: RequestContext,
  examId: string,
  preFetchedEnrollments?: Awaited<
    ReturnType<ReturnType<typeof createEnrollmentRepo>["list"]>
  >,
) {
  const allEnrollments =
    preFetchedEnrollments ?? (await createEnrollmentRepo(db).list(ctx));
  const enrollments = allEnrollments.filter(
    (enrollment) => enrollment.examId === examId,
  );
  const candidateRepo = createCandidateRepo(db);
  const userRepo = createUserRepo(db);
  const candidateIds = [...new Set(enrollments.map((e) => e.candidateId))];
  const candidateMap = new Map(
    (
      await Promise.all(
        candidateIds.map(async (cid) => {
          const c = await candidateRepo.findById(ctx, cid);
          return c ? [cid, c] : null;
        }),
      )
    ).filter(Boolean) as [
      string,
      NonNullable<Awaited<ReturnType<typeof candidateRepo.findById>>>,
    ][],
  );
  const userIds = [
    ...new Set([...candidateMap.values()].map((c) => c.userId).filter(Boolean)),
  ];
  const userMap = new Map(
    (
      await Promise.all(
        userIds.map(async (uid) => {
          const u = await userRepo.findById(ctx, uid);
          return u ? [uid, u] : null;
        }),
      )
    ).filter(Boolean) as [
      string,
      NonNullable<Awaited<ReturnType<typeof userRepo.findById>>>,
    ][],
  );
  return enrollments.map((enrollment) => {
    const candidate = candidateMap.get(enrollment.candidateId);
    const user = candidate ? userMap.get(candidate.userId) : null;
    return {
      candidateId: enrollment.candidateId,
      name: user?.name ?? "-",
      fields: candidate?.fields ?? {},
      status: enrollment.status,
      score: enrollment.finalScore ?? null,
      passed: enrollment.finalPassed ?? null,
    };
  });
}

/** Adapter that bridges the exam-engine ExamRepository interface to the local exam repo with a bound RequestContext. */
function createExamRepoAdapter(
  repo: ReturnType<typeof createExamRepo>,
  ctx: RequestContext,
): ExamRepository {
  return {
    findById: (examId) => repo.findById(ctx, examId) as Promise<Exam | null>,
    update: (examId, data) =>
      repo.update(
        ctx,
        examId,
        data as Record<string, unknown>,
      ) as Promise<Exam | null>,
  };
}

/** Determine whether scores can be viewed for an exam based on its status, close time, and graded attempt count. */
function getScoreViewMeta(exam: Exam, gradedAttemptCount: number, now: Date) {
  if (exam.status === "canceled") {
    return {
      canViewScores: false,
      scoreViewDisabledReason: "已取消的考试不提供成绩",
    };
  }

  const examEnded =
    exam.status === "closed" ||
    exam.status === "archived" ||
    now >= exam.closeAt;

  if (!examEnded) {
    return {
      canViewScores: false,
      scoreViewDisabledReason: "考试尚未结束，暂不能查看成绩",
    };
  }

  if (gradedAttemptCount === 0) {
    return {
      canViewScores: false,
      scoreViewDisabledReason: "暂无成绩数据",
    };
  }

  return {
    canViewScores: true,
    scoreViewDisabledReason: null,
  };
}

/** Determine whether an exam can be deleted. Only draft exams are deletable. */
function getDeleteMeta(exam: Exam) {
  if (exam.status === "draft") {
    return {
      canDelete: true,
      deleteDisabledReason: null,
    };
  }

  return {
    canDelete: false,
    deleteDisabledReason: "仅草稿状态的考试允许删除",
  };
}

/** Zod schema for route params containing a UUID `id`. */
const idParamsSchema = z.object({ id: z.string().uuid() });

/** Zod schema for route params containing a UUID `examId`. */
const examIdParamsSchema = z.object({ examId: z.string().uuid() });

/** Zod schema for route params containing both `examId` and `enrollmentId` UUIDs. */
const enrollmentIdParamsSchema = z.object({
  examId: z.string().uuid(),
  enrollmentId: z.string().uuid(),
});

/** OpenAPI security scheme: HTTP-only cookie authentication. */
const cookieAuth = [{ cookieAuth: [] }] as const;

/** Zod schema for a single exam list item, extending ExamSchema with participant count, graded attempt count, and UI action metadata. */
const examListItemSchema = ExamSchema.extend({
  participantCount: z.number().int().nonnegative(),
  gradedAttemptCount: z.number().int().nonnegative(),
  canViewScores: z.boolean(),
  scoreViewDisabledReason: z.string().nullable(),
  canDelete: z.boolean(),
  deleteDisabledReason: z.string().nullable(),
});

/** Zod schema for the paginated exam list response. */
const examListResponseSchema = z.object({
  items: z.array(examListItemSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  totalPages: z.number().int().nonnegative(),
});

/** Zod schema for a single exam participant entry with candidate info, status, and score. */
const examParticipantSchema = z.object({
  candidateId: z.string().uuid(),
  name: z.string(),
  fields: z.record(z.unknown()),
  status: z.enum(["assigned", "started", "completed", "blocked"]),
  score: z.number().nullable(),
  passed: z.boolean().nullable(),
});

/** Zod schema for the exam detail response, extending ExamSchema with aggregated stats and participant list. */
const examDetailResponseSchema = ExamSchema.extend({
  stats: z.object({
    participantCount: z.number().int().nonnegative(),
    completedCount: z.number().int().nonnegative(),
    passedCount: z.number().int().nonnegative(),
  }),
  participants: z.array(examParticipantSchema),
});

/** Zod schema for a single enrollment item with candidate display name and attempt/score details. */
const enrollmentItemSchema = z.object({
  id: z.string().uuid(),
  examId: z.string().uuid(),
  candidateId: z.string().uuid(),
  candidateDisplayName: z.string(),
  status: z.enum(["assigned", "started", "completed", "blocked"]),
  attemptCount: z.number().int().nonnegative(),
  finalScore: z.number().nullable(),
  finalPassed: z.boolean().nullable(),
});

/** Zod schema for a single enrollment list item, extending enrollmentItemSchema with optional candidate identity string. */
const enrollmentListItemSchema = enrollmentItemSchema.extend({
  candidateIdentity: z.string().optional(),
});

/** Reason a candidate ID was skipped during batch enrollment. */
const enrollmentSkipReasonEnum = z.enum(["DUPLICATE", "NOT_FOUND"]);

/** Zod schema for the enrollment batch-add response, reporting counts of added/skipped enrollments. */
const enrollmentAddResponseSchema = z.object({
  added: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  enrollments: z.array(enrollmentItemSchema),
  // Per-skip reporting so the admin can see WHICH candidate IDs were skipped
  // and why (DUPLICATE = already enrolled; NOT_FOUND = candidate does not
  // exist). Backward-compatible addition; added/skipped/enrollments unchanged.
  skippedCandidates: z.array(
    z.object({
      candidateId: z.string().uuid(),
      reason: enrollmentSkipReasonEnum,
    }),
  ),
});

/** Fastify plugin that registers all exam CRUD, state-transition, and enrollment routes. */
const examRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    "/exams",
    {
      preHandler: [fastify.authenticate, fastify.requireRole(["Admin"])],
      schema: {
        querystring: PaginationParamsSchema,
        security: cookieAuth,
        "x-role": ["Admin"],
        response: {
          200: examListResponseSchema,
        },
      },
    },
    /** List exams with pagination. Each item includes participant count, graded attempt count, and UI action metadata. */
    async (request: any) => {
      const ctx = ensureTargetOrg(request["ctx"] as RequestContext);
      const { page, pageSize } = PaginationParamsSchema.parse(request.query);
      const repo = createExamRepo(fastify.db);
      const { items, total } = await repo.listPaginated(ctx, page, pageSize);
      const attemptRepo = createAttemptRepo(fastify.db);
      const allEnrollments = await createEnrollmentRepo(fastify.db).list(ctx);
      const now = fastify.now();

      return {
        items: await Promise.all(
          items.map(async (e) => {
            const exam = e as Exam;
            const participants = await getExamParticipants(
              fastify.db,
              ctx,
              exam.id,
              allEnrollments,
            );
            const gradedAttemptCount = await attemptRepo.countGradedByExam(
              ctx,
              exam.id,
            );
            return {
              ...toExamResponse(exam),
              participantCount: participants.length,
              gradedAttemptCount,
              ...getScoreViewMeta(exam, gradedAttemptCount, now),
              ...getDeleteMeta(exam),
            };
          }),
        ),
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      };
    },
  );

  fastify.get(
    "/exams/:id",
    {
      preHandler: [fastify.authenticate, fastify.requireRole(["Admin"])],
      schema: {
        params: idParamsSchema,
        security: cookieAuth,
        "x-role": ["Admin"],
        response: {
          200: examDetailResponseSchema,
          404: ErrorResponseSchema,
        },
      },
    },
    /** Get exam detail by ID, including aggregated stats and participant list. Returns 404 if not found. */
    async (request: FastifyRequest, reply: FastifyReply) => {
      const ctx = ensureTargetOrg(request["ctx"] as RequestContext);
      const { id } = request.params as { id: string };
      const repo = createExamRepo(fastify.db);
      const exam = (await repo.findById(ctx, id)) as Exam | null;
      if (!exam) {
        return reply
          .code(404)
          .send(buildErrorResponse(request.id, "RESOURCE_NOT_FOUND"));
      }
      const participants = await getExamParticipants(fastify.db, ctx, exam.id);
      return {
        ...toExamResponse(exam),
        stats: {
          participantCount: participants.length,
          completedCount: participants.filter(
            (participant) => participant.status === "completed",
          ).length,
          passedCount: participants.filter(
            (participant) => participant.passed === true,
          ).length,
        },
        participants,
      };
    },
  );

  fastify.post(
    "/exams",
    {
      preHandler: [fastify.authenticate, fastify.requireRole(["Admin"])],
      schema: {
        body: CreateExamRequestSchema,
        security: cookieAuth,
        "x-role": ["Admin"],
        response: {
          201: ExamSchema,
          400: ErrorResponseSchema,
        },
      },
    },
    /** Create a new exam in draft status. Validates courseId and question ownership. Returns 400 on validation error. */
    async (request: FastifyRequest, reply: FastifyReply) => {
      const ctx = ensureTargetOrg(request["ctx"] as RequestContext);
      const parsed = CreateExamRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send(buildValidationErrorResponse(request.id, parsed.error));
      }
      const data = parsed.data;
      const repo = createExamRepo(fastify.db);
      const course = await createCourseRepo(fastify.db).findById(
        ctx,
        data.courseId,
      );
      const questionRepo = createQuestionRepo(fastify.db);
      if (!course) {
        return reply.code(400).send(
          buildErrorResponse(request.id, "VALIDATION_ERROR", {
            fields: [
              {
                field: "courseId",
                code: "RESOURCE_NOT_FOUND",
                message: "课程不存在",
              },
            ],
          }),
        );
      }
      const questionChecks = await Promise.all(
        data.questionIds.map((id) => questionRepo.findById(ctx, id)),
      );
      if (questionChecks.some((q) => q?.courseId !== data.courseId)) {
        return reply.code(400).send(
          buildErrorResponse(request.id, "VALIDATION_ERROR", {
            fields: [
              {
                field: "questionIds",
                code: "QUESTION_COURSE_MISMATCH",
                message: "题目不属于所选课程",
              },
            ],
          }),
        );
      }

      const exam = await repo.create(ctx, {
        title: data.title,
        description: data.description,
        courseId: data.courseId,
        status: "draft",
        timingMode: data.timingMode,
        durationMinutes: data.durationMinutes,
        openAt: new Date(data.openAt),
        closeAt: new Date(data.closeAt),
        passingScore: data.passingScore,
        totalScore: data.totalScore,
        questionSelectionMode: data.questionSelectionMode,
        questionIds: data.questionIds,
        questionSnapshot: [],
        controlFlags: data.controlFlags,
        retakePolicy: data.retakePolicy,
        scoreStrategy: data.scoreStrategy,
        maxAttempts: data.maxAttempts,
        latestStartOffsetMinutes: data.latestStartOffsetMinutes ?? null,
        minSubmitAfterStartMinutes: data.minSubmitAfterStartMinutes ?? null,
      });
      recordAudit(fastify, request, ctx, "exam.create", "exam", exam.id);

      return reply.code(201).send(toExamResponse(exam as Exam));
    },
  );

  fastify.patch(
    "/exams/:id",
    {
      preHandler: [fastify.authenticate, fastify.requireRole(["Admin"])],
      schema: {
        params: idParamsSchema,
        body: UpdateExamRequestSchema,
        security: cookieAuth,
        "x-role": ["Admin"],
        response: {
          200: ExamSchema,
          400: ErrorResponseSchema,
          404: ErrorResponseSchema,
          409: ErrorResponseSchema,
        },
      },
    },
    /**
     * Update an existing exam by ID. ADR-005 Slice 2 §3.7 + construction hard
     * rule: draft = full edit; published = schedule fields only (openAt/closeAt);
     * other states rejected. Lock -> reconcile -> guard -> mutate in ONE tx so a
     * stale persisted status cannot be acted on.
     */
    async (request: FastifyRequest, reply: FastifyReply) => {
      const ctx = ensureTargetOrg(request["ctx"] as RequestContext);
      const { id } = request.params as { id: string };
      const parsed = UpdateExamRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send(buildValidationErrorResponse(request.id, parsed.error));
      }
      const data = parsed.data;

      const result = await executeInTransaction(
        fastify.db,
        async (tx): Promise<{ exam: Exam } | null> => {
          const repo = createExamRepo(tx);

          // 1. Lock the exam row.
          const existing = (await repo.findByIdForUpdate(
            ctx,
            id,
          )) as Exam | null;
          if (!existing) return null;

          // 2. Reconcile status by now (published->open / open->closed lazily).
          const reconciled = await checkAndUpdateExamStatus(
            createExamRepoAdapter(repo, ctx),
            id,
            fastify.now(),
          );
          const exam = reconciled?.exam ?? existing;

          // 3. State guard on the RECONCILED status.
          if (exam.status !== "draft" && exam.status !== "published") {
            throw new ExamUpdateNotAllowedError();
          }
          if (exam.status === "published") {
            // Published exams may only edit the schedule. Any other field is
            // rejected — questions/controlFlags/score policy are frozen.
            const allowed = new Set(["openAt", "closeAt"]);
            const forbidden = Object.keys(data).filter((k) => !allowed.has(k));
            if (forbidden.length > 0) {
              throw new ExamUpdateNotAllowedError();
            }
          }
          if (exam.status === "draft" && data.questionIds) {
            const questionChecks = await Promise.all(
              data.questionIds.map((questionId) =>
                createQuestionRepo(tx).findById(ctx, questionId),
              ),
            );
            if (questionChecks.some((q) => q?.courseId !== exam.courseId)) {
              throw new ValidationError("题目不属于所选课程");
            }
          }

          // 4. Mutate.
          const updateData: Record<string, unknown> = { ...data };
          if (data.openAt) updateData.openAt = new Date(data.openAt);
          if (data.closeAt) updateData.closeAt = new Date(data.closeAt);
          const updated = (await repo.update(
            ctx,
            id,
            updateData,
          )) as Exam | null;
          if (!updated) return null;
          return { exam: updated };
        },
      );

      if (!result) {
        return reply
          .code(404)
          .send(buildErrorResponse(request.id, "RESOURCE_NOT_FOUND"));
      }
      recordAudit(fastify, request, ctx, "exam.update", "exam", id);
      return toExamResponse(result.exam);
    },
  );

  fastify.post(
    "/exams/:id/publish",
    {
      preHandler: [fastify.authenticate, fastify.requireRole(["Admin"])],
      schema: {
        params: idParamsSchema,
        security: cookieAuth,
        "x-role": ["Admin"],
        response: {
          200: ExamSchema,
          404: ErrorResponseSchema,
        },
      },
    },
    /** Publish a draft exam, transitioning it to published status and snapshotting questions. Throws ExamAlreadyPublishedError if not in draft state. */
    async (request: FastifyRequest, reply: FastifyReply) => {
      const ctx = ensureTargetOrg(request["ctx"] as RequestContext);
      const { id } = request.params as { id: string };
      const examRepo = createExamRepo(fastify.db);
      const questionRepo = createQuestionRepo(fastify.db);

      const exam = (await examRepo.findById(ctx, id)) as Exam | null;
      if (!exam) {
        return reply
          .code(404)
          .send(buildErrorResponse(request.id, "RESOURCE_NOT_FOUND"));
      }

      const questions = (
        await Promise.all(
          exam.questionIds.map((qid) => questionRepo.findById(ctx, qid)),
        )
      ).filter((q): q is NonNullable<typeof q> => q !== null) as Question[];

      try {
        const examRepoAdapter = createExamRepoAdapter(examRepo, ctx);
        const updated = await publishExam(examRepoAdapter, id, questions);
        recordAudit(fastify, request, ctx, "exam.publish", "exam", id);
        return toExamResponse(updated);
      } catch (err) {
        if (err instanceof InvalidStateTransitionError) {
          throw new ExamAlreadyPublishedError();
        }
        throw err;
      }
    },
  );

  /**
   * Zod schema for the close request body: an optional human-readable reason.
   */
  const closeExamRequestSchema = z.object({
    reason: z.string().trim().max(500).optional(),
  });

  fastify.post(
    "/exams/:id/close",
    {
      preHandler: [fastify.authenticate, fastify.requireRole(["Admin"])],
      schema: {
        params: idParamsSchema,
        body: closeExamRequestSchema,
        security: cookieAuth,
        "x-role": ["Admin"],
        response: {
          200: ExamSchema,
          404: ErrorResponseSchema,
          409: ErrorResponseSchema,
        },
      },
    },
    /**
     * Close an open exam (open -> closed). ADR-005 Slice 1.
     *
     * Construction hard rule: lock -> reconcile -> unresolved guard -> assert
     * -> mutate -> audit. The engine `closeExam` is idempotent for `closed`,
     * so we detect the no-op case (reconciled status already `closed`) and
     * suppress the duplicate audit (review decision #2).
     *
     * Close is rejected with EXAM_CLOSE_NOT_ALLOWED / details.reason =
     * UNRESOLVED_ATTEMPTS_EXIST when active/in-flight attempts remain
     * (review decision #3), so scores/export stay semantically valid after.
     */
    async (request: FastifyRequest, reply: FastifyReply) => {
      const ctx = ensureTargetOrg(request["ctx"] as RequestContext);
      const { id } = request.params as { id: string };
      const reason = ((request.body as Record<string, unknown>)?.reason ??
        undefined) as string | undefined;

      // ADR-005 construction hard rule: lock -> reconcile -> unresolved guard
      // -> assert -> mutate run INSIDE ONE transaction so the FOR UPDATE row
      // lock spans the whole decision and the deadline scanner cannot race it.
      // The tx-scoped repos below share one connection; the audit write stays
      // outside the tx (best-effort, matching the attempts.ts convention).
      const result = await executeInTransaction(
        fastify.db,
        async (
          tx,
        ): Promise<{
          closed: Exam;
          fromStatus: string;
          unresolvedCount: number;
        } | null> => {
          const repo = createExamRepo(tx);
          const attemptRepo = createAttemptRepo(tx);

          // 1. Lock the exam row.
          const locked = (await repo.findByIdForUpdate(ctx, id)) as Exam | null;
          if (!locked) {
            return null;
          }

          // 2. Reconcile status by now (published->open / open->closed lazily).
          const reconciled = await checkAndUpdateExamStatus(
            createExamRepoAdapter(repo, ctx),
            id,
            fastify.now(),
          );
          const exam = reconciled?.exam ?? locked;

          // 3. Unresolved-attempts guard: reject if active/in-flight attempts
          //    remain (review decision #3).
          const unresolvedCount = await attemptRepo.countUnresolvedByExam(
            ctx,
            id,
          );
          if (unresolvedCount > 0) {
            throw new ExamCloseNotAllowedError({
              reason: "UNRESOLVED_ATTEMPTS_EXIST",
              activeAttemptCount: unresolvedCount,
            });
          }

          // 4 + 5. Assert + mutate via the engine. closeExam is idempotent for
          //    `closed` (returns as-is). A non-open, non-closed reconciled
          //    status raises InvalidStateTransitionError; surfaced uniformly as
          //    EXAM_CLOSE_NOT_ALLOWED (no UNRESOLVED reason) per ADR-005 §3.3.
          let closed: Exam;
          try {
            closed = await closeExam(createExamRepoAdapter(repo, ctx), id);
          } catch (err) {
            if (err instanceof InvalidStateTransitionError) {
              throw new ExamCloseNotAllowedError();
            }
            throw err;
          }
          return {
            closed,
            fromStatus: exam.status,
            unresolvedCount,
          };
        },
      );

      if (!result) {
        return reply
          .code(404)
          .send(buildErrorResponse(request.id, "RESOURCE_NOT_FOUND"));
      }

      const { closed, fromStatus } = result;

      // 6. Audit — only for a genuine transition (idempotent close writes no
      //    duplicate audit, review decision #2). activeAttemptCount included
      //    per ADR-005 §Audit events (will be 0 here since the guard passed).
      if (fromStatus !== "closed") {
        recordAudit(fastify, request, ctx, "exam.close", "exam", id, {
          reason,
          fromStatus,
          toStatus: "closed",
          activeAttemptCount: result.unresolvedCount,
        });
      }
      return toExamResponse(closed);
    },
  );

  /**
   * Zod schema for the extend request body: positive minutes + optional reason.
   */
  const extendExamRequestSchema = z.object({
    extendMinutes: z.number().int().positive(),
    reason: z.string().trim().max(500).optional(),
  });

  /**
   * Unpublish a published exam (published -> draft). ADR-005 Slice 2 §3.2.
   *
   * Stale-state protection: lock -> reconcile first; if reconciliation advanced
   * the exam to `open` (openAt already passed), reject — a live exam cannot be
   * rewound to draft. Never allows open -> draft.
   */
  fastify.post(
    "/exams/:id/unpublish",
    {
      preHandler: [fastify.authenticate, fastify.requireRole(["Admin"])],
      schema: {
        params: idParamsSchema,
        security: cookieAuth,
        "x-role": ["Admin"],
        response: {
          200: ExamSchema,
          404: ErrorResponseSchema,
          409: ErrorResponseSchema,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const ctx = ensureTargetOrg(request["ctx"] as RequestContext);
      const { id } = request.params as { id: string };

      const result = await executeInTransaction(
        fastify.db,
        async (tx): Promise<{ exam: Exam; fromStatus: string } | null> => {
          const repo = createExamRepo(tx);
          const locked = (await repo.findByIdForUpdate(ctx, id)) as Exam | null;
          if (!locked) return null;
          // Reconcile by now: a published exam whose openAt passed is now open.
          const reconciled = await checkAndUpdateExamStatus(
            createExamRepoAdapter(repo, ctx),
            id,
            fastify.now(),
          );
          const exam = reconciled?.exam ?? locked;
          // After reconcile, only a still-`published` exam may unpublish.
          if (exam.status !== "published") {
            throw new ExamUnpublishNotAllowedError();
          }
          const updated = await unpublishExam(
            createExamRepoAdapter(repo, ctx),
            id,
          );
          return { exam: updated, fromStatus: exam.status };
        },
      );
      if (!result) {
        return reply
          .code(404)
          .send(buildErrorResponse(request.id, "RESOURCE_NOT_FOUND"));
      }
      recordAudit(fastify, request, ctx, "exam.unpublish", "exam", id, {
        fromStatus: result.fromStatus,
        toStatus: "draft",
      });
      return toExamResponse(result.exam);
    },
  );

  /**
   * Extend an open exam's closeAt (open -> open). ADR-005 Slice 2 §3.4.
   *
   * Stale-state protection: lock -> reconcile first; if reconciliation advanced
   * the exam to `closed` (closeAt already passed), reject — a dead exam cannot
   * be revived by pushing closeAt forward.
   */
  fastify.post(
    "/exams/:id/extend",
    {
      preHandler: [fastify.authenticate, fastify.requireRole(["Admin"])],
      schema: {
        params: idParamsSchema,
        body: extendExamRequestSchema,
        security: cookieAuth,
        "x-role": ["Admin"],
        response: {
          200: ExamSchema,
          404: ErrorResponseSchema,
          409: ErrorResponseSchema,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const ctx = ensureTargetOrg(request["ctx"] as RequestContext);
      const { id } = request.params as { id: string };
      const { extendMinutes, reason } = request.body as {
        extendMinutes: number;
        reason?: string;
      };

      const result = await executeInTransaction(
        fastify.db,
        async (
          tx,
        ): Promise<{
          exam: Exam;
          oldCloseAt: Date;
          newCloseAt: Date;
        } | null> => {
          const repo = createExamRepo(tx);
          const locked = (await repo.findByIdForUpdate(ctx, id)) as Exam | null;
          if (!locked) return null;
          const oldCloseAt = new Date(locked.closeAt);
          // Reconcile: an open exam whose closeAt passed is now closed.
          const reconciled = await checkAndUpdateExamStatus(
            createExamRepoAdapter(repo, ctx),
            id,
            fastify.now(),
          );
          const exam = reconciled?.exam ?? locked;
          if (exam.status !== "open") {
            throw new ExamExtendNotAllowedError({
              reason: exam.status === "closed" ? "ALREADY_CLOSED" : "NOT_OPEN",
            });
          }
          const updated = await extendExam(
            createExamRepoAdapter(repo, ctx),
            id,
            extendMinutes,
          );
          return {
            exam: updated,
            oldCloseAt,
            newCloseAt: new Date(updated.closeAt),
          };
        },
      );
      if (!result) {
        return reply
          .code(404)
          .send(buildErrorResponse(request.id, "RESOURCE_NOT_FOUND"));
      }
      recordAudit(fastify, request, ctx, "exam.extend", "exam", id, {
        extendMinutes,
        oldCloseAt: result.oldCloseAt,
        newCloseAt: result.newCloseAt,
        reason,
      });
      return toExamResponse(result.exam);
    },
  );

  /**
   * Zod schema for the cancel request body: optional reason.
   */
  const cancelExamRequestSchema = z.object({
    reason: z.string().trim().max(500).optional(),
  });

  /**
   * Cancel an exam abnormally (published/open -> canceled). ADR-005 Slice 4.
   *
   * Construction hard rule: lock -> reconcile -> unresolved guard -> assert
   * -> mutate -> audit in one transaction. The unresolved guard (open with
   * active attempts) rejects with EXAM_CANCEL_NOT_ALLOWED /
   * UNRESOLVED_ATTEMPTS_EXIST. cancel does NOT void or force-submit attempts.
   * cancel is NOT idempotent (canceled -> canceled rejected); archive to settle.
   */
  fastify.post(
    "/exams/:id/cancel",
    {
      preHandler: [fastify.authenticate, fastify.requireRole(["Admin"])],
      schema: {
        params: idParamsSchema,
        body: cancelExamRequestSchema,
        security: cookieAuth,
        "x-role": ["Admin"],
        response: {
          200: ExamSchema,
          404: ErrorResponseSchema,
          409: ErrorResponseSchema,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const ctx = ensureTargetOrg(request["ctx"] as RequestContext);
      const { id } = request.params as { id: string };
      const reason = ((request.body as Record<string, unknown>)?.reason ??
        undefined) as string | undefined;

      const result = await executeInTransaction(
        fastify.db,
        async (
          tx,
        ): Promise<{
          exam: Exam;
          fromStatus: string;
          unresolvedCount: number;
        } | null> => {
          const repo = createExamRepo(tx);
          const attemptRepo = createAttemptRepo(tx);

          // 1. Lock the exam row.
          const locked = (await repo.findByIdForUpdate(ctx, id)) as Exam | null;
          if (!locked) return null;

          // 2. Reconcile status by now.
          const reconciled = await checkAndUpdateExamStatus(
            createExamRepoAdapter(repo, ctx),
            id,
            fastify.now(),
          );
          const exam = reconciled?.exam ?? locked;

          // 3. Unresolved-attempts guard (only meaningful for open, but cheap).
          const unresolvedCount = await attemptRepo.countUnresolvedByExam(
            ctx,
            id,
          );
          if (unresolvedCount > 0) {
            throw new ExamCancelNotAllowedError({
              reason: "UNRESOLVED_ATTEMPTS_EXIST",
              activeAttemptCount: unresolvedCount,
            });
          }

          // 4 + 5. Assert + mutate via the engine. Non-cancellable states
          //    (draft/closed/canceled/archived) raise
          //    InvalidStateTransitionError -> surfaced as EXAM_CANCEL_NOT_ALLOWED.
          let canceled: Exam;
          try {
            canceled = await cancelExam(createExamRepoAdapter(repo, ctx), id);
          } catch (err) {
            if (err instanceof InvalidStateTransitionError) {
              throw new ExamCancelNotAllowedError();
            }
            throw err;
          }
          return {
            exam: canceled,
            fromStatus: exam.status,
            unresolvedCount,
          };
        },
      );

      if (!result) {
        return reply
          .code(404)
          .send(buildErrorResponse(request.id, "RESOURCE_NOT_FOUND"));
      }

      // 6. Audit (outside tx, best-effort). activeAttemptCount is 0 here
      //    (guard passed).
      recordAudit(fastify, request, ctx, "exam.cancel", "exam", id, {
        reason,
        fromStatus: result.fromStatus,
        toStatus: "canceled",
        activeAttemptCount: result.unresolvedCount,
      });
      return toExamResponse(result.exam);
    },
  );

  fastify.post(
    "/exams/:id/archive",
    {
      preHandler: [fastify.authenticate, fastify.requireRole(["Admin"])],
      schema: {
        params: idParamsSchema,
        security: cookieAuth,
        "x-role": ["Admin"],
        response: {
          200: ExamSchema,
          404: ErrorResponseSchema,
          409: ErrorResponseSchema,
        },
      },
    },
    /**
     * Archive an exam (published/closed/canceled -> archived). P2B-J2 follow-up
     * #3: brought under the ADR-005 construction hard rule so it is consistent
     * with close/unpublish/extend/cancel — lock -> reconcile -> assert ->
     * mutate inside ONE transaction, with 404 for a missing exam, 409 for an
     * invalid transition, and idempotent already-archived behavior (no
     * duplicate audit). The audit write stays outside the tx, matching the
     * repo convention for this slice (audit-in-tx is a deferred repo-wide
     * follow-up, #4).
     */
    async (request: FastifyRequest, reply: FastifyReply) => {
      const ctx = ensureTargetOrg(request["ctx"] as RequestContext);
      const { id } = request.params as { id: string };
      // ADR-006: one operation now, threaded through the whole archive.
      const now = fastify.now();

      const result = await executeInTransaction(
        fastify.db,
        async (tx): Promise<{ archived: Exam; fromStatus: string } | null> => {
          const repo = createExamRepo(tx);

          // 1. Lock the exam row so no concurrent admin op / scanner races it.
          const locked = (await repo.findByIdForUpdate(ctx, id)) as Exam | null;
          if (!locked) return null;

          // 2. Reconcile status by now (published->open / open->closed lazily)
          //    so a stale persisted status cannot be archived against.
          const reconciled = await checkAndUpdateExamStatus(
            createExamRepoAdapter(repo, ctx),
            id,
            now,
          );
          const exam = reconciled?.exam ?? locked;

          // 3 + 4. Assert + mutate via the engine. Idempotent already-archived:
          //    the state machine has no `archived -> archived` transition, so
          //    detect the no-op BEFORE calling archiveExam and return the
          //    current exam without re-asserting (mirrors close's idempotency
          //    gate, review decision #2). Any other non-archivable reconciled
          //    status raises InvalidStateTransitionError from archiveExam;
          //    surfaced uniformly as EXAM_ARCHIVE_NOT_ALLOWED per the ADR.
          if (exam.status === "archived") {
            return { archived: exam, fromStatus: "archived" };
          }
          let archived: Exam;
          try {
            archived = await archiveExam(createExamRepoAdapter(repo, ctx), id);
          } catch (err) {
            if (err instanceof InvalidStateTransitionError) {
              throw new ExamArchiveNotAllowedError();
            }
            throw err;
          }
          return { archived, fromStatus: exam.status };
        },
      );

      if (!result) {
        return reply
          .code(404)
          .send(buildErrorResponse(request.id, "RESOURCE_NOT_FOUND"));
      }

      const { archived, fromStatus } = result;

      // 5. Audit — only for a genuine transition (idempotent archive writes no
      //    duplicate audit). fromStatus captured from the reconciled pre-image.
      if (fromStatus !== "archived") {
        recordAudit(fastify, request, ctx, "exam.archive", "exam", id, {
          fromStatus,
          toStatus: "archived",
        });
      }
      return toExamResponse(archived);
    },
  );

  fastify.delete(
    "/exams/:id",
    {
      preHandler: [fastify.authenticate, fastify.requireRole(["Admin"])],
      schema: {
        params: idParamsSchema,
        security: cookieAuth,
        "x-role": ["Admin"],
        response: {
          204: z.null(),
        },
      },
    },
    /** Delete a draft exam by ID. Only draft exams can be deleted; returns 404 if not found. */
    async (request: FastifyRequest, reply: FastifyReply) => {
      const ctx = ensureTargetOrg(request["ctx"] as RequestContext);
      const { id } = request.params as { id: string };
      const repo = createExamRepo(fastify.db);

      const exam = (await repo.findById(ctx, id)) as Exam | null;
      if (!exam) {
        return reply
          .code(404)
          .send(buildErrorResponse(request.id, "RESOURCE_NOT_FOUND"));
      }

      if (exam.status !== "draft") {
        throw new ExamNotDraftError();
      }

      await repo.delete(ctx, id);
      recordAudit(fastify, request, ctx, "exam.delete", "exam", id);
      return reply.code(204).send();
    },
  );

  fastify.get(
    "/exams/:examId/enrollments",
    {
      preHandler: [fastify.authenticate, fastify.requireRole(["Admin"])],
      schema: {
        params: examIdParamsSchema,
        security: cookieAuth,
        "x-role": ["Admin"],
        response: {
          200: z.array(enrollmentListItemSchema),
          404: ErrorResponseSchema,
        },
      },
    },
    /** List all enrollments for a given exam, including candidate display names and identity fields. Returns 404 if exam not found. */
    async (request: FastifyRequest, reply: FastifyReply) => {
      const ctx = ensureTargetOrg(request["ctx"] as RequestContext);
      const { examId } = request.params as { examId: string };
      const examRepo = createExamRepo(fastify.db);
      const exam = (await examRepo.findById(ctx, examId)) as Exam | null;
      if (!exam) {
        return reply
          .code(404)
          .send(buildErrorResponse(request.id, "RESOURCE_NOT_FOUND"));
      }

      const enrollmentRepo = createEnrollmentRepo(fastify.db);
      const enrollments = (await enrollmentRepo.list(ctx)).filter(
        (e) => e.examId === examId,
      );
      const candidateRepo = createCandidateRepo(fastify.db);
      const userRepo = createUserRepo(fastify.db);

      return Promise.all(
        enrollments.map(async (enrollment) => {
          const candidate = await candidateRepo.findById(
            ctx,
            enrollment.candidateId,
          );
          const user = candidate
            ? await userRepo.findById(ctx, candidate.userId)
            : null;
          return {
            id: enrollment.id,
            examId: enrollment.examId,
            candidateId: enrollment.candidateId,
            candidateDisplayName: user?.name ?? "-",
            candidateIdentity:
              Object.values(candidate?.fields ?? {})
                .map(String)
                .join(" / ") || undefined,
            status: enrollment.status,
            attemptCount: enrollment.attemptCount,
            finalScore: enrollment.finalScore ?? null,
            finalPassed: enrollment.finalPassed ?? null,
          };
        }),
      );
    },
  );

  fastify.post(
    "/exams/:examId/enrollments",
    {
      preHandler: [fastify.authenticate, fastify.requireRole(["Admin"])],
      schema: {
        params: examIdParamsSchema,
        body: EnrollCandidatesRequestSchema,
        security: cookieAuth,
        "x-role": ["Admin"],
        response: {
          200: enrollmentAddResponseSchema,
          400: ErrorResponseSchema,
          404: ErrorResponseSchema,
        },
      },
    },
    /** Batch enroll candidates into an exam. Skips already-enrolled or non-existent candidates. Returns counts of added and skipped. */
    async (request, reply) => {
      const ctx = ensureTargetOrg(request["ctx"] as RequestContext);
      const { examId } = request.params as { examId: string };
      const parsedBody = EnrollCandidatesRequestSchema.safeParse(request.body);
      if (!parsedBody.success) {
        return reply
          .code(400)
          .send(buildValidationErrorResponse(request.id, parsedBody.error));
      }
      const { candidateIds } = parsedBody.data;

      const examRepo = createExamRepo(fastify.db);
      const exam = (await examRepo.findById(ctx, examId)) as Exam | null;
      if (!exam) {
        return reply
          .code(404)
          .send(buildErrorResponse(request.id, "RESOURCE_NOT_FOUND"));
      }

      const enrollmentRepo = createEnrollmentRepo(fastify.db);
      const candidateRepo = createCandidateRepo(fastify.db);
      const userRepo = createUserRepo(fastify.db);
      const existing = (await enrollmentRepo.list(ctx)).filter(
        (e) => e.examId === examId,
      );
      const existingIds = new Set(existing.map((e) => e.candidateId));

      let added = 0;
      let skipped = 0;
      const enrollments: unknown[] = [];
      // Per-skip reason reporting: which candidate IDs were skipped and why.
      const skippedCandidates: {
        candidateId: string;
        reason: "DUPLICATE" | "NOT_FOUND";
      }[] = [];

      for (const candidateId of candidateIds) {
        if (existingIds.has(candidateId)) {
          skipped++;
          skippedCandidates.push({ candidateId, reason: "DUPLICATE" });
          continue;
        }
        const candidate = await candidateRepo.findById(ctx, candidateId);
        if (!candidate) {
          skipped++;
          skippedCandidates.push({ candidateId, reason: "NOT_FOUND" });
          continue;
        }
        const enrollment = await enrollmentRepo.create(ctx, {
          examId,
          candidateId,
          status: "assigned",
          attemptCount: 0,
        });
        recordAudit(
          fastify,
          request,
          ctx,
          "enrollment.add",
          "enrollment",
          enrollment.id,
          {
            examId,
            candidateId,
          },
        );
        added++;
        const user = await userRepo.findById(ctx, candidate.userId);
        enrollments.push({
          id: enrollment.id,
          examId: enrollment.examId,
          candidateId: enrollment.candidateId,
          candidateDisplayName: user?.name ?? "-",
          status: enrollment.status,
          attemptCount: enrollment.attemptCount,
          finalScore: enrollment.finalScore ?? null,
          finalPassed: enrollment.finalPassed ?? null,
        });
      }

      return { added, skipped, enrollments, skippedCandidates };
    },
  );

  fastify.delete(
    "/exams/:examId/enrollments/:enrollmentId",
    {
      preHandler: [fastify.authenticate, fastify.requireRole(["Admin"])],
      schema: {
        params: enrollmentIdParamsSchema,
        security: cookieAuth,
        "x-role": ["Admin"],
        response: {
          204: z.null(),
          404: ErrorResponseSchema,
          409: ErrorResponseSchema,
        },
      },
    },
    /** Remove an enrollment from an exam. Only enrollments with status "assigned" can be removed. Returns 404 if not found, 409 if already started. */
    async (request: FastifyRequest, reply: FastifyReply) => {
      const ctx = ensureTargetOrg(request["ctx"] as RequestContext);
      const { examId, enrollmentId } = request.params as {
        examId: string;
        enrollmentId: string;
      };
      const enrollmentRepo = createEnrollmentRepo(fastify.db);
      const enrollment = await enrollmentRepo.findById(ctx, enrollmentId);
      if (!enrollment || enrollment.examId !== examId) {
        return reply
          .code(404)
          .send(buildErrorResponse(request.id, "RESOURCE_NOT_FOUND"));
      }
      if (enrollment.status !== "assigned") {
        return reply
          .code(409)
          .send(buildErrorResponse(request.id, "ENROLLMENT_NOT_REMOVABLE"));
      }

      await enrollmentRepo.delete(ctx, enrollmentId);
      recordAudit(
        fastify,
        request,
        ctx,
        "enrollment.remove",
        "enrollment",
        enrollmentId,
        {
          examId,
          candidateId: enrollment.candidateId,
        },
      );
      return reply.code(204).send();
    },
  );
};

export default examRoutes;
