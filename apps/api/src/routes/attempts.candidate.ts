import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  CandidateExamDetailResponseSchema,
  CandidateExamSummarySchema,
  CandidateTakeSnapshotSchema,
  AttemptIdParamsSchema,
  HeartbeatRequestSchema,
  LoadAttemptParamsSchema,
  LoadAttemptResponseSchema,
  QueueStatusResponseSchema,
  RestoreAttemptRequestSchema,
  RestoreAttemptResponseSchema,
  SaveAnswerParamsSchema,
  SaveAnswerRequestSchema,
  SaveAnswerAcceptedSchema,
  SaveAnswerRejectedSchema,
  SaveAnswerResponseSchema,
  StartAttemptRequestSchema,
  SubmitAttemptRequestSchema,
  getSaveAnswerMessage,
  ErrorResponseSchema,
} from "@exam/contracts";
import type {
  RequestContext,
  ExamAttempt,
  Exam,
  ExamEnrollment,
  EnrollmentStatus,
} from "@exam/domain";
import {
  NotFoundError,
  ValidationError,
  InvalidStateTransitionError,
  ConflictError,
  PermissionDeniedError,
  RetakeDeferredError,
} from "@exam/domain";
import {
  deriveCandidateExamState,
  pickDisplayAttempt,
  resolveCandidateEnrollmentResultVisibility,
  isCandidateRetakeDeferred,
  projectEnrollmentForLifecycleState,
} from "@exam/exam-engine";
import { createExamRepo } from "@exam/db/src/repository/examRepo.js";
import { createAttemptRepo } from "@exam/db/src/repository/attemptRepo.js";
import { Permission } from "@exam/authz";
import { executeInTransaction } from "@exam/db/src/types.js";
import { createEnrollmentRepo } from "@exam/db/src/repository/enrollmentRepo.js";
import { createCandidateRepo } from "@exam/db/src/repository/candidateRepo.js";
import { createAttemptGradingEntryRepo } from "@exam/db/src/repository/attemptGradingEntryRepo.js";
import { createAttemptInterruptionRepo } from "@exam/db/src/repository/attemptInterruptionRepo.js";
import { createAttemptInterruptionEventRepo } from "@exam/db/src/repository/attemptInterruptionEventRepo.js";
import { createAttemptTimeAdjustmentRepo } from "@exam/db/src/repository/attemptTimeAdjustmentRepo.js";
import {
  startOrRestoreAttempt,
  restoreInterruptedAttempt,
} from "@exam/exam-engine";
import { saveAnswer } from "@exam/exam-engine";
import {
  ensureAttemptDeadlineReconciled,
  lockEnrollmentAndAttempt,
  prepareReconciledAttemptMutation,
} from "@exam/exam-engine";
import type { SubmitInterruptionResolution } from "@exam/exam-engine";
import {
  createExamEngineRepos,
  createGradingWorksetRepoAdapter,
  createInterruptionEpisodeRepoAdapter,
  createInterruptionEventRepoAdapter,
  createTimeAdjustmentRepoAdapter,
} from "../adapters/repoAdapters.js";
import { submitAndGradeAttempt } from "../orchestrators/submitAndGradeAttempt.js";
import { formatZodError, getRequestContext } from "./helpers.js";
import { reconcileExamForRead } from "./reconciliation.js";
// #301 §21: the frozen snapshot question is the authority for the answer
// payload shape. The route only supplies the HOW (per-question validation +
// rich canonicalization); the engine owns WHEN it runs — after the
// lifecycle/deadline guards, before idempotency/version semantics — so a
// malformed payload can never change the protocol rejection precedence.
import { validateAnswerForQuestion } from "../lib/validateAnswerForQuestion.js";
import {
  cookieAuth,
  toCandidateAttemptResponse,
  buildCandidateTakeSnapshot,
} from "./attempts.shared.js";

