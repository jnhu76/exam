import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  CreateQuestionRequestSchema,
  UpdateQuestionRequestSchema,
  PaginationParamsSchema,
} from "@exam/contracts";
import { createQuestionRepo } from "@exam/db/src/repository/questionRepo.js";
import type { RequestContext } from "@exam/domain";
import { ensureTargetOrg, formatZodError } from "./helpers.js";

const ImportBodySchema = z.object({
  courseId: z.string().uuid(),
  rows: z.array(z.record(z.unknown())).min(1),
});

const questionRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    "/questions",
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireRole(["Admin", "SuperAdmin", "Teacher"]),
      ],
    },
    async (request: any) => {
      const ctx = ensureTargetOrg(request["ctx"] as RequestContext);
      const { page, pageSize } = PaginationParamsSchema.parse(request.query);
      const repo = createQuestionRepo(fastify.db);
      const all = repo.list(ctx);

      const query = request.query as Record<string, string | undefined>;
      let filtered = all;
      if (query.courseId) {
        filtered = filtered.filter((q) => q.courseId === query.courseId);
      }
      if (query.type) {
        filtered = filtered.filter((q) => q.type === query.type);
      }
      if (query.difficulty) {
        filtered = filtered.filter(
          (q) => q.difficulty === Number(query.difficulty),
        );
      }

      const total = filtered.length;
      const offset = (page - 1) * pageSize;
      const items = filtered.slice(offset, offset + pageSize);

      return {
        items: items.map((q) => ({
          id: q.id,
          organizationId: q.organizationId,
          courseId: q.courseId,
          type: q.type,
          content: q.content,
          options: q.options,
          standardAnswer: q.standardAnswer,
          attachments: q.attachments,
          score: q.score,
          difficulty: q.difficulty,
          tags: q.tags,
          gradingRule: q.gradingRule,
          createdAt: q.createdAt.toISOString(),
          updatedAt: q.updatedAt.toISOString(),
        })),
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      };
    },
  );

  fastify.get(
    "/questions/:id",
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireRole(["Admin", "SuperAdmin", "Teacher"]),
      ],
    },
    async (request: any, reply: any) => {
      const ctx = ensureTargetOrg(request["ctx"] as RequestContext);
      const { id } = request.params as { id: string };
      const repo = createQuestionRepo(fastify.db);
      const question = repo.findById(ctx, id);
      if (!question) {
        return reply.code(404).send({
          error: { code: "NOT_FOUND", message: "Question not found" },
        });
      }
      return {
        id: question.id,
        organizationId: question.organizationId,
        courseId: question.courseId,
        type: question.type,
        content: question.content,
        options: question.options,
        standardAnswer: question.standardAnswer,
        attachments: question.attachments,
        score: question.score,
        difficulty: question.difficulty,
        tags: question.tags,
        gradingRule: question.gradingRule,
        createdAt: question.createdAt.toISOString(),
        updatedAt: question.updatedAt.toISOString(),
      };
    },
  );

  fastify.post(
    "/questions",
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireRole(["Admin", "SuperAdmin", "Teacher"]),
      ],
    },
    async (request: any, reply: any) => {
      const ctx = ensureTargetOrg(request["ctx"] as RequestContext);
      const parsed = CreateQuestionRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send(formatZodError(parsed.error));
      }
      const data = parsed.data;
      const repo = createQuestionRepo(fastify.db);

      const question = repo.create(ctx, {
        courseId: data.courseId,
        type: data.type,
        content: data.content,
        options: (data.options ?? []).map((o) => ({
          id: o.id,
          content: o.content,
          ...(o.isCorrect !== undefined ? { isCorrect: o.isCorrect } : {}),
        })),
        standardAnswer: data.standardAnswer,
        attachments: data.attachments,
        score: data.score,
        difficulty: data.difficulty,
        tags: data.tags,
        gradingRule: data.gradingRule,
      });

      return reply.code(201).send({
        id: question.id,
        organizationId: question.organizationId,
        courseId: question.courseId,
        type: question.type,
        content: question.content,
        options: question.options,
        standardAnswer: question.standardAnswer,
        attachments: question.attachments,
        score: question.score,
        difficulty: question.difficulty,
        tags: question.tags,
        gradingRule: question.gradingRule,
        createdAt: question.createdAt.toISOString(),
        updatedAt: question.updatedAt.toISOString(),
      });
    },
  );

  fastify.patch(
    "/questions/:id",
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireRole(["Admin", "SuperAdmin", "Teacher"]),
      ],
    },
    async (request: any, reply: any) => {
      const ctx = ensureTargetOrg(request["ctx"] as RequestContext);
      const { id } = request.params as { id: string };
      const data = UpdateQuestionRequestSchema.parse(request.body);
      const repo = createQuestionRepo(fastify.db);
      const updated = repo.update(ctx, id, data as Record<string, unknown>);
      if (!updated) {
        return reply.code(404).send({
          error: { code: "NOT_FOUND", message: "Question not found" },
        });
      }
      return {
        id: updated.id,
        organizationId: updated.organizationId,
        courseId: updated.courseId,
        type: updated.type,
        content: updated.content,
        options: updated.options,
        standardAnswer: updated.standardAnswer,
        attachments: updated.attachments,
        score: updated.score,
        difficulty: updated.difficulty,
        tags: updated.tags,
        gradingRule: updated.gradingRule,
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
      };
    },
  );

  fastify.delete(
    "/questions/:id",
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireRole(["Admin", "SuperAdmin", "Teacher"]),
      ],
    },
    async (request: any, reply: any) => {
      const ctx = ensureTargetOrg(request["ctx"] as RequestContext);
      const { id } = request.params as { id: string };
      const repo = createQuestionRepo(fastify.db);
      const deleted = repo.delete(ctx, id);
      if (!deleted) {
        return reply.code(404).send({
          error: { code: "NOT_FOUND", message: "Question not found" },
        });
      }
      return reply.code(204).send();
    },
  );

  fastify.post(
    "/questions/import",
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireRole(["Admin", "SuperAdmin", "Teacher"]),
      ],
    },
    async (request: any, reply: any) => {
      const ctx = ensureTargetOrg(request["ctx"] as RequestContext);
      const parsed = ImportBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send(formatZodError(parsed.error));
      }
      const body = parsed.data;
      const repo = createQuestionRepo(fastify.db);

      const details: Array<{
        row: number;
        status: "valid" | "warning" | "error";
        message?: string;
      }> = [];

      let valid = 0;
      let warnings = 0;
      let errors = 0;

      for (let i = 0; i < body.rows.length; i++) {
        const raw = body.rows[i];
        if (!raw) continue;
        const parsed = CreateQuestionRequestSchema.safeParse({
          courseId: body.courseId,
          type: raw.type,
          content: raw.content,
          options:
            raw.optionA || raw.optionB
              ? [
                  raw.optionA
                    ? {
                        id: "A",
                        content: raw.optionA,
                        isCorrect: false as boolean,
                      }
                    : undefined,
                  raw.optionB
                    ? {
                        id: "B",
                        content: raw.optionB,
                        isCorrect: false as boolean,
                      }
                    : undefined,
                  raw.optionC
                    ? {
                        id: "C",
                        content: raw.optionC,
                        isCorrect: false as boolean,
                      }
                    : undefined,
                  raw.optionD
                    ? {
                        id: "D",
                        content: raw.optionD,
                        isCorrect: false as boolean,
                      }
                    : undefined,
                ].filter((o): o is NonNullable<typeof o> => o !== undefined)
              : undefined,
          standardAnswer: raw.standardAnswer,
          score: raw.score,
          difficulty: raw.difficulty,
          tags:
            typeof raw.tags === "string"
              ? raw.tags.split(",").map((t: string) => t.trim())
              : undefined,
          gradingRule: raw.gradingRule,
        });

        if (!parsed.success) {
          errors++;
          details.push({
            row: i + 1,
            status: "error",
            message: parsed.error.issues.map((iss) => iss.message).join("; "),
          });
          continue;
        }

        const data = parsed.data;
        repo.create(ctx, {
          courseId: data.courseId,
          type: data.type,
          content: data.content,
          options: (data.options ?? []).map((o) => ({
            id: o.id,
            content: o.content,
            ...(o.isCorrect !== undefined ? { isCorrect: o.isCorrect } : {}),
          })),
          standardAnswer: data.standardAnswer,
          attachments: data.attachments,
          score: data.score,
          difficulty: data.difficulty,
          tags: data.tags,
          gradingRule: data.gradingRule,
        });
        valid++;
        details.push({ row: i + 1, status: "valid" });
      }

      return reply.code(200).send({
        total: body.rows.length,
        valid,
        warnings,
        errors,
        details,
      });
    },
  );
};

export default questionRoutes;
