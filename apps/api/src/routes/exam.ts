import {
  FastifyPluginAsync,
  type FastifyRequest,
  type FastifyReply,
} from "fastify";
import { z } from "zod";
import {
  CreateExamRequestSchema,
  CreateExamRequestBaseSchema,
  UpdateExamRequestSchema,
  UpdateExamRequestBaseSchema,
  PaginationParamsSchema,
  EnrollCandidatesRequestSchema,
  ExamSchema,
  CandidateStatusResponseSchema,
  ErrorResponseSchema,
  PASSING_SCORE_EXCEEDS_TOTAL_MSG,
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
  publishExam,
  publishResults,
} from "@exam/exam-engine";
import { Permission } from "@exam/authz";
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
  ExamPublishResultsNotAllowedError,
} from "@exam/domain";
import { ensureTargetOrg, getRequestContext } from "./helpers.js";
import { reconcileExamForMutation } from "./reconciliation.js";
import { executeAdminExamTransition } from "./examTransitionExecutor.js";
import {
  recordAtomicHttpAudit,
  recordBestEffortAudit,
} from "../audit/auditWriter.js";
import { createExamRepoAdapter } from "../adapters/repoAdapters.js";
import {
  buildErrorResponse,
  buildValidationErrorResponse,
} from "../lib/errorResponse.js";
import { buildCandidateStatusItems } from "../lib/proctorService.js";

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
    resultPublicationMode: exam.resultPublicationMode,
    resultsPublishedAt: exam.resultsPublishedAt
      ? exam.resultsPublishedAt.toISOString()
      : null,
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

