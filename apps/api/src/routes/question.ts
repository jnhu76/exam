import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  CreateQuestionRequestSchema,
  QuestionImportRequestSchema,
  UpdateQuestionRequestSchema,
  PaginationParamsSchema,
  QuestionSchema,
  QuestionImportResultSchema,
  ErrorResponseSchema,
} from "@exam/contracts";
import { createQuestionRepo } from "@exam/db/src/repository/questionRepo.js";
import { createCourseRepo } from "@exam/db/src/repository/courseRepo.js";
import { createImportJobLogRepo } from "@exam/db/src/repository/importJobLogRepo.js";
import { executeInTransaction } from "@exam/db/src/types.js";
import { Permission } from "@exam/authz";
import type { RequestContext } from "@exam/domain";
import {
  ensureTargetOrg,
  getRequestContext,
  resolveImportStatus,
} from "./helpers.js";
import { recordBestEffortAudit } from "../audit/auditWriter.js";
import {
  buildErrorResponse,
  buildValidationErrorResponse,
} from "../lib/errorResponse.js";

/** Zod schema for route params containing a UUID `id`. */
const idParamsSchema = z.object({ id: z.string().uuid() });

/** OpenAPI security scheme: HTTP-only cookie authentication. */
const cookieAuth = [{ cookieAuth: [] }] as const;

/** Zod schema for the paginated question list response. */
const questionListResponseSchema = z.object({
  items: z.array(QuestionSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  totalPages: z.number().int().nonnegative(),
});

/** Zod schema for query parameters when listing questions, including filters for courseId, type, difficulty, tags, and a case-insensitive content search. */
const questionListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  courseId: z.string().uuid().optional(),
  type: z.string().optional(),
  difficulty: z.coerce.number().int().optional(),
  tags: z.string().optional(),
  search: z.string().optional(),
});

/** Zod schema for the distinct tag vocabulary response (issue #182 tag filter). */
const questionTagListResponseSchema = z.object({
  tags: z.array(z.string()),
});