// Wire response schemas (Zod) — single source of truth for serialization +
// OpenAPI. SaveAnswer is an accepted/rejected union.
const candidateExamListResponseSchema = z.array(CandidateExamSummarySchema);
const heartbeatResponseSchema = z.object({
  ok: z.literal(true),
  serverNow: z.string().datetime(),
});

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
 * enrollment, and attempt state. Result-derived facts (bestScore,
 * bestScorePercent, pass_then_stop's already_passed block) are projected
 * only when the canonical result visibility authority says the result is
 * visible (#324); the underlying grading truth is untouched.
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
  const resultVisible = resolveCandidateEnrollmentResultVisibility(
    exam,
    enrollment,
    finalAttempt,
  ).visible;
  const { availabilityStatus, primaryAction } = deriveCandidateExamState({
    exam,
    enrollment: projectEnrollmentForLifecycleState(enrollment, resultVisible),
    activeAttempt,
    resumableAttempt,
    latestAttempt,
    finalAttempt,
    now,
  });

  const bestScore =
    resultVisible && enrollment?.finalScore != null
      ? enrollment.finalScore
      : undefined;
  const bestScorePercent =
    bestScore != null && exam.totalScore > 0
      ? Math.round((bestScore / exam.totalScore) * 100)
      : undefined;

  const hasActive = Boolean(activeAttempt) || Boolean(resumableAttempt);
  const maxAttemptsExhausted =
    exam.retakePolicy === "max_attempts" && currentAttempts >= exam.maxAttempts;
  const alreadyPassed =
    resultVisible &&
    exam.retakePolicy === "pass_then_stop" &&
    enrollment?.finalPassed === true;
  // #324 review P1-2: while the final result exists but is hidden, retake
  // eligibility is DEFERRED — passed and failed candidates must see the same
  // canStartNewAttempt=false here, matching the identical opaque rejection
  // the start route gives both until publication.
  const retakeDeferred = isCandidateRetakeDeferred(
    exam,
    enrollment,
    finalAttempt,
  );

  const canStartNewAttempt =
    !hasActive && !maxAttemptsExhausted && !alreadyPassed && !retakeDeferred;

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

export async function registerCandidateAttemptRoutes(fastify: FastifyInstance) {
  /**
   * GET /candidate/exams — Returns a summary list of all exams the
   * authenticated candidate is enrolled in, with availability status
   * and best score per exam.
   */
  fastify.get(
    "/candidate/exams",
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireCandidateContext(Permission.ExamTake),
      ],
      schema: {
        security: cookieAuth,
        "x-role": ["Candidate"],
        response: { 200: candidateExamListResponseSchema },
      },
    },
    async (request) => {
      const ctx = getRequestContext(request);
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

      const attemptRepo = createAttemptRepo(fastify.db);
      // ADR-006: one operation now for this list request.
      const now = fastify.now();

      return Promise.all(
        enrollments.map(async (enrollment) => {
          const result = await reconcileExamForRead(
            fastify.db,
            enrollment.examId,
            now,
            ctx,
          );
          if (!result) return null;
          const { exam } = result;

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

          const normalizedEnrollment = normalizeEnrollment(enrollment);
          const resultVisible = resolveCandidateEnrollmentResultVisibility(
            exam,
            normalizedEnrollment,
            finalAttempt ?? null,
          ).visible;
          const { availabilityStatus, primaryAction } =
            deriveCandidateExamState({
              exam,
              enrollment: projectEnrollmentForLifecycleState(
                normalizedEnrollment,
                resultVisible,
              ),
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
            resultVisible && enrollment.finalScore != null
              ? enrollment.finalScore
              : undefined;
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
            // Snapshot authority boundary: a draft has no frozen snapshot yet,
            // so its authored question ids are the current authoring state; any
            // non-draft state must report the frozen snapshot length — even
            // when the snapshot is empty or inconsistent (no silent fallback).
            totalQuestions:
              exam.status === "draft"
                ? exam.questionIds.length
                : exam.questionSnapshot.length,
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
      preHandler: [
        fastify.authenticate,
        fastify.requireExamEligibility(
          Permission.ExamTake,
          "examId",
          "resource_not_found",
        ),
      ],
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
      const ctx = getRequestContext(request);
      const candidateProfile = await getCandidateProfile(fastify, ctx);
      // ADR-006: one operation now, threaded through the whole request.
      const now = fastify.now();
      const statusResult = await reconcileExamForRead(
        fastify.db,
        parsed.data.examId,
        now,
        ctx,
      );
      if (!statusResult) {
        throw new NotFoundError("Exam not found");
      }
      const { exam } = statusResult;

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
      preHandler: [
        fastify.authenticate,
        fastify.requireExamEligibility(
          Permission.AttemptStart,
          "examId",
          "resource_not_found",
        ),
      ],
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
      const ctx = getRequestContext(request);
      const candidateProfile = await getCandidateProfile(fastify, ctx);
      const exam = (await createExamRepo(fastify.db).findById(
        ctx,
        parsed.data.examId,
      )) as Exam | null;
      if (!exam) {
        throw new NotFoundError("Exam not found");
      }
      const enrollment = await createEnrollmentRepo(
        fastify.db,
      ).findByExamAndCandidate(ctx, exam.id, candidateProfile.id);
      if (!enrollment) {
        throw new NotFoundError("Enrollment not found");
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
      preHandler: [
        fastify.authenticate,
        fastify.requireExamEligibility(
          Permission.AttemptStart,
          "examId",
          "permission_denied",
        ),
      ],
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
      const ctx = getRequestContext(request);
      const { examId } = parsed.data;
      const candidateProfile = await getCandidateProfile(fastify, ctx);
      const candidateId = candidateProfile.id;

      // ADR-006: one operation now, captured once at the route entry.
      const now = fastify.now();

      const statusResult = await reconcileExamForRead(
        fastify.db,
        examId,
        now,
        ctx,
      );
      if (!statusResult) {
        throw new NotFoundError("Exam not found");
      }
      const { exam } = statusResult;
      if (
        exam.controlFlags.requireQueue &&
        getQueueStatus(exam, candidateId, now).status !== "ready"
      ) {
        throw new ConflictError(
          "Queue admission required before starting this exam",
        );
      }

      let attempt: ExamAttempt;
      let isNew: boolean;
      try {
        const started = await executeInTransaction(
          fastify.db,
          async (tx) => {
            const { exams, enrollments, attempts } = createExamEngineRepos(
              {
                examRepo: createExamRepo(tx),
                attemptRepo: createAttemptRepo(tx),
                enrollmentRepo: createEnrollmentRepo(tx),
              },
              ctx,
            );

            // Build interruption repos for the full restore path.
            const episodeRepo = createInterruptionEpisodeRepoAdapter(
              createAttemptInterruptionRepo(tx),
              ctx,
            );
            const eventRepo = createInterruptionEventRepoAdapter(
              createAttemptInterruptionEventRepo(tx),
              ctx,
            );
            const adjustmentRepo = createTimeAdjustmentRepoAdapter(
              createAttemptTimeAdjustmentRepo(tx),
              ctx,
            );
            const gradingWorksetRepo = createGradingWorksetRepoAdapter(
              createAttemptGradingEntryRepo(tx),
              ctx,
            );

            const result = await startOrRestoreAttempt(
              exams,
              enrollments,
              attempts,
              examId,
              candidateId,
              now,
              {
                unassignedErrorFactory: (message) =>
                  new PermissionDeniedError(message),
                episodeRepo,
                eventRepo,
                adjustmentRepo,
                gradingWorksetRepo,
              },
            );
            return result;
          },
          "read committed",
        );
        attempt = started.attempt;
        isNew = started.isNew;
      } catch (error) {
        // #324 review P1-3: the engine decides retake deferral UNDER the
        // enrollment lock (the same serialization boundary as the grading
        // finalizer), so the pass/fail fact can no longer race past a
        // pre-transaction read. The wire contract stays opaque — a deferral
        // is surfaced as a generic conflict so passed and failed candidates
        // see the identical body.
        if (error instanceof RetakeDeferredError) {
          throw new ConflictError(
            "Cannot start a new attempt for this exam at this time",
          );
        }
        throw error;
      }

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
              toCandidateAttemptResponse(attempt, now, exam),
            ),
          );
      }
      return reply
        .code(200)
        .send(
          LoadAttemptResponseSchema.parse(
            toCandidateAttemptResponse(attempt, now, exam),
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
      preHandler: [
        fastify.authenticate,
        fastify.requireOwnAttempt(Permission.AttemptViewOwn, "id"),
      ],
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
      const ctx = getRequestContext(request);
      const attempt = await getOwnedAttempt(fastify, ctx, parsed.data.id);
      const exam = (await createExamRepo(fastify.db).findById(
        ctx,
        attempt.examId,
      )) as Exam | null;
      if (!exam) {
        throw new NotFoundError("Exam not found");
      }
      return LoadAttemptResponseSchema.parse(
        toCandidateAttemptResponse(attempt, fastify.now(), exam),
      );
    },
  );

  /**
   * GET /candidate/attempts/:attemptId/take — CandidateTakeSnapshot (L0 §6.1).
   *
   * Returns the unified snapshot with derived capabilities, answerSource
   * routing, security projection, and Cache-Control: no-store.
   *
   * This is the business truth source for the frontend. The frontend derives
   * its view from this snapshot via a pure function, not from local state.
   */
  fastify.get(
    "/candidate/attempts/:attemptId/take",
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireOwnAttempt(Permission.AttemptViewOwn, "attemptId"),
      ],
      schema: {
        params: AttemptIdParamsSchema,
        security: cookieAuth,
        "x-role": ["Candidate"],
        response: {
          200: CandidateTakeSnapshotSchema,
          400: ErrorResponseSchema,
          404: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const parsed = AttemptIdParamsSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply.code(400).send(formatZodError(request.id, parsed.error));
      }
      const ctx = getRequestContext(request);
      const candidateProfile = await getCandidateProfile(fastify, ctx);

      // P3-L0-3: lazy deadline reconciliation. The take endpoint is the
      // primary entry point; run reconciliation inside a locked tx so an
      // expired attempt is frozen before the snapshot is built. This is a
      // command-style GET with side effects — Cache-Control: no-store below.
      const attempt = (await executeInTransaction(fastify.db, async (tx) => {
        const { exams, enrollments, attempts } = createExamEngineRepos(
          {
            examRepo: createExamRepo(tx),
            attemptRepo: createAttemptRepo(tx),
            enrollmentRepo: createEnrollmentRepo(tx),
          },
          ctx,
        );
        // P3-FORMAL-P0-D2: mint the EA capability via the canonical seam and
        // thread it (plus the same repo pair) into the reconciliation path.
        const cap = await lockEnrollmentAndAttempt(
          enrollments,
          attempts,
          parsed.data.attemptId,
        );
        const preRead = await attempts.findById(parsed.data.attemptId);
        const episodeRepo = createInterruptionEpisodeRepoAdapter(
          createAttemptInterruptionRepo(tx),
          ctx,
        );
        const eventRepo = createInterruptionEventRepoAdapter(
          createAttemptInterruptionEventRepo(tx),
          ctx,
        );
        const resolution: SubmitInterruptionResolution =
          preRead?.status === "disrupted"
            ? {
                mode: "active_interruption",
                episodeRepo,
                eventRepo,
                hint: {
                  policy:
                    preRead.interruptionTimingPolicySnapshot?.policy ??
                    "strict",
                  eligibleSeconds: null,
                  adjustmentId: null,
                  reasonCode: "deadline_terminalization",
                },
              }
            : { mode: "none", episodeRepo, eventRepo };
        const reconciled = await ensureAttemptDeadlineReconciled(
          exams,
          enrollments,
          attempts,
          createGradingWorksetRepoAdapter(
            createAttemptGradingEntryRepo(tx),
            ctx,
          ),
          cap,
          fastify.now(),
          resolution,
        );
        if (reconciled.candidateId !== candidateProfile.id) {
          throw new NotFoundError("Attempt not found");
        }
        return reconciled;
      })) as ExamAttempt;

      // Load the exam for visibility/deadline computation
      const examRepo = createExamRepo(fastify.db);
      const examRow = await examRepo.findById(ctx, attempt.examId);
      if (!examRow) {
        throw new NotFoundError("Exam not found");
      }
      // Cast DB row to domain Exam type — buildCandidateTakeSnapshot only needs
      // resultPublicationMode, resultsPublishedAt, and closeAt.
      const exam = examRow as unknown as Exam;

      const snapshot = buildCandidateTakeSnapshot(attempt, exam, fastify.now());

      // Cache-Control: no-store — GET may trigger deadline reconciliation
      reply.header("Cache-Control", "no-store");

      return CandidateTakeSnapshotSchema.parse(snapshot);
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
      preHandler: [
        fastify.authenticate,
        fastify.requireOwnAttempt(Permission.AttemptAnswerSave, "attemptId"),
      ],
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
      const ctx = getRequestContext(request);
      const { attemptId, questionId } = parsedParams.data;
      // ADR-006: one operation now for the whole save-answer request, reused
      // by the answer protocol and the heartbeat lastActivityAt stamp.
      const now = fastify.now();
      const body = parsedBody.data;
      if (body.attemptId !== attemptId || body.questionId !== questionId) {
        throw new ValidationError("Path and body identifiers must match");
      }

      const saved = await executeInTransaction(fastify.db, async (tx) => {
        const txRepo = createAttemptRepo(tx);
        const candidateProfile = await createCandidateRepo(tx).findByUserId(
          ctx,
          ctx.actorId,
        );
        if (!candidateProfile) {
          throw new NotFoundError("候选人资料不存在");
        }

        const { exams, enrollments, attempts } = createExamEngineRepos(
          {
            examRepo: createExamRepo(tx),
            attemptRepo: txRepo,
            enrollmentRepo: createEnrollmentRepo(tx),
          },
          ctx,
        );
        // P3-FORMAL-P0-D2: mint the EA capability via the canonical seam
        // (Enrollment → Attempt order). The canonical seam's locator read
        // doubles as the existence check; the ownership check runs against the
        // post-preparation attempt below.
        const cap = await lockEnrollmentAndAttempt(
          enrollments,
          attempts,
          attemptId,
        );
        // EXAM-ANSWER-PRECONDITION-CORRECTIVE-0: the canonical preparation seam
        // establishes the external preconditions a local Attempt mutation
        // requires — EA lock provenance (verified against these exact repos),
        // canonical deadline reconciliation (preserving freeze/grade behavior),
        // and the canonical effective deadline (computeEffectiveDeadline). It
        // mints the narrow opaque mutation evidence saveAnswer consumes. The
        // route no longer owns question-membership legality, effective-deadline
        // computation, or attempt.deadlineAt read-for-save — those live in
        // saveAnswer / the preparation seam.
        const preAttempt = await attempts.findById(attemptId);
        const saveEpisodeRepo = createInterruptionEpisodeRepoAdapter(
          createAttemptInterruptionRepo(tx),
          ctx,
        );
        const saveEventRepo = createInterruptionEventRepoAdapter(
          createAttemptInterruptionEventRepo(tx),
          ctx,
        );
        const saveResolution: SubmitInterruptionResolution =
          preAttempt?.status === "disrupted"
            ? {
                mode: "active_interruption",
                episodeRepo: saveEpisodeRepo,
                eventRepo: saveEventRepo,
                hint: {
                  policy:
                    preAttempt.interruptionTimingPolicySnapshot?.policy ??
                    "strict",
                  eligibleSeconds: null,
                  adjustmentId: null,
                  reasonCode: "deadline_terminalization",
                },
              }
            : {
                mode: "none",
                episodeRepo: saveEpisodeRepo,
                eventRepo: saveEventRepo,
              };
        const { attempt: currentAttempt, mutationContext } =
          await prepareReconciledAttemptMutation(
            exams,
            enrollments,
            attempts,
            createGradingWorksetRepoAdapter(
              createAttemptGradingEntryRepo(tx),
              ctx,
            ),
            cap,
            now,
            saveResolution,
          );
        if (currentAttempt.candidateId !== candidateProfile.id) {
          throw new NotFoundError("尝试不存在");
        }

        // #301 §21 + canonical Save ordering (corrective pass §5): the route
        // delegates the WHOLE Save Answer action — status guards, effective
        // deadline guard, question membership, answer shape validation and
        // rich canonicalization, idempotency/version semantics, persist — to
        // the engine. It supplies only the frozen-question-bound canonicalizer
        // and inspects the returned semantic result to translate it to the
        // wire contract. It does NOT gate validation on attempt status, does
        // NOT validate membership, compute the effective deadline,
        // reconstruct AnswerState, or write attempt.answers itself.
        const saved = await saveAnswer(
          attempts,
          mutationContext,
          {
            attemptId,
            questionId,
            answer: body.answer,
            clientSeq: body.clientSeq,
            clientSavedAt: body.clientSavedAt,
            baseVersion: body.baseVersion,
          },
          validateAnswerForQuestion,
        );
        return saved;
      });

      if (saved.accepted) {
        return SaveAnswerAcceptedSchema.parse({
          accepted: true,
          serverVersion: saved.serverVersion,
          savedAt: saved.savedAt,
        });
      }

      const conflict = saved.conflict;
      return SaveAnswerRejectedSchema.parse({
        accepted: false,
        reason: conflict.reason,
        message: getSaveAnswerMessage(conflict.reason),
        serverVersion: saved.serverVersion,
        savedAt: saved.savedAt,
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
      preHandler: [
        fastify.authenticate,
        fastify.requireOwnAttempt(Permission.AttemptSubmit, "attemptId"),
      ],
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
      const ctx = getRequestContext(request);
      const { attemptId } = parsed.data;

      const candidateProfile = await createCandidateRepo(
        fastify.db,
      ).findByUserId(ctx, ctx.actorId);
      if (!candidateProfile) {
        throw new NotFoundError("Candidate profile not found");
      }

      const now = fastify.now();
      const { attempt } = await submitAndGradeAttempt(
        fastify.db,
        ctx,
        attemptId,
        candidateProfile.id,
        now,
        { request },
      );
      const exam = (await createExamRepo(fastify.db).findById(
        ctx,
        attempt.examId,
      )) as Exam | null;
      if (!exam) {
        throw new NotFoundError("Exam not found");
      }

      return LoadAttemptResponseSchema.parse(
        toCandidateAttemptResponse(attempt, now, exam),
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
      preHandler: [
        fastify.authenticate,
        fastify.requireOwnAttempt(Permission.AttemptHeartbeatSend, "attemptId"),
      ],
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
      const ctx = getRequestContext(request);
      const { attemptId } = parsed.data;
      // ADR-006: one operation now for the heartbeat — used for both the
      // lastActivityAt stamp and the returned serverNow so they cannot drift.
      const now = fastify.now();
      const attemptRepo = createAttemptRepo(fastify.db);

      // Ownership gate: verify the candidate owns this attempt (projection
      // read, not FOR UPDATE). The actual write is done via the atomic
      // status-qualified refreshLastActivityIfInProgress.
      await getOwnedAttempt(fastify, ctx, attemptId);

      // Atomic status-qualified heartbeat write: updates lastActivityAt iff
      // the row is still in_progress. Returns null when the status has
      // changed (disrupted/submitted/etc.) under the row lock.
      const updated = await attemptRepo.refreshLastActivityIfInProgress(
        ctx,
        attemptId,
        now,
      );
      if (!updated) {
        throw new InvalidStateTransitionError(
          "Cannot heartbeat attempt: status changed or attempt not found",
        );
      }

      return { ok: true, serverNow: now.toISOString() };
    },
  );

  /**
   * POST /attempts/:attemptId/restore — Explicitly restores a disrupted
   * attempt. ADR-013 §6 / REC-I4-I3A: returns the frozen restore response
   * contract (command acknowledgement + candidate-safe compensation summary).
   * The response deliberately does NOT expose internal interruption evidence
   * (episode id, detected event, adjustment ledger) — those remain
   * server-side authority. The candidate client re-reads the authoritative
   * take-snapshot via GET after this returns.
   *
   * Lifecycle outcomes:
   *   - `restored` — disrupted → in_progress (possibly with bounded_grace grant);
   *   - `already_in_progress` — the attempt was already active;
   *   - `terminal` — the attempt was already terminal on entry, or the
   *     deadline reconciliation submitted it during this transaction.
   *     All three outcomes return 200 (the terminalization is authoritative).
   */
  fastify.post(
    "/attempts/:attemptId/restore",
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireOwnAttempt(Permission.AttemptRestore, "attemptId"),
      ],
      schema: {
        params: RestoreAttemptRequestSchema,
        security: cookieAuth,
        "x-role": ["Candidate"],
        response: {
          200: RestoreAttemptResponseSchema,
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
      const ctx = getRequestContext(request);
      const { attemptId } = parsed.data;
      await getOwnedAttempt(fastify, ctx, attemptId);

      // ADR-006: one operation now, captured once at the route entry and
      // threaded through the entire restore transaction.
      const now = fastify.now();

      const restoreResult = await executeInTransaction(
        fastify.db,
        async (tx) => {
          const { exams, attempts, enrollments } = createExamEngineRepos(
            {
              examRepo: createExamRepo(tx),
              attemptRepo: createAttemptRepo(tx),
              enrollmentRepo: createEnrollmentRepo(tx),
            },
            ctx,
          );
          const gradingWorksetRepo = createGradingWorksetRepoAdapter(
            createAttemptGradingEntryRepo(tx),
            ctx,
          );

          // P3-FORMAL-P0-D2: mint the EA capability via the canonical seam.
          const cap = await lockEnrollmentAndAttempt(
            enrollments,
            attempts,
            attemptId,
          );

          // Build interruption repos (R12: restore uses EA seam, these are
          // the additional repos needed by restoreInterruptedAttempt).
          const episodeRepo = createInterruptionEpisodeRepoAdapter(
            createAttemptInterruptionRepo(tx),
            ctx,
          );
          const eventRepo = createInterruptionEventRepoAdapter(
            createAttemptInterruptionEventRepo(tx),
            ctx,
          );
          const adjustmentRepo = createTimeAdjustmentRepoAdapter(
            createAttemptTimeAdjustmentRepo(tx),
            ctx,
          );

          // Composed restore: handles policy evaluation, deadline
          // reconciliation, time grant (bounded_grace), and lifecycle.
          return restoreInterruptedAttempt(
            exams,
            attempts,
            enrollments,
            episodeRepo,
            eventRepo,
            adjustmentRepo,
            gradingWorksetRepo,
            cap,
            now,
          );
        },
      );

      // Project the engine result onto the frozen candidate-facing contract.
      // The engine `lifecycle` union includes `terminal` (already-terminal
      // on entry, or deadline-reconciliation submitted). All three outcomes
      // (`restored`, `already_in_progress`, `terminal`) are legitimate 200
      // results — the schema accepts them all.
      const exam = (await createExamRepo(fastify.db).findById(
        ctx,
        restoreResult.attempt.examId,
      )) as Exam | null;
      if (!exam) {
        throw new NotFoundError("Exam not found");
      }
      return RestoreAttemptResponseSchema.parse({
        lifecycle: restoreResult.lifecycle,
        compensation: {
          policy: restoreResult.compensation.policy,
          addedSeconds: restoreResult.compensation.addedSeconds,
        },
        attempt: toCandidateAttemptResponse(restoreResult.attempt, now, exam),
      });
    },
  );
}
