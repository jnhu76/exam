import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  CreateExamRequestSchema,
  UpdateExamRequestSchema,
  PaginationParamsSchema,
  EnrollCandidatesRequestSchema,
} from "@exam/contracts";
import { createExamRepo } from "@exam/db/src/repository/examRepo.js";
import { createQuestionRepo } from "@exam/db/src/repository/questionRepo.js";
import { createCourseRepo } from "@exam/db/src/repository/courseRepo.js";
import { createEnrollmentRepo } from "@exam/db/src/repository/enrollmentRepo.js";
import { createCandidateRepo } from "@exam/db/src/repository/candidateRepo.js";
import { createUserRepo } from "@exam/db/src/repository/userRepo.js";
import { createAttemptRepo } from "@exam/db/src/repository/attemptRepo.js";
import type { Database } from "@exam/db/src/types.js";
import {
  archiveExam,
  publishExam,
  type ExamRepository,
} from "@exam/exam-engine";
import type { RequestContext, Exam, Question } from "@exam/domain";
import {
  InvalidStateTransitionError,
  ExamAlreadyPublishedError,
  ExamNotDraftError,
} from "@exam/domain";
import { ensureTargetOrg } from "./helpers.js";
import { recordAudit } from "./audit.js";
import {
  buildErrorResponse,
  buildValidationErrorResponse,
} from "../lib/errorResponse.js";

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
    createdAt: exam.createdAt.toISOString(),
    updatedAt: exam.updatedAt.toISOString(),
  };
}

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

function getScoreViewMeta(exam: Exam, gradedAttemptCount: number, now: Date) {
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

const idParamsSchema = z.object({ id: z.string().uuid() });
const examIdParamsSchema = z.object({ examId: z.string().uuid() });
const enrollmentIdParamsSchema = z.object({
  examId: z.string().uuid(),
  enrollmentId: z.string().uuid(),
});
const cookieAuth = [{ cookieAuth: [] }] as const;

const examRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    "/exams",
    {
      preHandler: [fastify.authenticate, fastify.requireRole(["Admin"])],
      schema: {
        querystring: PaginationParamsSchema,
        security: cookieAuth,
        "x-role": ["Admin"],
      },
    },
    async (request: any) => {
      const ctx = ensureTargetOrg(request["ctx"] as RequestContext);
      const { page, pageSize } = PaginationParamsSchema.parse(request.query);
      const repo = createExamRepo(fastify.db);
      const { items, total } = await repo.listPaginated(ctx, page, pageSize);
      const attemptRepo = createAttemptRepo(fastify.db);
      const allEnrollments = await createEnrollmentRepo(fastify.db).list(ctx);
      const now = new Date();

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
      },
    },
    async (request: any, reply: any) => {
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
      },
    },
    async (request: any, reply: any) => {
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
      },
    },
    async (request: any, reply: any) => {
      const ctx = ensureTargetOrg(request["ctx"] as RequestContext);
      const { id } = request.params as { id: string };
      const parsed = UpdateExamRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send(buildValidationErrorResponse(request.id, parsed.error));
      }
      const data = parsed.data;
      const repo = createExamRepo(fastify.db);

      const existing = (await repo.findById(ctx, id)) as Exam | null;
      if (!existing) {
        return reply
          .code(404)
          .send(buildErrorResponse(request.id, "RESOURCE_NOT_FOUND"));
      }

      if (existing.status !== "draft") {
        throw new ExamNotDraftError();
      }
      if (data.questionIds) {
        const questionChecks = await Promise.all(
          data.questionIds.map((questionId) =>
            createQuestionRepo(fastify.db).findById(ctx, questionId),
          ),
        );
        if (questionChecks.some((q) => q?.courseId !== existing.courseId)) {
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
      }

      const updateData: Record<string, unknown> = { ...data };
      if (data.openAt) updateData.openAt = new Date(data.openAt);
      if (data.closeAt) updateData.closeAt = new Date(data.closeAt);

      const updated = (await repo.update(ctx, id, updateData)) as Exam | null;
      if (!updated) {
        return reply
          .code(404)
          .send(buildErrorResponse(request.id, "RESOURCE_NOT_FOUND"));
      }
      recordAudit(fastify, request, ctx, "exam.update", "exam", id);
      return toExamResponse(updated);
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
      },
    },
    async (request: any, reply: any) => {
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

  fastify.post(
    "/exams/:id/archive",
    {
      preHandler: [fastify.authenticate, fastify.requireRole(["Admin"])],
      schema: {
        params: idParamsSchema,
        security: cookieAuth,
        "x-role": ["Admin"],
      },
    },
    async (request: any, reply: any) => {
      const ctx = ensureTargetOrg(request["ctx"] as RequestContext);
      const { id } = request.params as { id: string };
      const repo = createExamRepo(fastify.db);

      const archived = await archiveExam(createExamRepoAdapter(repo, ctx), id);
      recordAudit(fastify, request, ctx, "exam.archive", "exam", id);
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
      },
    },
    async (request: any, reply: any) => {
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
      },
    },
    async (request: any, reply: any) => {
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
      },
    },
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

      for (const candidateId of candidateIds) {
        if (existingIds.has(candidateId)) {
          skipped++;
          continue;
        }
        const candidate = await candidateRepo.findById(ctx, candidateId);
        if (!candidate) {
          skipped++;
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

      return { added, skipped, enrollments };
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
      },
    },
    async (request: any, reply: any) => {
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