/** Fastify plugin that registers all question CRUD and import routes. */
const questionRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    "/questions",
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireCapability(Permission.QuestionView),
      ],
      schema: {
        querystring: questionListQuerySchema,
        security: cookieAuth,
        "x-role": ["Admin", "Teacher"],
        response: {
          200: questionListResponseSchema,
        },
      },
    },
    /** List questions with pagination and optional filters (courseId, type, difficulty, tags) and server-side content search. */
    async (request: any) => {
      const ctx = ensureTargetOrg(getRequestContext(request));
      const { page, pageSize } = PaginationParamsSchema.parse(request.query);
      const query = request.query as Record<string, string | undefined>;
      const repo = createQuestionRepo(fastify.db);

      const filters: {
        courseId?: string;
        type?: string;
        difficulty?: number;
        tags?: string[];
        search?: string;
      } = {};
      if (query.courseId) filters.courseId = query.courseId;
      if (query.type) filters.type = query.type;
      if (query.difficulty) filters.difficulty = Number(query.difficulty);
      if (query.tags) {
        filters.tags = query.tags
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean);
      }
      if (query.search) filters.search = query.search;

      const { items, total } = await repo.listFiltered(ctx, filters, {
        page,
        pageSize,
      });

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
          // P3-L0-1C: project rubric on the authoritative question read path.
          // Candidate-facing contracts (CandidateQuestionSnapshot) omit it
          // separately; this admin list is authoritative.
          rubric: q.rubric,
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
    "/questions/tags",
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireCapability(Permission.QuestionView),
      ],
      schema: {
        security: cookieAuth,
        "x-role": ["Admin", "Teacher"],
        response: {
          200: questionTagListResponseSchema,
        },
      },
    },
    /** Returns the distinct sorted tag vocabulary of the org (issue #182 tag filter). */
    async (request: any) => {
      const ctx = ensureTargetOrg(getRequestContext(request));
      const repo = createQuestionRepo(fastify.db);
      return { tags: await repo.listAllTags(ctx) };
    },
  );

  fastify.get(
    "/questions/:id",
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireCapability(Permission.QuestionView),
      ],
      schema: {
        params: idParamsSchema,
        security: cookieAuth,
        "x-role": ["Admin", "Teacher"],
        response: {
          200: QuestionSchema,
          404: ErrorResponseSchema,
        },
      },
    },
    /** Get a single question by ID. Returns 404 if not found. */
    async (request: any, reply: any) => {
      const ctx = ensureTargetOrg(getRequestContext(request));
      const { id } = request.params as { id: string };
      const repo = createQuestionRepo(fastify.db);
      const question = await repo.findById(ctx, id);
      if (!question) {
        return reply
          .code(404)
          .send(buildErrorResponse(request.id, "RESOURCE_NOT_FOUND"));
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
        rubric: question.rubric,
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
        fastify.requireCapability(Permission.QuestionCreate),
      ],
      schema: {
        body: CreateQuestionRequestSchema,
        security: cookieAuth,
        "x-role": ["Admin", "Teacher"],
        response: {
          201: QuestionSchema,
          400: ErrorResponseSchema,
        },
      },
    },
    /** Create a new question. Validates that the referenced courseId exists. Returns 400 on validation error. */
    async (request: any, reply: any) => {
      const ctx = ensureTargetOrg(getRequestContext(request));
      const parsed = CreateQuestionRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send(buildValidationErrorResponse(request.id, parsed.error));
      }
      const data = parsed.data;
      if (!(await createCourseRepo(fastify.db).findById(ctx, data.courseId))) {
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

      const question = await createQuestionRepo(fastify.db).create(ctx, {
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
        rubric: data.rubric,
      });
      recordBestEffortAudit(fastify, request, ctx, {
        action: "question.create",
        targetType: "question",
        targetId: question.id,
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
        rubric: question.rubric,
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
        fastify.requireCapability(Permission.QuestionUpdate),
      ],
      schema: {
        params: idParamsSchema,
        body: UpdateQuestionRequestSchema,
        security: cookieAuth,
        "x-role": ["Admin", "Teacher"],
        response: {
          200: QuestionSchema,
          400: ErrorResponseSchema,
          404: ErrorResponseSchema,
        },
      },
    },
    /** Update an existing question by ID. Validates courseId and question existence. Returns 404 if not found, 400 on validation error. */
    async (request: any, reply: any) => {
      const ctx = ensureTargetOrg(getRequestContext(request));
      const { id } = request.params as { id: string };
      const data = UpdateQuestionRequestSchema.parse(request.body);
      const repo = createQuestionRepo(fastify.db);
      const existing = await repo.findById(ctx, id);
      if (!existing) {
        return reply
          .code(404)
          .send(buildErrorResponse(request.id, "RESOURCE_NOT_FOUND"));
      }
      const validated = CreateQuestionRequestSchema.parse({
        ...existing,
        ...data,
      });
      if (
        !(await createCourseRepo(fastify.db).findById(ctx, validated.courseId))
      ) {
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
      const updated = await createQuestionRepo(fastify.db).update(ctx, id, {
        ...validated,
        options: (validated.options ?? []).map((option) => ({
          id: option.id,
          content: option.content,
          ...(option.isCorrect !== undefined
            ? { isCorrect: option.isCorrect }
            : {}),
        })),
      });
      if (updated) {
        recordBestEffortAudit(fastify, request, ctx, {
          action: "question.update",
          targetType: "question",
          targetId: id,
          metadata: { changedFields: Object.keys(data) },
        });
      }
      if (!updated) {
        return reply
          .code(404)
          .send(buildErrorResponse(request.id, "RESOURCE_NOT_FOUND"));
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
        rubric: updated.rubric,
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
        fastify.requireCapability(Permission.QuestionDelete),
      ],
      schema: {
        params: idParamsSchema,
        security: cookieAuth,
        "x-role": ["Admin", "Teacher"],
        response: {
          204: z.null(),
          404: ErrorResponseSchema,
        },
      },
    },
    /** Delete a question by ID. Returns 404 if not found. */
    async (request: any, reply: any) => {
      const ctx = ensureTargetOrg(getRequestContext(request));
      const { id } = request.params as { id: string };
      const deleted = await createQuestionRepo(fastify.db).delete(ctx, id);
      if (deleted) {
        recordBestEffortAudit(fastify, request, ctx, {
          action: "question.delete",
          targetType: "question",
          targetId: id,
        });
      }
      if (!deleted) {
        return reply
          .code(404)
          .send(buildErrorResponse(request.id, "RESOURCE_NOT_FOUND"));
      }
      return reply.code(204).send();
    },
  );

  fastify.post(
    "/questions/import",
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireCapability(Permission.QuestionImport),
      ],
      config: { rateLimit: { max: 5, timeWindow: 60 * 1000 } },
      schema: {
        body: QuestionImportRequestSchema,
        security: cookieAuth,
        "x-role": ["Admin", "Teacher"],
        response: {
          200: QuestionImportResultSchema,
          400: ErrorResponseSchema,
        },
      },
    },
    /** Import questions in bulk from CSV-like rows. Validates each row; creates questions only when confirm=true. Rate-limited to 5 requests per minute. */
    async (request: any, reply: any) => {
      const ctx = ensureTargetOrg(getRequestContext(request));
      const parsed = QuestionImportRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send(buildValidationErrorResponse(request.id, parsed.error));
      }
      const body = parsed.data;
      if (!(await createCourseRepo(fastify.db).findById(ctx, body.courseId))) {
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

      const processRows = async (
        repo: ReturnType<typeof createQuestionRepo>,
      ) => {
        const details: Array<{
          row: number;
          status: "valid" | "warning" | "error";
          message?: string;
        }> = [];
        let valid = 0;
        const warnings = 0;
        let errors = 0;

        for (let i = 0; i < body.rows.length; i++) {
          const raw = body.rows[i];
          if (!raw) continue;
          const parsedRow = CreateQuestionRequestSchema.safeParse({
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
            rubric: raw.rubric,
          });

          if (!parsedRow.success) {
            errors++;
            details.push({
              row: i + 1,
              status: "error",
              message: parsedRow.error.issues
                .map((issue) => issue.message)
                .join("; "),
            });
            continue;
          }

          const data = parsedRow.data;
          if (body.confirm) {
            await repo.create(ctx, {
              courseId: data.courseId,
              type: data.type,
              content: data.content,
              options: (data.options ?? []).map((option) => ({
                id: option.id,
                content: option.content,
                ...(option.isCorrect !== undefined
                  ? { isCorrect: option.isCorrect }
                  : {}),
              })),
              standardAnswer: data.standardAnswer,
              attachments: data.attachments,
              score: data.score,
              difficulty: data.difficulty,
              tags: data.tags,
              gradingRule: data.gradingRule,
              rubric: data.rubric,
            });
          }
          valid++;
          details.push({ row: i + 1, status: "valid" });
        }
        return { details, valid, warnings, errors };
      };

      const processed = body.confirm
        ? await executeInTransaction(fastify.db, async (tx) => {
            return processRows(createQuestionRepo(tx));
          })
        : await processRows(createQuestionRepo(fastify.db));
      const { details, valid, warnings, errors } = processed;

      if (body.confirm) {
        recordBestEffortAudit(fastify, request, ctx, {
          action: "question.import",
          targetType: "course",
          targetId: body.courseId,
          metadata: { total: body.rows.length, valid, errors },
        });
      }

      if (body.confirm) {
        const questionLogStatus = resolveImportStatus({
          errors,
          affectedCount: valid,
        });
        let logId: string | undefined;
        try {
          const questionLog = await createImportJobLogRepo(fastify.db).create(
            ctx,
            {
              type: "question",
              status: questionLogStatus,
              total: body.rows.length,
              createdCount: valid,
              updatedCount: 0,
              errors,
              metadata: { courseId: body.courseId, warnings },
              errorsDetail:
                errors > 0
                  ? details
                      .filter((d) => d.status === "error")
                      .map((d) => ({
                        row: d.row,
                        code: "VALIDATION_ERROR",
                        message: d.message ?? "",
                      }))
                  : null,
            },
          );
          logId = questionLog.id;
        } catch (logError) {
          fastify.log.error(
            { err: logError, type: "question", status: questionLogStatus },
            "Failed to persist question import log; import result is unchanged",
          );
        }
        return reply.code(200).send({
          total: body.rows.length,
          valid,
          warnings,
          errors,
          details,
          ...(logId ? { logId } : {}),
        });
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
