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
import {
  deriveCandidateExamState,
  pickDisplayAttempt,
} from "@exam/exam-engine";
import { createExamRepo } from "@exam/db/src/repository/examRepo.js";
import { createAttemptRepo } from "@exam/db/src/repository/attemptRepo.js";
import { executeInTransaction } from "@exam/db/src/types.js";
import { createEnrollmentRepo } from "@exam/db/src/repository/enrollmentRepo.js";
import { createCandidateRepo } from "@exam/db/src/repository/candidateRepo.js";
import { createAttemptGradingEntryRepo } from "@exam/db/src/repository/attemptGradingEntryRepo.js";
import { startOrRestoreAttempt, restoreAttempt } from "@exam/exam-engine";
import { processSaveAnswer } from "@exam/exam-engine";
import {
  ensureAttemptDeadlineReconciled,
  lockEnrollmentAndAttempt,
} from "@exam/exam-engine";
import {
  createExamRepoAdapter,
  createExamEngineRepos,
  createGradingWorksetRepoAdapter,
} from "../adapters/repoAdapters.js";
import { submitAndGradeAttempt } from "../orchestrators/submitAndGradeAttempt.js";
import { recordAudit } from "./audit.js";
import { formatZodError, getRequestContext } from "./helpers.js";
import { reconcileExamForRead } from "./reconciliation.js";
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

