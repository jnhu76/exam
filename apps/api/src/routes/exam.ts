import { FastifyPluginAsync } from "fastify";
import {
  CreateExamRequestSchema,
  UpdateExamRequestSchema,
  PaginationParamsSchema,
} from "@exam/contracts";
import { createExamRepo } from "@exam/db/src/repository/examRepo.js";
import { createQuestionRepo } from "@exam/db/src/repository/questionRepo.js";
import { publishExam, type ExamRepository } from "@exam/exam-engine";
import type { RequestContext, Exam, Question } from "@exam/domain";
import { InvalidStateTransitionError, ValidationError } from "@exam/domain";
import { ensureTargetOrg, formatZodError } from "./helpers.js";

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
        items: items.map((e) => toExamResponse(e as Exam)),
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
      return toExamResponse(exam);
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

      const updateData: Record<string, unknown> = { ...data };
      if (data.openAt) updateData.openAt = new Date(data.openAt);
      if (data.closeAt) updateData.closeAt = new Date(data.closeAt);

      const updated = repo.update(ctx, id, updateData) as Exam | null;
      if (!updated) {
        return reply
          .code(404)
          .send({ error: { code: "NOT_FOUND", message: "Exam not found" } });
      }
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
        const examRepoAdapter: ExamRepository = {
          findById: (examId: string) =>
            examRepo.findById(ctx, examId) as Exam | null,
          update: (examId: string, data: Partial<Exam>) =>
            examRepo.update(
              ctx,
              examId,
              data as Record<string, unknown>,
            ) as Exam | null,
        };
        const updated = publishExam(examRepoAdapter, id, questions);
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

      const exam = repo.findById(ctx, id) as Exam | null;
      if (!exam) {
        return reply
          .code(404)
          .send({ error: { code: "NOT_FOUND", message: "Exam not found" } });
      }

      if (exam.status !== "published" && exam.status !== "closed") {
        return reply.code(409).send({
          error: {
            code: "INVALID_STATE_TRANSITION",
            message: "Can only archive published or closed exams",
          },
        });
      }

      const updated = repo.update(ctx, id, {
        status: "archived",
      }) as Exam | null;

      return toExamResponse(updated!);
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
      return reply.code(204).send();
    },
  );
};

export default examRoutes;
