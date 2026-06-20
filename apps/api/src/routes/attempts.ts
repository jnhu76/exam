import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  CandidateExamDetailResponseSchema,
  CandidateExamSummarySchema,
  HeartbeatRequestSchema,
  LoadAttemptParamsSchema,
  LoadAttemptResponseSchema,
  QueueStatusResponseSchema,
  RestoreAttemptRequestSchema,
  SaveAnswerParamsSchema,
  SaveAnswerRequestSchema,
  SaveAnswerAcceptedSchema,
  SaveAnswerRejectedSchema,
  SaveAnswerResponseSchema,
  StartAttemptRequestSchema,
  SubmitAttemptRequestSchema,
  ForceSubmitRequestSchema,
  AttemptIdParamsSchema,
  getSaveAnswerMessage,
  ErrorResponseSchema,
} from "@exam/contracts";
import type {
  RequestContext,
  ExamAttempt,
  Exam,
  ExamEnrollment,
  EnrollmentStatus,
  AttemptStatus,
} from "@exam/domain";
import type { AnswerRecord } from "@exam/domain";
import {
  NotFoundError,
  ValidationError,
  InvalidStateTransitionError,
  ConflictError,
  PermissionDeniedError,
} from "@exam/domain";
import { type AvailabilityStatus, type PrimaryAction } from "@exam/contracts";
import {
  deriveCandidateExamState,
  pickDisplayAttempt,
  checkAndUpdateExamStatus,
} from "@exam/exam-engine";
import { createExamRepo } from "@exam/db/src/repository/examRepo.js";
import { createAttemptRepo } from "@exam/db/src/repository/attemptRepo.js";
import { executeInTransaction } from "@exam/db/src/types.js";
import { createEnrollmentRepo } from "@exam/db/src/repository/enrollmentRepo.js";
import { createCandidateRepo } from "@exam/db/src/repository/candidateRepo.js";
import {
  startOrRestoreAttempt,
  submitAttempt,
  restoreAttempt,
  readGradingSnapshot,
  computeGradingResult,
  finalizeGrading,
  gradeAttemptIdempotent,
} from "@exam/exam-engine";
import { processSaveAnswer } from "@exam/exam-engine";
import {
  createExamRepoAdapter,
  createAttemptRepoAdapter,
  createEnrollmentRepoAdapter,
} from "../adapters/repoAdapters.js";
import { recordAudit } from "./audit.js";
import { createAuditLogRepo } from "@exam/db/src/repository/auditLogRepo.js";
import type { Database } from "@exam/db/src/types.js";
import { ensureTargetOrg, formatZodError } from "./helpers.js";
import { buildErrorResponse } from "../lib/errorResponse.js";

// Wire response schemas (Zod) — single source of truth for serialization +
// OpenAPI. SaveAnswer is an accepted/rejected union.
const candidateExamListResponseSchema = z.array(CandidateExamSummarySchema);
const heartbeatResponseSchema = z.object({
  ok: z.literal(true),
  serverNow: z.string().datetime(),
});
const cookieAuth = [{ cookieAuth: [] }] as const;

/**
 * Represents a stored answer with client-side sequencing metadata.
 * Extends AnswerRecord with a flexible savedAt type (Date or ISO string)
 * and optional clientSeq / clientSeqHistory for idempotent save deduplication.
 */
interface StoredAnswer extends Omit<AnswerRecord, "savedAt"> {
  savedAt: Date | string;
  clientSeq?: number;
  clientSeqHistory?: StoredAnswerReceipt[];
}

/**
 * Receipt of a single client-side answer save, recording the clientSeq,
 * answer payload, version, and timestamp for conflict detection.
 */
interface StoredAnswerReceipt {
  clientSeq: number;
  answer: unknown;
  version: number;
  savedAt: Date | string;
}

/**
 * A StoredAnswer that has been normalized so savedAt is always a Date.
 * Used after normalizeAnswers() for consistent server-side processing.
 */
interface NormalizedStoredAnswer extends AnswerRecord {
  clientSeq?: number;
  clientSeqHistory?: StoredAnswerReceipt[];
}

/**
 * A candidate's entry in the in-memory exam queue, tracking when they joined.
 */
interface QueueEntry {
  candidateId: string;
  joinedAt: Date;
}

/**
 * In-memory exam admission queues keyed by examId.
 * Used for batch-release queue gating when requireQueue is enabled.
 */
const examQueues = new Map<string, QueueEntry[]>();

/**
 * Converts StoredAnswer[] (which may have string dates) to NormalizedStoredAnswer[]
 * with all savedAt fields guaranteed to be Date objects.
 */
function normalizeAnswers(answers: StoredAnswer[]): NormalizedStoredAnswer[] {
  return answers.map((a) => ({
    ...a,
    savedAt: typeof a.savedAt === "string" ? new Date(a.savedAt) : a.savedAt,
    ...(a.clientSeqHistory
      ? {
          clientSeqHistory: a.clientSeqHistory.map((receipt) => ({
            ...receipt,
            savedAt:
              typeof receipt.savedAt === "string"
                ? new Date(receipt.savedAt)
                : receipt.savedAt,
          })),
        }
      : {}),
  }));
}

/**
 * Serializes an ExamAttempt domain object into the API response shape,
 * converting Date fields to ISO strings and conditionally including score/passed.
 */