export async function registerCandidateAttemptRoutes(fastify: FastifyInstance) {
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

      const examRepo = createExamRepo(fastify.db);
      const attemptRepo = createAttemptRepo(fastify.db);
      // ADR-006: one operation now for this list request.
      const now = fastify.now();

      return Promise.all(
        enrollments.map(async (enrollment) => {
          const examAdapter = createExamRepoAdapter(examRepo, ctx);
          const result = await reconcileExamForRead(
            examAdapter,
            enrollment.examId,
            now,
            fastify,
            request,
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
      const ctx = getRequestContext(request);
      const candidateProfile = await getCandidateProfile(fastify, ctx);
      // ADR-006: one operation now, threaded through the whole request.
      const now = fastify.now();
      const examRepo = createExamRepo(fastify.db);
      const statusResult = await reconcileExamForRead(
        createExamRepoAdapter(examRepo, ctx),
        parsed.data.examId,
        now,
        fastify,
        request,
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
      const ctx = getRequestContext(request);
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
      const ctx = getRequestContext(request);
      const { examId } = parsed.data;
      const candidateProfile = await getCandidateProfile(fastify, ctx);
      const candidateId = candidateProfile.id;

      const examRepo = createExamRepo(fastify.db);
      const statusResult = await reconcileExamForRead(
        createExamRepoAdapter(examRepo, ctx),
        examId,
        fastify.now(),
        fastify,
        request,
        ctx,
      );
      if (!statusResult) {
        throw new NotFoundError("Exam not found");
      }
      const { exam } = statusResult;
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
          const { exams, enrollments, attempts } = createExamEngineRepos(
            {
              examRepo: createExamRepo(tx),
              attemptRepo: createAttemptRepo(tx),
              enrollmentRepo: createEnrollmentRepo(tx),
            },
            ctx,
          );

          return startOrRestoreAttempt(
            exams,
            enrollments,
            attempts,
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
      const ctx = getRequestContext(request);
      const attempt = await getOwnedAttempt(fastify, ctx, parsed.data.id);
      return LoadAttemptResponseSchema.parse(
        toCandidateAttemptResponse(attempt, fastify.now()),
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
      preHandler: [fastify.authenticate, fastify.requireRole(["Candidate"])],
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
        // ensureAttemptDeadlineReconciled performs its own findByIdForUpdate
        // internally and returns the (possibly reconciled) attempt. Verify
        // ownership on that returned object instead of a separate locked read,
        // avoiding a redundant DB query. Reconcile is idempotent, so running
        // it before the ownership check is safe even for non-owners (we throw
        // before returning any data).
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
      const ctx = getRequestContext(request);
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

        // P3-L0-3: lazy deadline reconciliation at save entry point. If the
        // attempt is expired, this freezes it; the processSaveAnswer below
        // then sees a submitted/graded status and returns a deterministic
        // rejection (ATTEMPT_ALREADY_SUBMITTED / DEADLINE_EXCEEDED) instead
        // of accepting the stale save.
        const { exams, enrollments, attempts } = createExamEngineRepos(
          {
            examRepo: createExamRepo(tx),
            attemptRepo: txRepo,
            enrollmentRepo: createEnrollmentRepo(tx),
          },
          ctx,
        );
        // P3-FORMAL-P0-D2: mint the EA capability via the canonical seam
        // (Enrollment → Attempt order) and thread it into reconciliation. The
        // canonical seam's locator read doubles as the existence check; the
        // ownership check runs against the post-mint re-read below.
        const cap = await lockEnrollmentAndAttempt(
          enrollments,
          attempts,
          attemptId,
        );
        const lockedAttempt = await txRepo.findByIdForUpdate(ctx, attemptId);
        if (
          !lockedAttempt ||
          lockedAttempt.candidateId !== candidateProfile.id
        ) {
          throw new NotFoundError("尝试不存在");
        }
        // ensureAttemptDeadlineReconciled returns the (possibly reconciled)
        // attempt — reuse it instead of a redundant findByIdForUpdate.
        // processSaveAnswer then sees the current status (frozen snapshot if
        // reconciled) and returns a deterministic rejection for an expired
        // attempt instead of accepting the stale save.
        const currentAttempt = await ensureAttemptDeadlineReconciled(
          exams,
          enrollments,
          attempts,
          createGradingWorksetRepoAdapter(
            createAttemptGradingEntryRepo(tx),
            ctx,
          ),
          cap,
          now,
        );
        if (currentAttempt.candidateId !== candidateProfile.id) {
          throw new NotFoundError("尝试不存在");
        }
        if (
          !currentAttempt.questionSnapshot.some(
            (question) => question.originalQuestionId === questionId,
          )
        ) {
          throw new ValidationError("问题不在此尝试中");
        }

        const storedAnswers = normalizeAnswers(
          currentAttempt.answers as StoredAnswer[],
        );
        const clientSeqMap = buildClientSeqMap(storedAnswers);

        const saveResult = processSaveAnswer(
          {
            attemptStatus: currentAttempt.status as AttemptStatus,
            answers: currentAttempt.answers,
            clientSeqMap,
            ...(currentAttempt.deadlineAt
              ? { deadlineAt: currentAttempt.deadlineAt }
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
      const ctx = getRequestContext(request);
      const { attemptId } = parsed.data;

      const candidateProfile = await createCandidateRepo(
        fastify.db,
      ).findByUserId(ctx, ctx.actorId);
      if (!candidateProfile) {
        throw new NotFoundError("Candidate profile not found");
      }

      const { attempt } = await submitAndGradeAttempt(
        fastify.db,
        ctx,
        attemptId,
        candidateProfile.id,
        fastify.now(),
      );

      recordAudit(
        fastify,
        request,
        ctx,
        "attempt.submit",
        "attempt",
        attemptId,
      );

      return LoadAttemptResponseSchema.parse(
        toCandidateAttemptResponse(attempt, fastify.now()),
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
      const ctx = getRequestContext(request);
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
      const ctx = getRequestContext(request);
      const { attemptId } = parsed.data;
      await getOwnedAttempt(fastify, ctx, attemptId);

      const attempt = await executeInTransaction(fastify.db, async (tx) => {
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
          attemptId,
        );

        // P3-L0-3: lazy deadline reconciliation at restore entry point. If the
        // disrupted attempt is past its deadline, freeze it now; restoreAttempt
        // below then sees a submitted/graded status and the candidate gets the
        // frozen result instead of resurrecting an expired attempt.
        await ensureAttemptDeadlineReconciled(
          exams,
          enrollments,
          attempts,
          createGradingWorksetRepoAdapter(
            createAttemptGradingEntryRepo(tx),
            ctx,
          ),
          cap,
          fastify.now(),
        );

        return restoreAttempt(exams, attempts, attemptId, fastify.now());
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
}
