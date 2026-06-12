import type { FastifyPluginAsync } from "fastify";
import {
  CandidateExamDetailResponseSchema,
  HeartbeatRequestSchema,
  LoadAttemptParamsSchema,
  LoadAttemptResponseSchema,
  QueueStatusResponseSchema,
  RestoreAttemptRequestSchema,
  SaveAnswerParamsSchema,
  SaveAnswerRequestSchema,
  SaveAnswerAcceptedSchema,
  SaveAnswerRejectedSchema,
  StartAttemptRequestSchema,
  SubmitAttemptRequestSchema,
  getSaveAnswerMessage,
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
import { NotFoundError, ValidationError } from "@exam/domain";
import { createExamRepo } from "@exam/db/src/repository/examRepo.js";
import { createAttemptRepo } from "@exam/db/src/repository/attemptRepo.js";
import { executeInTransaction } from "@exam/db/src/types.js";
import { createEnrollmentRepo } from "@exam/db/src/repository/enrollmentRepo.js";
import { createCandidateRepo } from "@exam/db/src/repository/candidateRepo.js";
import {
  startAttempt,
  submitAttempt,
  restoreAttempt,
  gradeAttempt,
  type ExamRepository,
  type AttemptRepository as AttemptRepoInterface,
  type EnrollmentRepository,
} from "@exam/exam-engine";
import { processSaveAnswer } from "@exam/exam-engine";
import { recordAudit } from "./audit.js";
import { formatZodError } from "./helpers.js";

interface StoredAnswer extends Omit<AnswerRecord, "savedAt"> {
  savedAt: Date | string;
  clientSeq?: number;
  clientSeqHistory?: StoredAnswerReceipt[];
}

interface StoredAnswerReceipt {
  clientSeq: number;
  answer: unknown;
  version: number;
  savedAt: Date | string;
}

interface NormalizedStoredAnswer extends AnswerRecord {
  clientSeq?: number;
  clientSeqHistory?: StoredAnswerReceipt[];
}

interface QueueEntry {
  candidateId: string;
  joinedAt: Date;
}

const examQueues = new Map<string, QueueEntry[]>();

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

function toCandidateAttemptResponse(attempt: ExamAttempt) {
  return {
    ...toAttemptResponse(attempt),
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

function createExamRepoAdapter(
  repo: ReturnType<typeof createExamRepo>,
  ctx: RequestContext,
): ExamRepository {
  return {
    findById: async (examId) =>
      (await repo.findById(ctx, examId)) as Exam | null,
    update: async (examId, data) =>
      (await repo.update(
        ctx,
        examId,
        data as Record<string, unknown>,
      )) as Exam | null,
  };
}

function createAttemptRepoAdapter(
  repo: ReturnType<typeof createAttemptRepo>,
  ctx: RequestContext,
): AttemptRepoInterface {
  return {
    findById: async (id) =>
      (await repo.findById(ctx, id)) as ExamAttempt | null,
    findActiveByEnrollment: async (enrollmentId) =>
      (await repo.findActiveByEnrollment(
        ctx,
        enrollmentId,
      )) as ExamAttempt | null,
    findByEnrollmentAndAttemptNo: async (enrollmentId, attemptNo) =>
      (await repo.findByEnrollmentAndAttemptNo(
        ctx,
        enrollmentId,
        attemptNo,
      )) as ExamAttempt | null,
    create: async (input) =>
      (await repo.create(
        ctx,
        input as Parameters<typeof repo.create>[1],
      )) as ExamAttempt,
    update: async (id, data) =>
      (await repo.update(
        ctx,
        id,
        data as Parameters<typeof repo.update>[2],
      )) as ExamAttempt | null,
  };
}

function createEnrollmentRepoAdapter(
  repo: ReturnType<typeof createEnrollmentRepo>,
  ctx: RequestContext,
): EnrollmentRepository {
  return {
    findByExamAndCandidate: async (examId, candidateId) =>
      (await repo.findByExamAndCandidate(ctx, examId, candidateId)) as
        | import("@exam/domain").ExamEnrollment
        | null,
    create: async (input) =>
      (await repo.create(
        ctx,
        input as Parameters<typeof repo.create>[1],
      )) as import("@exam/domain").ExamEnrollment,
    update: async (id, data) =>
      (await repo.update(
        ctx,
        id,
        data as Parameters<typeof repo.update>[2],
      )) as import("@exam/domain").ExamEnrollment | null,
  };
}

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

function buildCandidateExamDetail(
  exam: Exam,
  enrollment: ExamEnrollment | null,
  activeAttempt: ExamAttempt | null,
) {
  const currentAttempts = enrollment?.attemptCount ?? 0;
  const canStartNewAttempt =
    activeAttempt === null &&
    !(
      exam.retakePolicy === "max_attempts" &&
      currentAttempts >= exam.maxAttempts
    ) &&
    !(
      exam.retakePolicy === "pass_then_stop" && enrollment?.finalPassed === true
    );

  const blockingReason =
    activeAttempt !== null
      ? undefined
      : exam.retakePolicy === "max_attempts" &&
          currentAttempts >= exam.maxAttempts
        ? "max_attempts_reached"
        : exam.retakePolicy === "pass_then_stop" &&
            enrollment?.finalPassed === true
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
    currentAttempts,
    ...(activeAttempt ? { activeAttemptId: activeAttempt.id } : {}),
    canStartNewAttempt,
    ...(blockingReason ? { blockingReason } : {}),
  });
}

const attemptRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    "/candidate/exams",
    {
      preHandler: [fastify.authenticate, fastify.requireRole(["Candidate"])],
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
      const now = new Date();

      return Promise.all(
        enrollments.map(async (enrollment) => {
          const exam = (await examRepo.findById(
            ctx,
            enrollment.examId,
          )) as Exam | null;
          if (!exam) return null;

          const isAvailable =
            (exam.status === "published" || exam.status === "open") &&
            now >= exam.openAt &&
            now < exam.closeAt;
          const isEnded = now >= exam.closeAt;

          return {
            examId: exam.id,
            title: exam.title,
            durationMinutes: exam.durationMinutes,
            passingScore: exam.passingScore,
            totalScore: exam.totalScore,
            openAt: exam.openAt.toISOString(),
            closeAt: exam.closeAt.toISOString(),
            questionCount: exam.questionSnapshot.length,
            attemptCount: enrollment.attemptCount,
            maxAttempts: exam.maxAttempts,
            finalScore: enrollment.finalScore,
            finalPassed: enrollment.finalPassed,
            finalAttemptId: enrollment.finalAttemptId,
            isAvailable,
            isEnded,
          };
        }),
      ).then((results) =>
        results.filter(
          (exam): exam is NonNullable<typeof exam> => exam !== null,
        ),
      );
    },
  );

  fastify.get(
    "/candidate/exams/:examId",
    {
      preHandler: [fastify.authenticate, fastify.requireRole(["Candidate"])],
    },
    async (request, reply) => {
      const parsed = StartAttemptRequestSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply.code(400).send(formatZodError(parsed.error));
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

      const rawEnrollment = await createEnrollmentRepo(
        fastify.db,
      ).findByExamAndCandidate(ctx, parsed.data.examId, candidateProfile.id);
      if (!rawEnrollment) {
        throw new NotFoundError("Enrollment not found");
      }
      const enrollment = normalizeEnrollment(rawEnrollment);
      const activeAttempt = (await createAttemptRepo(
        fastify.db,
      ).findActiveByExamAndCandidate(
        ctx,
        parsed.data.examId,
        candidateProfile.id,
      )) as ExamAttempt | null;

      return buildCandidateExamDetail(exam, enrollment, activeAttempt);
    },
  );

  fastify.post(
    "/attempts/:examId/queue",
    {
      preHandler: [fastify.authenticate, fastify.requireRole(["Candidate"])],
    },
    async (request, reply) => {
      const parsed = StartAttemptRequestSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply.code(400).send(formatZodError(parsed.error));
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
      return getQueueStatus(exam, candidateProfile.id, new Date());
    },
  );

  fastify.post(
    "/attempts/:examId/start",
    {
      preHandler: [fastify.authenticate, fastify.requireRole(["Candidate"])],
    },
    async (request, reply) => {
      const parsed = StartAttemptRequestSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply.code(400).send(formatZodError(parsed.error));
      }
      const ctx = request["ctx"] as RequestContext;
      const { examId } = parsed.data;
      const examRepo = createExamRepo(fastify.db);
      const enrollmentRepo = createEnrollmentRepo(fastify.db);
      const attemptRepo = createAttemptRepo(fastify.db);

      const examRepoAdapter = createExamRepoAdapter(examRepo, ctx);
      const enrRepoAdapter = createEnrollmentRepoAdapter(enrollmentRepo, ctx);
      const attRepoAdapter = createAttemptRepoAdapter(attemptRepo, ctx);

      const candidateProfile = await getCandidateProfile(fastify, ctx);
      const candidateId = candidateProfile.id;

      const activeAttempt = await attemptRepo.findActiveByExamAndCandidate(
        ctx,
        examId,
        candidateId,
      );
      if (activeAttempt) {
        return LoadAttemptResponseSchema.parse(
          toCandidateAttemptResponse(activeAttempt as ExamAttempt),
        );
      }

      const exam = (await examRepo.findById(ctx, examId)) as Exam | null;
      if (!exam) {
        throw new NotFoundError("Exam not found");
      }
      if (
        exam.controlFlags.requireQueue &&
        getQueueStatus(exam, candidateId, new Date()).status !== "ready"
      ) {
        return reply.code(409).send({
          error: {
            code: "QUEUE_WAIT_REQUIRED",
            message: "Wait for queue admission before starting the exam",
          },
        });
      }

      const attempt = await startAttempt(
        examRepoAdapter,
        enrRepoAdapter,
        attRepoAdapter,
        examId,
        candidateId,
        new Date(),
      );

      recordAudit(
        fastify,
        request,
        ctx,
        "attempt.start",
        "attempt",
        attempt.id,
      );
      examQueues.set(
        examId,
        (examQueues.get(examId) ?? []).filter(
          (entry) => entry.candidateId !== candidateId,
        ),
      );
      return reply
        .code(201)
        .send(
          LoadAttemptResponseSchema.parse(toCandidateAttemptResponse(attempt)),
        );
    },
  );

  fastify.get(
    "/attempts/:id",
    {
      preHandler: [fastify.authenticate, fastify.requireRole(["Candidate"])],
    },
    async (request, reply) => {
      const parsed = LoadAttemptParamsSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply.code(400).send(formatZodError(parsed.error));
      }
      const ctx = request["ctx"] as RequestContext;
      const attempt = await getOwnedAttempt(fastify, ctx, parsed.data.id);
      return LoadAttemptResponseSchema.parse(
        toCandidateAttemptResponse(attempt),
      );
    },
  );

  fastify.post(
    "/attempts/:attemptId/answers/:questionId",
    {
      preHandler: [fastify.authenticate, fastify.requireRole(["Candidate"])],
    },
    async (request, reply) => {
      const parsedParams = SaveAnswerParamsSchema.safeParse(request.params);
      if (!parsedParams.success) {
        return reply.code(400).send(formatZodError(parsedParams.error));
      }
      const parsedBody = SaveAnswerRequestSchema.safeParse(request.body);
      if (!parsedBody.success) {
        return reply.code(400).send(formatZodError(parsedBody.error));
      }
      const ctx = request["ctx"] as RequestContext;
      const { attemptId, questionId } = parsedParams.data;
      const body = parsedBody.data;
      if (body.attemptId !== attemptId || body.questionId !== questionId) {
        return reply.code(400).send({
          error: {
            code: "VALIDATION_ERROR",
            message: "Path and body identifiers must match",
          },
        });
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
            lastActivityAt: new Date(),
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

      return SaveAnswerRejectedSchema.parse({
        accepted: false,
        reason: result.conflict!.reason,
        message: getSaveAnswerMessage(result.conflict!.reason),
        serverVersion: result.serverVersion,
        savedAt: result.savedAt,
        details:
          result.conflict!.latestAnswer != null
            ? { serverAnswer: result.conflict!.latestAnswer }
            : undefined,
      });
    },
  );

  fastify.post(
    "/attempts/:attemptId/submit",
    {
      preHandler: [fastify.authenticate, fastify.requireRole(["Candidate"])],
    },
    async (request, reply) => {
      const parsed = SubmitAttemptRequestSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply.code(400).send(formatZodError(parsed.error));
      }
      const ctx = request["ctx"] as RequestContext;
      const { attemptId } = parsed.data;

      await executeInTransaction(fastify.db, async (tx) => {
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

        await submitAttempt(
          createAttemptRepoAdapter(txAttemptRepo, ctx),
          attemptId,
          fastify.now(),
        );
      });

      const attemptRepo = createAttemptRepo(fastify.db);
      const attRepoAdapter = createAttemptRepoAdapter(attemptRepo, ctx);
      const examRepo = createExamRepo(fastify.db);
      const enrollmentRepo = createEnrollmentRepo(fastify.db);

      await gradeAttempt(
        createExamRepoAdapter(examRepo, ctx),
        createEnrollmentRepoAdapter(enrollmentRepo, ctx),
        attRepoAdapter,
        attemptId,
        fastify.now(),
      );
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
        toCandidateAttemptResponse(attempt as ExamAttempt),
      );
    },
  );

  fastify.post(
    "/attempts/:attemptId/heartbeat",
    {
      preHandler: [fastify.authenticate, fastify.requireRole(["Candidate"])],
    },
    async (request, reply) => {
      const parsed = HeartbeatRequestSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply.code(400).send(formatZodError(parsed.error));
      }
      const ctx = request["ctx"] as RequestContext;
      const { attemptId } = parsed.data;
      const attemptRepo = createAttemptRepo(fastify.db);
      const attempt = await getOwnedAttempt(fastify, ctx, attemptId);
      if (attempt.status !== "in_progress") {
        return reply.code(409).send({
          error: {
            code: "INVALID_STATE_TRANSITION",
            message: `Cannot heartbeat attempt in ${attempt.status} state`,
          },
        });
      }

      await attemptRepo.update(ctx, attemptId, {
        lastActivityAt: new Date(),
      } as Parameters<typeof attemptRepo.update>[2]);

      return { ok: true };
    },
  );

  fastify.post(
    "/attempts/:attemptId/restore",
    {
      preHandler: [fastify.authenticate, fastify.requireRole(["Candidate"])],
    },
    async (request, reply) => {
      const parsed = RestoreAttemptRequestSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply.code(400).send(formatZodError(parsed.error));
      }
      const ctx = request["ctx"] as RequestContext;
      const { attemptId } = parsed.data;
      await getOwnedAttempt(fastify, ctx, attemptId);
      const examRepo = createExamRepo(fastify.db);
      const attemptRepo = createAttemptRepo(fastify.db);

      const examRepoAdapter = createExamRepoAdapter(examRepo, ctx);
      const attRepoAdapter = createAttemptRepoAdapter(attemptRepo, ctx);

      const attempt = await restoreAttempt(
        examRepoAdapter,
        attRepoAdapter,
        attemptId,
        new Date(),
      );

      recordAudit(
        fastify,
        request,
        ctx,
        "attempt.restore",
        "attempt",
        attemptId,
      );
      return LoadAttemptResponseSchema.parse(
        toCandidateAttemptResponse(attempt),
      );
    },
  );
};

export default attemptRoutes;