/** Determine whether scores can be viewed for an exam based on its status, close time, and graded attempt count. */
function getScoreViewMeta(exam: Exam, gradedAttemptCount: number, now: Date) {
  if (exam.status === "canceled") {
    return {
      canViewScores: false,
      // API-provided status-reason string rendered verbatim by the web client.
      // Allowlisted in the backend copy guard (see i18n-copy-policy.md); a
      // code-based enum + web i18n mapping is a tracked follow-up.
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

/**
 * P2D-J5a legacy compatibility: if a client omits `resultPublicationMode` but
 * sends the legacy `controlFlags.showResultImmediately` flag, derive the mode
 * from the legacy flag. `true` → 'immediate', `false` → 'manual'. Once the
 * caller explicitly sets `resultPublicationMode`, it wins and the legacy flag
 * is ignored for visibility (the flag is still stored verbatim in controlFlags
 * so older clients reading it back are unaffected). Returns the resolved mode
 * so the caller can pass it through to repo.create/update.
 */
function resolveResultPublicationMode(
  rawBody: unknown,
  parsedMode: "immediate" | "after_grading" | "manual",
): "immediate" | "after_grading" | "manual" {
  if (typeof rawBody !== "object" || rawBody === null) return parsedMode;
  const body = rawBody as Record<string, unknown>;
  // If the caller explicitly set resultPublicationMode, honor it verbatim.
  if (body.resultPublicationMode !== undefined) return parsedMode;
  const flags = body.controlFlags;
  if (typeof flags !== "object" || flags === null) return parsedMode;
  const legacy = (flags as Record<string, unknown>).showResultImmediately;
  if (legacy === false) return "manual";
  if (legacy === true) return "immediate";
  return parsedMode;
}

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
      preHandler: [
        fastify.authenticate,
        fastify.requireCapability(Permission.ExamView),
      ],
      schema: {
        querystring: PaginationParamsSchema,
        security: cookieAuth,
        "x-role": ["Admin", "Teacher"],
        response: {
          200: examListResponseSchema,
        },
      },
    },
    /** List exams with pagination. Each item includes participant count, graded attempt count, and UI action metadata. */
    async (request: any) => {
      const ctx = ensureTargetOrg(getRequestContext(request));
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
      preHandler: [
        fastify.authenticate,
        fastify.requireCapability(Permission.ExamView),
      ],
      schema: {
        params: idParamsSchema,
        security: cookieAuth,
        "x-role": ["Admin", "Teacher"],
        response: {
          200: examDetailResponseSchema,
          404: ErrorResponseSchema,
        },
      },
    },
    /** Get exam detail by ID, including aggregated stats and participant list. Returns 404 if not found. */
    async (request: FastifyRequest, reply: FastifyReply) => {
      const ctx = ensureTargetOrg(getRequestContext(request));
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
      preHandler: [
        fastify.authenticate,
        fastify.requireCapability(Permission.ExamCreate),
      ],
      schema: {
        body: CreateExamRequestBaseSchema,
        security: cookieAuth,
        "x-role": ["Admin", "Teacher"],
        response: {
          201: ExamSchema,
          400: ErrorResponseSchema,
        },
      },
    },
    /** Create a new exam in draft status. Validates courseId and question ownership. Returns 400 on validation error. */
    async (request: FastifyRequest, reply: FastifyReply) => {
      const ctx = ensureTargetOrg(getRequestContext(request));
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

      const exam = await createExamRepo(fastify.db).create(ctx, {
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
        resultPublicationMode: resolveResultPublicationMode(
          request.body,
          data.resultPublicationMode ?? "immediate",
        ),
      });
      recordBestEffortAudit(fastify, request, ctx, {
        action: "exam.create",
        targetType: "exam",
        targetId: exam.id,
      });

      return reply.code(201).send(toExamResponse(exam as Exam));
    },
  );

  fastify.patch(
    "/exams/:id",
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireCapability(Permission.ExamUpdate),
      ],
      schema: {
        params: idParamsSchema,
        body: UpdateExamRequestBaseSchema,
        security: cookieAuth,
        "x-role": ["Admin", "Teacher"],
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
      const ctx = ensureTargetOrg(getRequestContext(request));
      const { id } = request.params as { id: string };
      const parsed = UpdateExamRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send(buildValidationErrorResponse(request.id, parsed.error));
      }
      const data = parsed.data;

      if (Object.keys(data).length === 0) {
        const repo = createExamRepo(fastify.db);
        const exam = (await repo.findById(ctx, id)) as Exam | null;
        if (!exam) {
          return reply
            .code(404)
            .send(buildErrorResponse(request.id, "RESOURCE_NOT_FOUND"));
        }
        return toExamResponse(exam);
      }

      const result = await executeInTransaction(
        fastify.db,
        async (
          tx,
        ): Promise<{ exam: Exam; draftObservation: boolean } | null> => {
          const repo = createExamRepo(tx);

          // 1. Lock the exam row.
          const existing = (await repo.findByIdForUpdate(
            ctx,
            id,
          )) as Exam | null;
          if (!existing) return null;

          // 2. Reconcile status by now (published->open / open->closed lazily).
          const reconciled = await reconcileExamForMutation(
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
            // Same-value schedule: skip mutation and audit.
            const sameOpenAt =
              !data.openAt || data.openAt === existing.openAt.toISOString();
            const sameCloseAt =
              !data.closeAt || data.closeAt === existing.closeAt.toISOString();
            if (sameOpenAt && sameCloseAt) {
              return { exam: existing, draftObservation: false };
            }
          }
          // Same-value draft guard: skip mutation and audit when no field
          // actually differs from the current exam.
          if (exam.status === "draft") {
            const changedFields = determineChangedExamFields(data, existing);
            if (changedFields.length === 0) {
              return { exam: existing, draftObservation: false };
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

          if (exam.status === "draft") {
            const nextPassingScore = data.passingScore ?? exam.passingScore;
            const nextTotalScore = data.totalScore ?? exam.totalScore;
            if (nextPassingScore > nextTotalScore) {
              throw new ValidationError(PASSING_SCORE_EXCEEDS_TOTAL_MSG, {
                fields: [
                  {
                    field: "passingScore",
                    code: "PASSING_SCORE_EXCEEDS_TOTAL",
                    message: PASSING_SCORE_EXCEEDS_TOTAL_MSG,
                  },
                ],
              });
            }
          }

          // 4. Mutate.
          const updateData: Record<string, unknown> = { ...data };
          if (data.openAt) updateData.openAt = new Date(data.openAt);
          if (data.closeAt) updateData.closeAt = new Date(data.closeAt);
          // P2D-J5a: coerce resultPublicationMode from the legacy flag when
          // the caller set controlFlags.showResultImmediately but not the
          // mode. Mirrors the create-handler shim.
          if (data.resultPublicationMode !== undefined) {
            updateData.resultPublicationMode = data.resultPublicationMode;
          } else if (exam.status === "draft") {
            // Always apply the coerced value so that legacy
            // showResultImmediately: true (→ "immediate") is persisted,
            // matching the create-handler behavior.
            updateData.resultPublicationMode = resolveResultPublicationMode(
              request.body,
              data.resultPublicationMode ?? "immediate",
            );
          }
          const updated = (await repo.update(
            ctx,
            id,
            updateData,
          )) as Exam | null;
          if (!updated) return null;
          if (exam.status === "published") {
            await recordAtomicHttpAudit(tx, request, ctx, {
              action: "exam.published_schedule_updated",
              targetType: "exam",
              targetId: id,
              metadata: { changedFields: Object.keys(data) },
            });
          }
          return { exam: updated, draftObservation: exam.status === "draft" };
        },
      );

      if (!result) {
        return reply
          .code(404)
          .send(buildErrorResponse(request.id, "RESOURCE_NOT_FOUND"));
      }
      if (result.draftObservation) {
        recordBestEffortAudit(fastify, request, ctx, {
          action: "exam.update",
          targetType: "exam",
          targetId: id,
          metadata: { changedFields: Object.keys(data) },
        });
      }
      return toExamResponse(result.exam);
    },
  );

  fastify.post(
    "/exams/:id/publish",
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireCapability(Permission.ExamPublish),
      ],
      schema: {
        params: idParamsSchema,
        security: cookieAuth,
        "x-role": ["Admin", "Teacher"],
        response: {
          200: ExamSchema,
          404: ErrorResponseSchema,
        },
      },
    },
    /** Publish a draft exam, transitioning it to published status and snapshotting questions. Throws ExamAlreadyPublishedError if not in draft state. */
    async (request: FastifyRequest, reply: FastifyReply) => {
      const ctx = ensureTargetOrg(getRequestContext(request));
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
        const updated = await executeInTransaction(fastify.db, async (tx) => {
          const published = await publishExam(
            createExamRepoAdapter(createExamRepo(tx), ctx),
            id,
            questions,
          );
          await recordAtomicHttpAudit(tx, request, ctx, {
            action: "exam.publish",
            targetType: "exam",
            targetId: id,
          });
          return published;
        });
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
      preHandler: [
        fastify.authenticate,
        fastify.requireCapability(Permission.ExamClose),
      ],
      schema: {
        params: idParamsSchema,
        body: closeExamRequestSchema,
        security: cookieAuth,
        "x-role": ["Admin", "Teacher"],
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
      const ctx = ensureTargetOrg(getRequestContext(request));
      const { id } = request.params as { id: string };
      const reason = ((request.body as Record<string, unknown>)?.reason ??
        undefined) as string | undefined;

      const result = await executeAdminExamTransition(
        fastify.db,
        ctx,
        id,
        fastify.now(),
        async ({ tx, repo, exam }) => {
          const attemptRepo = createAttemptRepo(tx);

          // Unresolved-attempts guard: reject if active/in-flight attempts
          // remain (review decision #3).
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

          // Assert + mutate via the engine. closeExam is idempotent for
          // `closed` (returns as-is). A non-open, non-closed reconciled
          // status raises InvalidStateTransitionError; surfaced uniformly as
          // EXAM_CLOSE_NOT_ALLOWED (no UNRESOLVED reason) per ADR-005 §3.3.
          let closed: Exam;
          try {
            closed = await closeExam(repo, id);
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
        request,
        (data) =>
          data.fromStatus === "closed"
            ? []
            : [
                {
                  action: "exam.close",
                  targetType: "exam",
                  targetId: id,
                  metadata: {
                    reason,
                    fromStatus: data.fromStatus,
                    toStatus: "closed",
                    activeAttemptCount: data.unresolvedCount,
                  },
                },
              ],
      );

      if (!result) {
        return reply
          .code(404)
          .send(buildErrorResponse(request.id, "RESOURCE_NOT_FOUND"));
      }

      const { closed } = result.data;

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
      preHandler: [
        fastify.authenticate,
        fastify.requireCapability(Permission.ExamUnpublish),
      ],
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
      const ctx = ensureTargetOrg(getRequestContext(request));
      const { id } = request.params as { id: string };

      const result = await executeAdminExamTransition(
        fastify.db,
        ctx,
        id,
        fastify.now(),
        async ({ repo, exam }) => {
          // After reconcile, only a still-`published` exam may unpublish.
          if (exam.status !== "published") {
            throw new ExamUnpublishNotAllowedError();
          }
          const updated = await unpublishExam(repo, id);
          return { exam: updated, fromStatus: exam.status };
        },
        request,
        (data) => [
          {
            action: "exam.unpublish",
            targetType: "exam",
            targetId: id,
            metadata: { fromStatus: data.fromStatus, toStatus: "draft" },
          },
        ],
      );
      if (!result) {
        return reply
          .code(404)
          .send(buildErrorResponse(request.id, "RESOURCE_NOT_FOUND"));
      }
      return toExamResponse(result.data.exam);
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
      preHandler: [
        fastify.authenticate,
        fastify.requireCapability(Permission.ExamExtend),
      ],
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
      const ctx = ensureTargetOrg(getRequestContext(request));
      const { id } = request.params as { id: string };
      const { extendMinutes, reason } = request.body as {
        extendMinutes: number;
        reason?: string;
      };

      const result = await executeAdminExamTransition(
        fastify.db,
        ctx,
        id,
        fastify.now(),
        async ({ repo, exam }) => {
          const oldCloseAt = new Date(exam.closeAt);
          if (exam.status !== "open") {
            throw new ExamExtendNotAllowedError({
              reason: exam.status === "closed" ? "ALREADY_CLOSED" : "NOT_OPEN",
            });
          }
          const updated = await extendExam(repo, id, extendMinutes);
          return {
            exam: updated,
            oldCloseAt,
            newCloseAt: new Date(updated.closeAt),
          };
        },
        request,
        (data) => [
          {
            action: "exam.extend",
            targetType: "exam",
            targetId: id,
            metadata: {
              extendMinutes,
              oldCloseAt: data.oldCloseAt.toISOString(),
              newCloseAt: data.newCloseAt.toISOString(),
              reason,
            },
          },
        ],
      );
      if (!result) {
        return reply
          .code(404)
          .send(buildErrorResponse(request.id, "RESOURCE_NOT_FOUND"));
      }
      return toExamResponse(result.data.exam);
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
      preHandler: [
        fastify.authenticate,
        fastify.requireCapability(Permission.ExamCancel),
      ],
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
      const ctx = ensureTargetOrg(getRequestContext(request));
      const { id } = request.params as { id: string };
      const reason = ((request.body as Record<string, unknown>)?.reason ??
        undefined) as string | undefined;

      const result = await executeAdminExamTransition(
        fastify.db,
        ctx,
        id,
        fastify.now(),
        async ({ tx, repo, exam }) => {
          const attemptRepo = createAttemptRepo(tx);

          // Unresolved-attempts guard (only meaningful for open, but cheap).
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

          // Assert + mutate via the engine. Non-cancellable states
          // (draft/closed/canceled/archived) raise
          // InvalidStateTransitionError -> surfaced as EXAM_CANCEL_NOT_ALLOWED.
          let canceled: Exam;
          try {
            canceled = await cancelExam(repo, id);
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
        request,
        (data) => [
          {
            action: "exam.cancel",
            targetType: "exam",
            targetId: id,
            metadata: {
              reason,
              fromStatus: data.fromStatus,
              toStatus: "canceled",
              activeAttemptCount: data.unresolvedCount,
            },
          },
        ],
      );

      if (!result) {
        return reply
          .code(404)
          .send(buildErrorResponse(request.id, "RESOURCE_NOT_FOUND"));
      }

      return toExamResponse(result.data.exam);
    },
  );

  fastify.post(
    "/exams/:id/archive",
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireCapability(Permission.ExamArchive),
      ],
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
     * invalid transition, idempotent already-archived behavior (no duplicate
     * audit), and an atomic audit row in the same transaction.
     */
    async (request: FastifyRequest, reply: FastifyReply) => {
      const ctx = ensureTargetOrg(getRequestContext(request));
      const { id } = request.params as { id: string };
      const now = fastify.now();

      const result = await executeAdminExamTransition(
        fastify.db,
        ctx,
        id,
        now,
        async ({ repo, exam }) => {
          // Idempotent already-archived: detect no-op before calling archiveExam.
          if (exam.status === "archived") {
            return { archived: exam, fromStatus: exam.status };
          }
          let archived: Exam;
          try {
            archived = await archiveExam(repo, id);
          } catch (err) {
            if (err instanceof InvalidStateTransitionError) {
              throw new ExamArchiveNotAllowedError();
            }
            throw err;
          }
          return { archived, fromStatus: exam.status };
        },
        request,
        (data) =>
          data.fromStatus === "archived"
            ? []
            : [
                {
                  action: "exam.archive",
                  targetType: "exam",
                  targetId: id,
                  metadata: {
                    fromStatus: data.fromStatus,
                    toStatus: "archived",
                  },
                },
              ],
      );

      if (!result) {
        return reply
          .code(404)
          .send(buildErrorResponse(request.id, "RESOURCE_NOT_FOUND"));
      }

      const { archived } = result.data;

      return toExamResponse(archived);
    },
  );

  /**
   * Zod schema for the publish-results response payload (P2D-J5a).
   * `alreadyPublished` lets the caller detect the idempotent no-op case.
   */
  const publishResultsResponseSchema = z.object({
    ok: z.literal(true),
    resultsPublishedAt: z.string().datetime(),
    alreadyPublished: z.boolean(),
  });

  /**
   * POST /exams/:id/publish-results — Sets `resultsPublishedAt` so manual-mode
   * result visibility flips from hidden → visible. P2D-J5a.
   *
   * Allowed only from `published | open | closed` (after reconciliation);
   * `draft | canceled | archived` return 409 EXAM_PUBLISH_RESULTS_NOT_ALLOWED.
   * Idempotent: a repeat call returns ok=true with `alreadyPublished: true`
   * and leaves the stored timestamp unchanged.
   *
   * NOTE: this does NOT advance grading. Attempts still pending manual grading
   * stay hidden behind the `not_graded` hiddenReason.
   */
  fastify.post(
    "/exams/:id/publish-results",
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireCapability(Permission.ExamResultPublish),
      ],
      schema: {
        params: idParamsSchema,
        security: cookieAuth,
        "x-role": ["Admin", "Teacher"],
        response: {
          200: publishResultsResponseSchema,
          404: ErrorResponseSchema,
          409: ErrorResponseSchema,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const ctx = ensureTargetOrg(getRequestContext(request));
      const { id } = request.params as { id: string };
      let result: { exam: Exam; alreadyPublished: boolean } | null = null;
      try {
        result = await executeInTransaction(fastify.db, async (tx) => {
          const published = await publishResults(
            createExamRepoAdapter(createExamRepo(tx), ctx),
            id,
            fastify.now(),
          );
          if (!published.alreadyPublished) {
            await recordAtomicHttpAudit(tx, request, ctx, {
              action: "exam.publish_results",
              targetType: "exam",
              targetId: id,
              metadata: {
                resultsPublishedAt:
                  published.exam.resultsPublishedAt!.toISOString(),
              },
            });
          }
          return published;
        });
      } catch (err) {
        if (err instanceof InvalidStateTransitionError) {
          throw new ExamPublishResultsNotAllowedError();
        }
        // ValidationError here means the exam was not found.
        if (err instanceof ValidationError) {
          return reply
            .code(404)
            .send(buildErrorResponse(request.id, "RESOURCE_NOT_FOUND"));
        }
        throw err;
      }
      const { exam, alreadyPublished } = result;
      return {
        ok: true as const,
        resultsPublishedAt: exam.resultsPublishedAt!.toISOString(),
        alreadyPublished,
      };
    },
  );

  fastify.delete(
    "/exams/:id",
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireCapability(Permission.ExamDelete),
      ],
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
      const ctx = ensureTargetOrg(getRequestContext(request));
      const { id } = request.params as { id: string };
      const deleted = await executeInTransaction(fastify.db, async (tx) => {
        const txRepo = createExamRepo(tx);
        const exam = (await txRepo.findByIdForUpdate(ctx, id)) as Exam | null;
        if (!exam) return false;
        if (exam.status !== "draft") throw new ExamNotDraftError();
        if (!(await txRepo.delete(ctx, id))) return false;
        await recordAtomicHttpAudit(tx, request, ctx, {
          action: "exam.delete",
          targetType: "exam",
          targetId: id,
        });
        return true;
      });
      if (!deleted) {
        return reply
          .code(404)
          .send(buildErrorResponse(request.id, "RESOURCE_NOT_FOUND"));
      }
      return reply.code(204).send();
    },
  );

  fastify.get(
    "/exams/:examId/enrollments",
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireCapability(Permission.ExamEnrollmentManage),
      ],
      schema: {
        params: examIdParamsSchema,
        security: cookieAuth,
        "x-role": ["Admin", "Teacher"],
        response: {
          200: z.array(enrollmentListItemSchema),
          404: ErrorResponseSchema,
        },
      },
    },
    /** List all enrollments for a given exam, including candidate display names and identity fields. Returns 404 if exam not found. */
    async (request: FastifyRequest, reply: FastifyReply) => {
      const ctx = ensureTargetOrg(getRequestContext(request));
      const { examId } = request.params as { examId: string };
      const examRepo = createExamRepo(fastify.db);
      const exam = (await examRepo.findById(ctx, examId)) as Exam | null;
      if (!exam) {
        return reply
          .code(404)
          .send(buildErrorResponse(request.id, "RESOURCE_NOT_FOUND"));
      }

      const enrollmentRepo = createEnrollmentRepo(fastify.db);
      const enrollments = await enrollmentRepo.listByExam(ctx, examId);
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
      preHandler: [
        fastify.authenticate,
        fastify.requireCapability(Permission.ExamEnrollmentManage),
      ],
      schema: {
        params: examIdParamsSchema,
        body: EnrollCandidatesRequestSchema,
        security: cookieAuth,
        "x-role": ["Admin", "Teacher"],
        response: {
          200: enrollmentAddResponseSchema,
          400: ErrorResponseSchema,
          404: ErrorResponseSchema,
        },
      },
    },
    /** Batch enroll candidates into an exam. Skips already-enrolled or non-existent candidates. Returns counts of added and skipped. */
    async (request, reply) => {
      const ctx = ensureTargetOrg(getRequestContext(request));
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
      const existing = await enrollmentRepo.listByExam(ctx, examId);
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
        const enrollment = await executeInTransaction(
          fastify.db,
          async (tx) => {
            const created = await createEnrollmentRepo(tx).create(ctx, {
              examId,
              candidateId,
              status: "assigned",
              attemptCount: 0,
            });
            await recordAtomicHttpAudit(tx, request, ctx, {
              action: "enrollment.add",
              targetType: "enrollment",
              targetId: created.id,
              metadata: { examId, candidateId },
            });
            return created;
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
      preHandler: [
        fastify.authenticate,
        fastify.requireCapability(Permission.ExamEnrollmentManage),
      ],
      schema: {
        params: enrollmentIdParamsSchema,
        security: cookieAuth,
        "x-role": ["Admin", "Teacher"],
        response: {
          204: z.null(),
          404: ErrorResponseSchema,
          409: ErrorResponseSchema,
        },
      },
    },
    /** Remove an enrollment from an exam. Only enrollments with status "assigned" can be removed. Returns 404 if not found, 409 if already started. */
    async (request: FastifyRequest, reply: FastifyReply) => {
      const ctx = ensureTargetOrg(getRequestContext(request));
      const { examId, enrollmentId } = request.params as {
        examId: string;
        enrollmentId: string;
      };
      const removalResult = await executeInTransaction(
        fastify.db,
        async (tx) => {
          const txRepo = createEnrollmentRepo(tx);
          const enrollment = await txRepo.findByIdForUpdate(ctx, enrollmentId);
          if (!enrollment || enrollment.examId !== examId) {
            return "not_found" as const;
          }
          if (enrollment.status !== "assigned") {
            return "not_removable" as const;
          }
          if (!(await txRepo.delete(ctx, enrollmentId))) {
            return "not_found" as const;
          }
          await recordAtomicHttpAudit(tx, request, ctx, {
            action: "enrollment.remove",
            targetType: "enrollment",
            targetId: enrollmentId,
            metadata: { examId, candidateId: enrollment.candidateId },
          });
          return "removed" as const;
        },
      );
      if (removalResult === "not_found") {
        return reply
          .code(404)
          .send(buildErrorResponse(request.id, "RESOURCE_NOT_FOUND"));
      }
      if (removalResult === "not_removable") {
        return reply
          .code(409)
          .send(buildErrorResponse(request.id, "ENROLLMENT_NOT_REMOVABLE"));
      }
      return reply.code(204).send();
    },
  );

  /**
   * GET /admin/exams/:examId/candidates/status — Returns the live status of
   * every enrolled candidate for a given exam. Used by the proctor dashboard
   * (P2C-J5) which polls this endpoint every 5 seconds. Admin and Teacher.
   */
  fastify.get(
    "/admin/exams/:examId/candidates/status",
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireCapability(Permission.ExamEnrollmentManage),
      ],
      schema: {
        params: examIdParamsSchema,
        security: cookieAuth,
        "x-role": ["Admin", "Teacher"],
        response: {
          200: CandidateStatusResponseSchema,
          404: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const ctx = ensureTargetOrg(getRequestContext(request));
      const { examId } = request.params as { examId: string };
      const examRepo = createExamRepo(fastify.db);
      const exam = (await examRepo.findById(ctx, examId)) as Exam | null;
      if (!exam) {
        return reply
          .code(404)
          .send(buildErrorResponse(request.id, "RESOURCE_NOT_FOUND"));
      }

      const candidates = await buildCandidateStatusItems(
        fastify.db,
        ctx,
        examId,
      );

      return CandidateStatusResponseSchema.parse({
        candidates,
        total: candidates.length,
      });
    },
  );
};

/**
 * Returns the subset of request fields whose value differs from the current
 * exam. Fields not present in `data` are ignored. Used to skip no-op PATCH
 * mutations and their audits.
 */
function determineChangedExamFields(
  data: Record<string, unknown>,
  existing: Exam,
): string[] {
  return Object.entries(data)
    .filter(([key, value]) => {
      if (value === undefined) return false;
      const current = (existing as unknown as Record<string, unknown>)[key];
      if (current instanceof Date) {
        return value !== current.toISOString();
      }
      if (
        typeof value === "object" &&
        value !== null &&
        typeof current === "object" &&
        current !== null
      ) {
        return JSON.stringify(value) !== JSON.stringify(current);
      }
      return value !== current;
    })
    .map(([key]) => key);
}

export default examRoutes;