function toAttemptResponse(attempt: ExamAttempt) {
  return {
    id: attempt.id,
    organizationId: attempt.organizationId,
    examId: attempt.examId,
    enrollmentId: attempt.enrollmentId,
    candidateId: attempt.candidateId,
    attemptNo: attempt.attemptNo,
    status: attempt.status,
    questionSnapshot: attempt.questionSnapshot,
    answers: attempt.answers.map((a) => ({
      questionId: a.questionId,
      answer: a.answer,
      version: a.version,
      savedAt: new Date(a.savedAt).toISOString(),
    })),
    ...(attempt.score == null ? {} : { score: attempt.score }),
    ...(attempt.passed == null ? {} : { passed: attempt.passed }),
    startedAt: attempt.startedAt?.toISOString(),
    submittedAt: attempt.submittedAt?.toISOString(),
    deadlineAt: attempt.deadlineAt?.toISOString(),
    lastActivityAt: attempt.lastActivityAt?.toISOString(),
    createdAt: attempt.createdAt.toISOString(),
    updatedAt: attempt.updatedAt.toISOString(),
  };
}

/**
 * Computes the queue admission status for a candidate, adding them to the
 * in-memory queue if not already present. Returns position, wait count,
 * and estimated wait based on batch release intervals.
 */
function getQueueStatus(exam: Exam, candidateId: string, now: Date) {
  const queue = examQueues.get(exam.id) ?? [];
  const existing = queue.find((entry) => entry.candidateId === candidateId);
  const entry = existing ?? { candidateId, joinedAt: now };
  if (!existing) {
    queue.push(entry);
    examQueues.set(exam.id, queue);
  }

  const position = queue.indexOf(entry) + 1;
  const elapsedSeconds = Math.floor(
    (now.getTime() - queue[0]!.joinedAt.getTime()) / 1000,
  );
  const releasedBatches =
    Math.floor(elapsedSeconds / exam.controlFlags.batchInterval) + 1;
  const releasedCount = releasedBatches * exam.controlFlags.batchSize;
  const status = position <= releasedCount ? "ready" : "waiting";
  const batchesUntilReady = Math.max(
    0,
    Math.ceil(position / exam.controlFlags.batchSize) - releasedBatches,
  );

  return QueueStatusResponseSchema.parse({
    examId: exam.id,
    status,
    position,
    waitCount: Math.max(0, position - releasedCount),
    estimatedWaitSeconds: batchesUntilReady * exam.controlFlags.batchInterval,
  });
}

/**
 * Serializes an ExamAttempt for candidate-facing responses, stripping
 * standardAnswer and other admin-only fields from the question snapshot.
 */
function toCandidateAttemptResponse(attempt: ExamAttempt, now: Date) {
  return {
    ...toAttemptResponse(attempt),
    serverNow: now.toISOString(),
    questionSnapshot: attempt.questionSnapshot.map((q) => ({
      originalQuestionId: q.originalQuestionId,
      type: q.type,
      content: q.content,
      attachments: q.attachments,
      options: q.options,
      score: q.score,
      gradingRule: q.gradingRule,
      order: q.order,
    })),
  };
}

/**
 * Builds a lookup map from "questionId:clientSeq" to AnswerRecord,
 * used for idempotent answer deduplication during the save protocol.
 */
function buildClientSeqMap(answers: StoredAnswer[]): Map<string, AnswerRecord> {
  const map = new Map<string, AnswerRecord>();
  for (const answer of answers) {
    for (const receipt of answer.clientSeqHistory ?? []) {
      map.set(`${answer.questionId}:${receipt.clientSeq}`, {
        questionId: answer.questionId,
        answer: receipt.answer,
        version: receipt.version,
        savedAt: new Date(receipt.savedAt),
      });
    }
    if (answer.clientSeq !== undefined) {
      map.set(
        `${answer.questionId}:${answer.clientSeq}`,
        answer as AnswerRecord,
      );
    }
  }
  return map;
}

/**
 * Retrieves the candidate profile for the currently authenticated user.
 * Throws NotFoundError if no profile exists for the user.
 */
async function getCandidateProfile(
  fastify: Parameters<FastifyPluginAsync>[0],
  ctx: RequestContext,
) {
  const candidateProfile = await createCandidateRepo(fastify.db).findByUserId(
    ctx,
    ctx.actorId,
  );
  if (!candidateProfile) {
    throw new NotFoundError("Candidate profile not found");
  }
  return candidateProfile;
}

/**
 * Retrieves an attempt owned by the current candidate, verifying both
 * existence and candidate ownership. Throws NotFoundError otherwise.
 */
async function getOwnedAttempt(
  fastify: Parameters<FastifyPluginAsync>[0],
  ctx: RequestContext,
  attemptId: string,
) {
  const candidateProfile = await getCandidateProfile(fastify, ctx);
  const attempt = (await createAttemptRepo(fastify.db).findByIdAndCandidate(
    ctx,
    attemptId,
    candidateProfile.id,
  )) as ExamAttempt | null;
  if (!attempt) {
    throw new NotFoundError("Attempt not found");
  }
  return attempt;
}

/**
 * Normalizes a raw DB enrollment row into the ExamEnrollment domain type,
 * casting status and conditionally including nullable final score/passed/attemptId fields.
 */
