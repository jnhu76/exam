import { FastifyPluginAsync } from "fastify";
import {
  CreateExamRequestSchema,
  UpdateExamRequestSchema,
  PaginationParamsSchema,
} from "@exam/contracts";
import { createExamRepo } from "@exam/db/src/repository/examRepo.js";
import { createQuestionRepo } from "@exam/db/src/repository/questionRepo.js";
import { createCourseRepo } from "@exam/db/src/repository/courseRepo.js";
import { createEnrollmentRepo } from "@exam/db/src/repository/enrollmentRepo.js";
import { createCandidateRepo } from "@exam/db/src/repository/candidateRepo.js";
import { createUserRepo } from "@exam/db/src/repository/userRepo.js";
import type { SqliteDatabase } from "@exam/db/src/sqlite.js";
import {
  archiveExam,
  publishExam,
  type ExamRepository,
} from "@exam/exam-engine";
import type { RequestContext, Exam, Question } from "@exam/domain";
import { InvalidStateTransitionError, ValidationError } from "@exam/domain";
import { ensureTargetOrg, formatZodError } from "./helpers.js";
import { recordAudit } from "./audit.js";

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

function getExamParticipants(
  db: SqliteDatabase,
  ctx: RequestContext,
  examId: string,
) {
  const enrollments = createEnrollmentRepo(db)
    .list(ctx)
    .filter((enrollment) => enrollment.examId === examId);
  const candidateRepo = createCandidateRepo(db);
  const userRepo = createUserRepo(db);
  return enrollments.map((enrollment) => {
    const candidate = candidateRepo.findById(ctx, enrollment.candidateId);
    const user = candidate ? userRepo.findById(ctx, candidate.userId) : null;
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
    findById: (examId) => repo.findById(ctx, examId) as Exam | null,
    update: (examId, data) =>
      repo.update(ctx, examId, data as Record<string, unknown>) as Exam | null,
  };
}

const examRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    "/exams",
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireRole(["Admin", "SuperAdmin", "Teacher"]),
      ],
    },
    async (request: any) => {
      const ctx = ensureTargetOrg(request["ctx"] as RequestContext);
      const { page, pageSize } = PaginationParamsSchema.parse(request.query);
      const repo = createExamRepo(fastify.db);
      const { items, total } = repo.listPaginated(ctx, page, pageSize);

      return {
        items: items.map((e) => ({
          ...toExamResponse(e as Exam),
          participantCount: getExamParticipants(fastify.db, ctx, e.id).length,
        })),
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
        fastify.requireRole(["Admin", "SuperAdmin", "Teacher"]),
      ],
    },
    async (request: any, reply: any) => {
      const ctx = ensureTargetOrg(request["ctx"] as RequestContext);
      const { id } = request.params as { id: string };
      const repo = createExamRepo(fastify.db);
      const exam = repo.findById(ctx, id) as Exam | null;
      if (!exam) {
        return reply
          .code(404)
          .send({ error: { code: "NOT_FOUND", message: "Exam not found" } });
      }
      const participants = getExamParticipants(fastify.db, ctx, exam.id);
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
        fastify.requireRole(["Admin", "SuperAdmin", "Teacher"]),
      ],
    },
    async (request: any, reply: any) => {
      const ctx = ensureTargetOrg(request["ctx"] as RequestContext);
      const parsed = CreateExamRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send(formatZodError(parsed.error));
      }
      const data = parsed.data;
      const repo = createExamRepo(fastify.db);
      const course = createCourseRepo(fastify.db).findById(ctx, data.courseId);
      const questionRepo = createQuestionRepo(fastify.db);
      if (!course) {
        return reply.code(400).send({
          error: { code: "VALIDATION_ERROR", message: "Course not found" },
        });
      }
      if (
        data.questionIds.some(
          (id) => questionRepo.findById(ctx, id)?.courseId !== data.courseId,
        )
      ) {
        return reply.code(400).send({
          error: {
            code: "VALIDATION_ERROR",
            message: "Questions must belong to the selected course",
          },
        });
      }

      const exam = repo.create(ctx, {
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
      preHandler: [
        fastify.authenticate,
        fastify.requireRole(["Admin", "SuperAdmin", "Teacher"]),
      ],
    },
    async (request: any, reply: any) => {
      const ctx = ensureTargetOrg(request["ctx"] as RequestContext);
      const { id } = request.params as { id: string };
      const parsed = UpdateExamRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send(formatZodError(parsed.error));
      }
      const data = parsed.data;
      const repo = createExamRepo(fastify.db);

      const existing = repo.findById(ctx, id) as Exam | null;
      if (!existing) {
        return reply
          .code(404)
          .send({ error: { code: "NOT_FOUND", message: "Exam not found" } });
      }

      if (existing.status !== "draft") {
        return reply.code(409).send({
          error: {
            code: "INVALID_STATE_TRANSITION",
            message: "Can only update draft exams",
          },
        });
      }
      if (
        data.questionIds?.some(
          (questionId) =>
            createQuestionRepo(fastify.db).findById(ctx, questionId)
              ?.courseId !== existing.courseId,
        )
      ) {
        return reply.code(400).send({
          error: {
            code: "VALIDATION_ERROR",
            message: "Questions must belong to the selected course",
          },
        });
      }

      const updateData: Record<string, unknown> = { ...data };
      if (data.openAt) updateData.openAt = new Date(data.openAt);
      if (data.closeAt) updateData.closeAt = new Date(data.closeAt);

      const updated = repo.update(ctx, id, updateData) as Exam | null;
      if (!updated) {
        return reply
          .code(404)
          .send({ error: { code: "NOT_FOUND", message: "Exam not found" } });
      }
      recordAudit(fastify, request, ctx, "exam.update", "exam", id);
      return toExamResponse(updated);
    },
  );

  fastify.post(
    "/exams/:id/publish",
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireRole(["Admin", "SuperAdmin", "Teacher"]),
      ],
    },
    async (request: any, reply: any) => {
      const ctx = ensureTargetOrg(request["ctx"] as RequestContext);
      const { id } = request.params as { id: string };
      const examRepo = createExamRepo(fastify.db);
      const questionRepo = createQuestionRepo(fastify.db);

      const exam = examRepo.findById(ctx, id) as Exam | null;
      if (!exam) {
        return reply
          .code(404)
          .send({ error: { code: "NOT_FOUND", message: "Exam not found" } });
      }

      const questions = exam.questionIds
        .map((qid) => questionRepo.findById(ctx, qid))
        .filter((q): q is NonNullable<typeof q> => q !== null) as Question[];

      try {
        const examRepoAdapter = createExamRepoAdapter(examRepo, ctx);
        const updated = publishExam(examRepoAdapter, id, questions);
        recordAudit(fastify, request, ctx, "exam.publish", "exam", id);
        return toExamResponse(updated);
      } catch (err) {
        if (err instanceof InvalidStateTransitionError) {
          return reply.code(409).send({
            error: { code: err.code, message: err.message },
          });
        }
        if (err instanceof ValidationError) {
          return reply.code(400).send({
            error: { code: err.code, message: err.message },
          });
        }
        throw err;
      }
    },
  );

  fastify.post(
    "/exams/:id/archive",
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireRole(["Admin", "SuperAdmin", "Teacher"]),
      ],
    },
    async (request: any, reply: any) => {
      const ctx = ensureTargetOrg(request["ctx"] as RequestContext);
      const { id } = request.params as { id: string };
      const repo = createExamRepo(fastify.db);

      const archived = archiveExam(createExamRepoAdapter(repo, ctx), id);
      recordAudit(fastify, request, ctx, "exam.archive", "exam", id);
      return toExamResponse(archived);
    },
  );

  fastify.delete(
    "/exams/:id",
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireRole(["Admin", "SuperAdmin", "Teacher"]),
      ],
    },
    async (request: any, reply: any) => {
      const ctx = ensureTargetOrg(request["ctx"] as RequestContext);
      const { id } = request.params as { id: string };
      const repo = createExamRepo(fastify.db);

      const exam = repo.findById(ctx, id) as Exam | null;
      if (!exam) {
        return reply
          .code(404)
          .send({ error: { code: "NOT_FOUND", message: "Exam not found" } });
      }

      if (exam.status !== "draft") {
        return reply.code(409).send({
          error: {
            code: "INVALID_STATE_TRANSITION",
            message: "Can only delete draft exams",
          },
        });
      }

      repo.delete(ctx, id);
      recordAudit(fastify, request, ctx, "exam.delete", "exam", id);
      return reply.code(204).send();
    },
  );

  fastify.get(
    "/exams/:examId/enrollments",
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireRole(["Admin", "SuperAdmin", "Teacher"]),
      ],
    },
    async (request: any, reply: any) => {
      const ctx = ensureTargetOrg(request["ctx"] as RequestContext);
      const { examId } = request.params as { examId: string };
      const examRepo = createExamRepo(fastify.db);
      const exam = examRepo.findById(ctx, examId) as Exam | null;
      if (!exam) {
        return reply
          .code(404)
          .send({ error: { code: "NOT_FOUND", message: "Exam not found" } });
      }

      const enrollmentRepo = createEnrollmentRepo(fastify.db);
      const enrollments = enrollmentRepo
        .list(ctx)
        .filter((e) => e.examId === examId);
      const candidateRepo = createCandidateRepo(fastify.db);
      const userRepo = createUserRepo(fastify.db);

      return enrollments.map((enrollment) => {
        const candidate = candidateRepo.findById(ctx, enrollment.candidateId);
        const user = candidate
          ? userRepo.findById(ctx, candidate.userId)
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
      });
    },
  );

  fastify.post(
    "/exams/:examId/enrollments",
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireRole(["Admin", "SuperAdmin", "Teacher"]),
      ],
    },
    async (request: any, reply: any) => {
      const ctx = ensureTargetOrg(request["ctx"] as RequestContext);
      const { examId } = request.params as { examId: string };
      const { candidateIds } = request.body as { candidateIds: string[] };
      if (!Array.isArray(candidateIds) || candidateIds.length === 0) {
        return reply.code(400).send({
          error: {
            code: "VALIDATION_ERROR",
            message: "candidateIds must be a non-empty array",
          },
        });
      }

      const examRepo = createExamRepo(fastify.db);
      const exam = examRepo.findById(ctx, examId) as Exam | null;
      if (!exam) {
        return reply
          .code(404)
          .send({ error: { code: "NOT_FOUND", message: "Exam not found" } });
      }

      const enrollmentRepo = createEnrollmentRepo(fastify.db);
      const candidateRepo = createCandidateRepo(fastify.db);
      const userRepo = createUserRepo(fastify.db);
      const existing = enrollmentRepo
        .list(ctx)
        .filter((e) => e.examId === examId);
      const existingIds = new Set(existing.map((e) => e.candidateId));

      let added = 0;
      let skipped = 0;
      const enrollments: unknown[] = [];

      for (const candidateId of candidateIds) {
        if (existingIds.has(candidateId)) {
          skipped++;
          continue;
        }
        const candidate = candidateRepo.findById(ctx, candidateId);
        if (!candidate) {
          skipped++;
          continue;
        }
        const enrollment = enrollmentRepo.create(ctx, {
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
        const user = userRepo.findById(ctx, candidate.userId);
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
      preHandler: [
        fastify.authenticate,
        fastify.requireRole(["Admin", "SuperAdmin", "Teacher"]),
      ],
    },
    async (request: any, reply: any) => {
      const ctx = ensureTargetOrg(request["ctx"] as RequestContext);
      const { examId, enrollmentId } = request.params as {
        examId: string;
        enrollmentId: string;
      };
      const enrollmentRepo = createEnrollmentRepo(fastify.db);
      const enrollment = enrollmentRepo.findById(ctx, enrollmentId);
      if (!enrollment || enrollment.examId !== examId) {
        return reply.code(404).send({
          error: {
            code: "NOT_FOUND",
            message: "Enrollment not found",
          },
        });
      }
      if (enrollment.status !== "assigned") {
        return reply.code(409).send({
          error: {
            code: "CONFLICT",
            message: "Cannot remove enrollment that has started",
          },
        });
      }

      enrollmentRepo.delete(ctx, enrollmentId);
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