function normalizeEnrollment(
  enrollment: Awaited<
    ReturnType<
      ReturnType<typeof createEnrollmentRepo>["findByExamAndCandidate"]
    >
  >,
): ExamEnrollment | null {
  if (!enrollment) {
    return null;
  }

  return {
    id: enrollment.id,
    organizationId: enrollment.organizationId,
    examId: enrollment.examId,
    candidateId: enrollment.candidateId,
    status: enrollment.status as EnrollmentStatus,
    attemptCount: enrollment.attemptCount,
    createdAt: enrollment.createdAt,
    updatedAt: enrollment.updatedAt,
    ...(enrollment.finalScore == null
      ? {}
      : { finalScore: enrollment.finalScore }),
    ...(enrollment.finalPassed == null
      ? {}
      : { finalPassed: enrollment.finalPassed }),
    ...(enrollment.finalAttemptId == null
      ? {}
      : { finalAttemptId: enrollment.finalAttemptId }),
  };
}

/**
 * Builds the candidate-facing exam detail response by deriving availability
 * status, primary action, best score, and attempt limits from the exam,
 * enrollment, and attempt state.
 */
function buildCandidateExamDetail(
  exam: Exam,
  enrollment: ExamEnrollment | null,
  activeAttempt: ExamAttempt | null,
  now: Date,
  resumableAttempt: ExamAttempt | null = null,
  latestAttempt: ExamAttempt | null = null,
  finalAttempt: ExamAttempt | null = null,
) {
  const currentAttempts = enrollment?.attemptCount ?? 0;
  const { availabilityStatus, primaryAction } = deriveCandidateExamState({
    exam,
    enrollment,
    activeAttempt,
    resumableAttempt,
    latestAttempt,
    finalAttempt,
    now,
  });

  const bestScore =
    enrollment?.finalScore != null ? enrollment.finalScore : undefined;
  const bestScorePercent =
    bestScore != null && exam.totalScore > 0
      ? Math.round((bestScore / exam.totalScore) * 100)
      : undefined;

  const hasActive = Boolean(activeAttempt) || Boolean(resumableAttempt);
  const maxAttemptsExhausted =
    exam.retakePolicy === "max_attempts" && currentAttempts >= exam.maxAttempts;
  const alreadyPassed =
    exam.retakePolicy === "pass_then_stop" && enrollment?.finalPassed === true;

  const canStartNewAttempt =
    !hasActive && !maxAttemptsExhausted && !alreadyPassed;

  const blockingReason = hasActive
    ? undefined
    : maxAttemptsExhausted
      ? "max_attempts_reached"
      : alreadyPassed
        ? "already_passed"
        : undefined;

  return CandidateExamDetailResponseSchema.parse({
    id: exam.id,
    title: exam.title,
    durationMinutes: exam.durationMinutes,
    passingScore: exam.passingScore,
    totalScore: exam.totalScore,
    questionCount: exam.questionSnapshot.length,
    controlFlags: exam.controlFlags,
    maxAttempts: exam.maxAttempts,
    latestStartOffsetMinutes: exam.latestStartOffsetMinutes,
    minSubmitAfterStartMinutes: exam.minSubmitAfterStartMinutes,
    currentAttempts,
    ...(activeAttempt ? { activeAttemptId: activeAttempt.id } : {}),
    canStartNewAttempt,
    ...(blockingReason ? { blockingReason } : {}),
    ...(bestScore != null ? { bestScore } : {}),
    ...(bestScorePercent != null ? { bestScorePercent } : {}),
    availabilityStatus,
    primaryAction,
  });
}

/**
 * Fastify plugin registering all candidate-facing attempt routes:
 * exam list, exam detail, queue, start, load, save answers, submit,
 * heartbeat, and restore.
 */
const attemptRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /candidate/exams — Returns a summary list of all exams the
   * authenticated candidate is enrolled in, with availability status
   * and best score per exam.
   */
  fastify.get(
    "/candidate/exams",
    {
      preHandler: [fastify.authenticate, fastify.requireRole(["Candidate"])],
      schema: {
        security: cookieAuth,
        "x-role": ["Candidate"],
        response: { 200: candidateExamListResponseSchema },
      },
    },
    async (request) => {
      const ctx = request["ctx"] as RequestContext;
      const candidateRepo = createCandidateRepo(fastify.db);
      const candidateProfile = await candidateRepo.findByUserId(
        ctx,
        ctx.actorId,
      );
      if (!candidateProfile) {
        return [];
      }

      const enrollmentRepo = createEnrollmentRepo(fastify.db);
      const enrollments = await enrollmentRepo.findByCandidate(
        ctx,
        candidateProfile.id,
      );

      const examRepo = createExamRepo(fastify.db);
      const attemptRepo = createAttemptRepo(fastify.db);
      // ADR-006: one operation now for this list request.
      const now = fastify.now();

      return Promise.all(
        enrollments.map(async (enrollment) => {
          const examAdapter = createExamRepoAdapter(examRepo, ctx);
          const result = await checkAndUpdateExamStatus(
            examAdapter,
            enrollment.examId,
            now,
          );
          if (!result) return null;
          const { exam, transition } = result;
          if (transition) {
            recordAudit(
              fastify,
              request,
              ctx,
              `exam.${transition}`,
              "exam",
              exam.id,
            );
          }

          const allAttempts = (await attemptRepo.findByExamAndCandidate(
            ctx,
            exam.id,
            candidateProfile.id,
          )) as ExamAttempt[];

          const activeAttempt =
            allAttempts.find((a) => a.status === "in_progress") ?? null;
          const resumableAttempt =
            allAttempts.find((a) => a.status === "disrupted") ?? null;
          const finalAttempt = allAttempts.find(
            (a) => a.id === enrollment.finalAttemptId,
          );

          const sortedByTime = [...allAttempts].sort(
            (a, b) =>
              (b.submittedAt?.getTime() ?? b.createdAt.getTime()) -
              (a.submittedAt?.getTime() ?? a.createdAt.getTime()),
          );
          const latestAttempt = sortedByTime[0] ?? null;

          const { availabilityStatus, primaryAction } =
            deriveCandidateExamState({
              exam,
              enrollment: normalizeEnrollment(enrollment),
              activeAttempt,
              resumableAttempt,
              latestAttempt,
              finalAttempt: finalAttempt ?? null,
              now,
            });

          const displayAttempt = pickDisplayAttempt({
            activeAttempt,
            resumableAttempt,
            latestAttempt,
            finalAttempt: finalAttempt ?? null,
          });

          const bestScore =
            enrollment.finalScore != null ? enrollment.finalScore : undefined;
          const bestScorePercent =
            bestScore != null && exam.totalScore > 0
              ? Math.round((bestScore / exam.totalScore) * 100)
              : undefined;

          return CandidateExamSummarySchema.parse({
            examId: exam.id,
            title: exam.title,
            windowStartAt: exam.openAt.toISOString(),
            windowEndAt: exam.closeAt.toISOString(),
            durationMinutes: exam.durationMinutes,
            totalQuestions: exam.questionSnapshot.length,
            passingScore: exam.passingScore,
            totalScore: exam.totalScore,
            attemptsUsed: enrollment.attemptCount,
            maxAttempts: exam.maxAttempts,
            latestStartOffsetMinutes: exam.latestStartOffsetMinutes,
            minSubmitAfterStartMinutes: exam.minSubmitAfterStartMinutes,
            ...(displayAttempt
              ? {
                  latestAttemptId: displayAttempt.id,
                  latestAttemptStatus: displayAttempt.status,
                }
              : {}),
            ...(bestScore != null ? { bestScore } : {}),
            ...(bestScorePercent != null ? { bestScorePercent } : {}),
            availabilityStatus,
            primaryAction,
          });
        }),
      ).then((results) =>
        results.filter(
          (exam): exam is NonNullable<typeof exam> => exam !== null,
        ),
      );
    },
  );

  /**
   * GET /candidate/exams/:examId — Returns the full detail view for a
   * single exam the candidate is enrolled in, including attempt limits,
   * best score, availability status, and primary action.
   */
  fastify.get(
    "/candidate/exams/:examId",
    {
      preHandler: [fastify.authenticate, fastify.requireRole(["Candidate"])],
      schema: {
        params: StartAttemptRequestSchema,
        security: cookieAuth,
        "x-role": ["Candidate"],
        response: {
          200: CandidateExamDetailResponseSchema,
          400: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const parsed = StartAttemptRequestSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply.code(400).send(formatZodError(request.id, parsed.error));
      }
      const ctx = request["ctx"] as RequestContext;
      const candidateProfile = await getCandidateProfile(fastify, ctx);
      // ADR-006: one operation now, threaded through the whole request.
      const now = fastify.now();
      const examRepo = createExamRepo(fastify.db);
      const statusResult = await checkAndUpdateExamStatus(
        createExamRepoAdapter(examRepo, ctx),
        parsed.data.examId,
        now,
      );
      if (!statusResult) {
        throw new NotFoundError("Exam not found");
      }
      const { exam, transition } = statusResult;
      if (transition) {
        recordAudit(
          fastify,
          request,
          ctx,
          `exam.${transition}`,
          "exam",
          exam.id,
        );
      }

      const rawEnrollment = await createEnrollmentRepo(
        fastify.db,
      ).findByExamAndCandidate(ctx, parsed.data.examId, candidateProfile.id);
      if (!rawEnrollment) {
        throw new NotFoundError("Enrollment not found");
      }
      const enrollment = normalizeEnrollment(rawEnrollment);
      const allAttempts = (await createAttemptRepo(
        fastify.db,
      ).findByExamAndCandidate(
        ctx,
        parsed.data.examId,
        candidateProfile.id,
      )) as ExamAttempt[];

      const activeAttempt =
        allAttempts.find((a) => a.status === "in_progress") ?? null;
      const resumableAttempt =
        allAttempts.find((a) => a.status === "disrupted") ?? null;
      const finalAttempt =
        allAttempts.find((a) => a.id === enrollment?.finalAttemptId) ?? null;
      const sortedByTime = [...allAttempts].sort(
        (a, b) =>
          (b.submittedAt?.getTime() ?? b.createdAt.getTime()) -
          (a.submittedAt?.getTime() ?? a.createdAt.getTime()),
      );
      const latestAttempt = sortedByTime[0] ?? null;

      return buildCandidateExamDetail(
        exam,
        enrollment,
        activeAttempt,
        now,
        resumableAttempt,
        latestAttempt,
        finalAttempt,
      );
    },
  );

  /**
   * POST /attempts/:examId/queue — Joins the candidate into the exam's
   * admission queue and returns their current position and estimated wait.
   */
  fastify.post(
    "/attempts/:examId/queue",
    {
      preHandler: [fastify.authenticate, fastify.requireRole(["Candidate"])],
      schema: {
        params: StartAttemptRequestSchema,
        security: cookieAuth,
        "x-role": ["Candidate"],
        response: {
          200: QueueStatusResponseSchema,
          400: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const parsed = StartAttemptRequestSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply.code(400).send(formatZodError(request.id, parsed.error));
      }
      const ctx = request["ctx"] as RequestContext;
      const candidateProfile = await getCandidateProfile(fastify, ctx);
      const exam = (await createExamRepo(fastify.db).findById(
        ctx,
        parsed.data.examId,
      )) as Exam | null;
      if (!exam) {
        throw new NotFoundError("Exam not found");
      }
      return getQueueStatus(exam, candidateProfile.id, fastify.now());
    },
  );

  /**
   * POST /attempts/:examId/start — Starts a new attempt or restores an
   * existing one. Returns 201 for a new attempt, 200 for a restored one.
   * If the exam requires queue admission, the candidate must be "ready" first.
   */
  fastify.post(
    "/attempts/:examId/start",
    {
      preHandler: [fastify.authenticate, fastify.requireRole(["Candidate"])],
      schema: {
        params: StartAttemptRequestSchema,
        security: cookieAuth,
        "x-role": ["Candidate"],
        response: {
          200: LoadAttemptResponseSchema,
          201: LoadAttemptResponseSchema,
          400: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const parsed = StartAttemptRequestSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply.code(400).send(formatZodError(request.id, parsed.error));
      }
      const ctx = request["ctx"] as RequestContext;
      const { examId } = parsed.data;
      const candidateProfile = await getCandidateProfile(fastify, ctx);
      const candidateId = candidateProfile.id;

      const examRepo = createExamRepo(fastify.db);
      const statusResult = await checkAndUpdateExamStatus(
        createExamRepoAdapter(examRepo, ctx),
        examId,
        fastify.now(),
      );
      if (!statusResult) {
        throw new NotFoundError("Exam not found");
      }
      const { exam, transition } = statusResult;
      if (transition) {
        recordAudit(
          fastify,
          request,
          ctx,
          `exam.${transition}`,
          "exam",
          examId,
        );
      }
      if (
        exam.controlFlags.requireQueue &&
        getQueueStatus(exam, candidateId, fastify.now()).status !== "ready"
      ) {
        throw new ConflictError(
          "Queue admission required before starting this exam",
        );
      }

      const { attempt, isNew } = await executeInTransaction(
        fastify.db,
        async (tx) => {
          const examRepoAdapter = createExamRepoAdapter(
            createExamRepo(tx),
            ctx,
          );
          const enrRepoAdapter = createEnrollmentRepoAdapter(
            createEnrollmentRepo(tx),
            ctx,
          );
          const attRepoAdapter = createAttemptRepoAdapter(
            createAttemptRepo(tx),
            ctx,
          );

          return startOrRestoreAttempt(
            examRepoAdapter,
            enrRepoAdapter,
            attRepoAdapter,
            examId,
            candidateId,
            fastify.now(),
            {
              unassignedErrorFactory: (message) =>
                new PermissionDeniedError(message),
            },
          );
        },
      );

      recordAudit(
        fastify,
        request,
        ctx,
        isNew ? "attempt.start" : "attempt.restore",
        "attempt",
        attempt.id,
      );
      examQueues.set(
        examId,
        (examQueues.get(examId) ?? []).filter(
          (entry) => entry.candidateId !== candidateId,
        ),
      );
      if (isNew) {
        return reply
          .code(201)
          .send(
            LoadAttemptResponseSchema.parse(
              toCandidateAttemptResponse(attempt, fastify.now()),
            ),
          );
      }
      return reply
        .code(200)
        .send(
          LoadAttemptResponseSchema.parse(
            toCandidateAttemptResponse(attempt, fastify.now()),
          ),
        );
    },
  );

  /**
   * GET /attempts/:id — Loads a single attempt owned by the current
   * candidate, including the question snapshot and all saved answers.
   */
  fastify.get(
    "/attempts/:id",
    {
      preHandler: [fastify.authenticate, fastify.requireRole(["Candidate"])],
      schema: {
        params: LoadAttemptParamsSchema,
        security: cookieAuth,
        "x-role": ["Candidate"],
        response: {
          200: LoadAttemptResponseSchema,
          400: ErrorResponseSchema,
          409: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const parsed = LoadAttemptParamsSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply.code(400).send(formatZodError(request.id, parsed.error));
      }
      const ctx = request["ctx"] as RequestContext;
      const attempt = await getOwnedAttempt(fastify, ctx, parsed.data.id);
      return LoadAttemptResponseSchema.parse(
        toCandidateAttemptResponse(attempt, fastify.now()),
      );
    },
  );

  /**
   * POST /attempts/:attemptId/answers/:questionId — Saves a single
   * answer for a question within an in-progress attempt. Uses the
   * versioned, idempotent Answer Save Protocol with conflict detection.
   */
  fastify.post(
    "/attempts/:attemptId/answers/:questionId",
    {
      preHandler: [fastify.authenticate, fastify.requireRole(["Candidate"])],
      schema: {
        params: SaveAnswerParamsSchema,
        body: SaveAnswerRequestSchema,
        security: cookieAuth,
        "x-role": ["Candidate"],
        response: {
          200: SaveAnswerResponseSchema,
          400: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const parsedParams = SaveAnswerParamsSchema.safeParse(request.params);
      if (!parsedParams.success) {
        return reply
          .code(400)
          .send(formatZodError(request.id, parsedParams.error));
      }
      const parsedBody = SaveAnswerRequestSchema.safeParse(request.body);
      if (!parsedBody.success) {
        return reply
          .code(400)
          .send(formatZodError(request.id, parsedBody.error));
      }
      const ctx = request["ctx"] as RequestContext;
      const { attemptId, questionId } = parsedParams.data;
      // ADR-006: one operation now for the whole save-answer request, reused
      // by the answer protocol and the heartbeat lastActivityAt stamp.
      const now = fastify.now();
      const body = parsedBody.data;
      if (body.attemptId !== attemptId || body.questionId !== questionId) {
        throw new ValidationError("Path and body identifiers must match");
      }

      const result = await executeInTransaction(fastify.db, async (tx) => {
        const txRepo = createAttemptRepo(tx);
        const candidateProfile = await createCandidateRepo(tx).findByUserId(
          ctx,
          ctx.actorId,
        );
        if (!candidateProfile) {
          throw new NotFoundError("候选人资料不存在");
        }
        const lockedAttempt = await txRepo.findByIdForUpdate(ctx, attemptId);
        if (
          !lockedAttempt ||
          lockedAttempt.candidateId !== candidateProfile.id
        ) {
          throw new NotFoundError("尝试不存在");
        }
        if (
          !lockedAttempt.questionSnapshot.some(
            (question) => question.originalQuestionId === questionId,
          )
        ) {
          throw new ValidationError("问题不在此尝试中");
        }

        const storedAnswers = normalizeAnswers(
          lockedAttempt.answers as StoredAnswer[],
        );
        const clientSeqMap = buildClientSeqMap(storedAnswers);

        const saveResult = processSaveAnswer(
          {
            attemptStatus: lockedAttempt.status as AttemptStatus,
            answers: lockedAttempt.answers,
            clientSeqMap,
            ...(lockedAttempt.deadlineAt
              ? { deadlineAt: lockedAttempt.deadlineAt }
              : {}),
            now,
          },
          {
            attemptId,
            questionId,
            answer: body.answer,
            clientSeq: body.clientSeq,
            clientSavedAt: body.clientSavedAt,
            baseVersion: body.baseVersion,
          },
        );

        if (saveResult.accepted && saveResult.newAnswer) {
          const previousAnswer = storedAnswers.find(
            (answer) => answer.questionId === questionId,
          );
          const previousReceipt =
            previousAnswer?.clientSeq === undefined
              ? []
              : [
                  {
                    clientSeq: previousAnswer.clientSeq,
                    answer: previousAnswer.answer,
                    version: previousAnswer.version,
                    savedAt: previousAnswer.savedAt,
                  },
                ];
          const storedNewAnswer: NormalizedStoredAnswer = {
            ...saveResult.newAnswer,
            clientSeq: body.clientSeq,
            clientSeqHistory: [
              ...(previousAnswer?.clientSeqHistory ?? []),
              ...previousReceipt,
            ],
          };
          const newAnswers = storedAnswers
            .filter((a) => a.questionId !== questionId)
            .concat([storedNewAnswer]);

          await txRepo.update(ctx, attemptId, {
            answers: newAnswers,
            lastActivityAt: now,
          } as Parameters<typeof txRepo.update>[2]);
        }

        return saveResult;
      });

      if (result.accepted) {
        recordAudit(
          fastify,
          request,
          ctx,
          "attempt.saveAnswer",
          "attempt",
          attemptId,
        );
      }

      if (result.accepted) {
        return SaveAnswerAcceptedSchema.parse({
          accepted: true,
          serverVersion: result.serverVersion,
          savedAt: result.savedAt,
        });
      }

      const conflict = result.conflict;
      return SaveAnswerRejectedSchema.parse({
        accepted: false,
        reason: conflict.reason,
        message: getSaveAnswerMessage(conflict.reason),
        serverVersion: result.serverVersion,
        savedAt: result.savedAt,
        details:
          conflict.reason === "STALE_VERSION"
            ? { serverAnswer: conflict.latestAnswer }
            : undefined,
      });
    },
  );

  /**
   * POST /attempts/:attemptId/submit — Submits an in-progress or disrupted
   * attempt for grading. Transitions the attempt to submitted, runs the
   * grading engine, and returns the graded result.
   */
  fastify.post(
    "/attempts/:attemptId/submit",
    {
      preHandler: [fastify.authenticate, fastify.requireRole(["Candidate"])],
      schema: {
        params: SubmitAttemptRequestSchema,
        security: cookieAuth,
        "x-role": ["Candidate"],
        response: {
          200: LoadAttemptResponseSchema,
          400: ErrorResponseSchema,
          409: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const parsed = SubmitAttemptRequestSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply.code(400).send(formatZodError(request.id, parsed.error));
      }
      const ctx = request["ctx"] as RequestContext;
      const { attemptId } = parsed.data;

      const phaseOne = await executeInTransaction(fastify.db, async (tx) => {
        const txAttemptRepo = createAttemptRepo(tx);
        const candidateProfile = await createCandidateRepo(tx).findByUserId(
          ctx,
          ctx.actorId,
        );
        if (!candidateProfile) {
          throw new NotFoundError("Candidate profile not found");
        }
        const lockedAttempt = await txAttemptRepo.findByIdForUpdate(
          ctx,
          attemptId,
        );
        if (
          !lockedAttempt ||
          lockedAttempt.candidateId !== candidateProfile.id
        ) {
          throw new NotFoundError("Attempt not found");
        }

        const status = lockedAttempt.status;
        if (status === "in_progress" || status === "disrupted") {
          // ADR-005 Slice 3: candidate manual submit is subject to the
          // minSubmitAfterStartMinutes guard. Fetch the exam for the field.
          const exam = (await createExamRepo(tx).findById(
            ctx,
            lockedAttempt.examId,
          )) as Exam | null;
          await submitAttempt(
            createAttemptRepoAdapter(txAttemptRepo, ctx),
            attemptId,
            fastify.now(),
            {
              source: "candidate",
              minSubmitAfterStartMinutes:
                exam?.minSubmitAfterStartMinutes ?? null,
            },
          );
          return { alreadyGraded: false } as const;
        }
        if (status === "submitted") {
          return { alreadyGraded: false } as const;
        }
        if (status === "graded") {
          return { alreadyGraded: true } as const;
        }
        throw new InvalidStateTransitionError(
          `Cannot submit attempt in ${status} state`,
        );
      });

      const attemptRepo = createAttemptRepo(fastify.db);

      if (phaseOne.alreadyGraded) {
        const graded = await attemptRepo.findById(ctx, attemptId);
        if (!graded) {
          throw new NotFoundError("Attempt not found");
        }
        return LoadAttemptResponseSchema.parse(
          toCandidateAttemptResponse(graded as ExamAttempt, fastify.now()),
        );
      }

      const examRepo = createExamRepo(fastify.db);
      const enrollmentRepo = createEnrollmentRepo(fastify.db);

      const snapshot = await readGradingSnapshot(
        createExamRepoAdapter(examRepo, ctx),
        createEnrollmentRepoAdapter(enrollmentRepo, ctx),
        createAttemptRepoAdapter(attemptRepo, ctx),
        attemptId,
      );
      if (!snapshot) {
        throw new NotFoundError("Attempt not found after submit");
      }

      const gradingResult = computeGradingResult(
        snapshot.attempt,
        snapshot.exam,
        fastify.now(),
      );

      await executeInTransaction(fastify.db, async (tx) => {
        const txAttemptRepo = createAttemptRepo(tx);
        await txAttemptRepo.findByIdForUpdate(ctx, attemptId);
        await finalizeGrading(
          createEnrollmentRepoAdapter(createEnrollmentRepo(tx), ctx),
          createAttemptRepoAdapter(txAttemptRepo, ctx),
          attemptId,
          snapshot.enrollment.id,
          gradingResult,
          snapshot.exam,
        );
      });

      const attempt = await attemptRepo.findById(ctx, attemptId);
      if (!attempt) {
        throw new NotFoundError("Attempt not found after grading");
      }
      recordAudit(
        fastify,
        request,
        ctx,
        "attempt.submit",
        "attempt",
        attemptId,
      );

      return LoadAttemptResponseSchema.parse(
        toCandidateAttemptResponse(attempt as ExamAttempt, fastify.now()),
      );
    },
  );

  /**
   * POST /attempts/:attemptId/heartbeat — Updates the lastActivityAt
   * timestamp on an in-progress attempt to prevent disruption timeout.
   */
  fastify.post(
    "/attempts/:attemptId/heartbeat",
    {
      preHandler: [fastify.authenticate, fastify.requireRole(["Candidate"])],
      schema: {
        params: HeartbeatRequestSchema,
        security: cookieAuth,
        "x-role": ["Candidate"],
        response: {
          200: heartbeatResponseSchema,
          400: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const parsed = HeartbeatRequestSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply.code(400).send(formatZodError(request.id, parsed.error));
      }
      const ctx = request["ctx"] as RequestContext;
      const { attemptId } = parsed.data;
      // ADR-006: one operation now for the heartbeat — used for both the
      // lastActivityAt stamp and the returned serverNow so they cannot drift.
      const now = fastify.now();
      const attemptRepo = createAttemptRepo(fastify.db);
      const attempt = await getOwnedAttempt(fastify, ctx, attemptId);
      if (attempt.status !== "in_progress") {
        throw new InvalidStateTransitionError(
          `Cannot heartbeat attempt in ${attempt.status} state`,
        );
      }

      await attemptRepo.update(ctx, attemptId, {
        lastActivityAt: now,
      } as Parameters<typeof attemptRepo.update>[2]);

      return { ok: true, serverNow: now.toISOString() };
    },
  );

  /**
   * POST /attempts/:attemptId/restore — Explicitly restores a disrupted
   * attempt back to in-progress, restoring saved answers and remaining time.
   */
  fastify.post(
    "/attempts/:attemptId/restore",
    {
      preHandler: [fastify.authenticate, fastify.requireRole(["Candidate"])],
      schema: {
        params: RestoreAttemptRequestSchema,
        security: cookieAuth,
        "x-role": ["Candidate"],
        response: {
          200: LoadAttemptResponseSchema,
          400: ErrorResponseSchema,
          409: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const parsed = RestoreAttemptRequestSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply.code(400).send(formatZodError(request.id, parsed.error));
      }
      const ctx = request["ctx"] as RequestContext;
      const { attemptId } = parsed.data;
      await getOwnedAttempt(fastify, ctx, attemptId);

      const attempt = await executeInTransaction(fastify.db, async (tx) => {
        const examRepo = createExamRepo(tx);
        const attemptRepo = createAttemptRepo(tx);

        const examRepoAdapter = createExamRepoAdapter(examRepo, ctx);
        const attRepoAdapter = createAttemptRepoAdapter(attemptRepo, ctx);

        return restoreAttempt(
          examRepoAdapter,
          attRepoAdapter,
          attemptId,
          fastify.now(),
        );
      });

      recordAudit(
        fastify,
        request,
        ctx,
        "attempt.restore",
        "attempt",
        attemptId,
      );
      return LoadAttemptResponseSchema.parse(
        toCandidateAttemptResponse(attempt, fastify.now()),
      );
    },
  );

  /**
   * POST /admin/attempts/:attemptId/force-submit — Admin force-submits an
   * in_progress or disrupted attempt, then grades it. Idempotent for
   * submitted/grading/graded (returns current result). voided is rejected.
   * Audit event: attempt.forceSubmit (with admin identity + optional reason).
   */
  fastify.post(
    "/admin/attempts/:attemptId/force-submit",
    {
      preHandler: [fastify.authenticate, fastify.requireRole(["Admin"])],
      schema: {
        params: AttemptIdParamsSchema,
        body: ForceSubmitRequestSchema,
        security: cookieAuth,
        "x-role": ["Admin"],
        response: {
          200: LoadAttemptResponseSchema,
          400: ErrorResponseSchema,
          403: ErrorResponseSchema,
          404: ErrorResponseSchema,
          409: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const parsed = AttemptIdParamsSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply.code(400).send(formatZodError(request.id, parsed.error));
      }
      const body = ForceSubmitRequestSchema.safeParse(request.body ?? {});
      if (!body.success) {
        return reply.code(400).send(formatZodError(request.id, body.error));
      }
      const ctx = ensureTargetOrg(request["ctx"] as RequestContext);
      const { attemptId } = parsed.data;
      const reason = body.data.reason;

      const forceSubmitted = await executeInTransaction(
        fastify.db,
        async (tx) => {
          const txAttemptRepo = createAttemptRepo(tx);
          const locked = await txAttemptRepo.findByIdForUpdate(ctx, attemptId);
          if (!locked) {
            throw new NotFoundError("Attempt not found");
          }
          // voided is the only truly invalid state for force-submit.
          if (locked.status === "voided") {
            throw new InvalidStateTransitionError(
              `Cannot force-submit attempt in ${locked.status} state`,
            );
          }
          // Idempotent: already terminal (submitted/grading/graded) -> no-op.
          const needsSubmit =
            locked.status === "in_progress" || locked.status === "disrupted";
          if (needsSubmit) {
            // Admin force-submit bypasses the candidate minSubmitAfterStartMinutes
            // guard (source = "proctor" — the SubmitSource for admin/proctor
            // intervention; "admin" is not a valid SubmitSource value).
            await submitAttempt(
              createAttemptRepoAdapter(txAttemptRepo, ctx),
              attemptId,
              fastify.now(),
              { source: "proctor" },
            );
            return true;
          }
          return false;
        },
      );

      if (forceSubmitted) {
        // Grade outside the submit transaction (matches candidate submit path).
        await executeInTransaction(fastify.db, async (tx) => {
          const txAttemptRepo = createAttemptRepo(tx);
          await txAttemptRepo.findByIdForUpdate(ctx, attemptId);
          await gradeAttemptIdempotent(
            createExamRepoAdapter(createExamRepo(tx), ctx),
            createEnrollmentRepoAdapter(createEnrollmentRepo(tx), ctx),
            createAttemptRepoAdapter(txAttemptRepo, ctx),
            attemptId,
            fastify.now(),
          );
        });
      }

      const attemptRepo = createAttemptRepo(fastify.db);
      const attempt = await attemptRepo.findById(ctx, attemptId);
      if (!attempt) {
        throw new NotFoundError("Attempt not found after force-submit");
      }

      // Audit only when a real transition occurred (P2C-J2 review fix): an
      // idempotent no-op (already submitted/grading/graded) must NOT emit a
      // duplicate audit row. Awaited + best-effort so the row is committed
      // before the response (spec §20/§23).
      if (forceSubmitted) {
        try {
          await createAuditLogRepo(fastify.db as Database).create(ctx, {
            actorId: ctx.actorId,
            action: "attempt.forceSubmit",
            targetType: "attempt",
            targetId: attemptId,
            metadata: {
              requestId: request.id,
              ...(reason ? { reason } : {}),
            },
            ipAddress: request.ip,
            userAgent: request.headers["user-agent"],
          });
        } catch (err) {
          request.log.error(
            { err, attemptId, action: "attempt.forceSubmit" },
            "Failed to record force-submit audit",
          );
        }
      }

      return LoadAttemptResponseSchema.parse(
        toCandidateAttemptResponse(attempt as ExamAttempt, fastify.now()),
      );
    },
  );
};

export default attemptRoutes;
