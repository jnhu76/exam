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
import { resolveTeacherCourseScope } from "./teacherScope.js";
import {
  assertRichContentUpdateAllowed,
  resolveQuestionContentWrite,
} from "./questionContent.js";
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
    /** List questions with pagination and optional filters (courseId, type, difficulty, tags) and server-side content search. Teacher actors see only questions under assigned courses (SQL-side, before pagination). */
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
        courseIds?: string[];
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

      // Issue #286 LIST scope: Admin → org-wide; Teacher → active assigned
      // course ids, applied in SQL before pagination/count. A client courseId
      // filter stays in place and ANDs with the scope set in SQL — the
      // intersection is implicit; an out-of-scope courseId simply yields zero
      // rows.
      const scope = await resolveTeacherCourseScope(fastify.db, ctx);
      if (scope) {
        filters.courseIds = scope;
      }

      if (filters.courseIds && filters.courseIds.length === 0) {
        return {
          items: [],
          total: 0,
          page,
          pageSize,
          totalPages: 0,
        };
      }

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
          contentDocument: q.contentDocument ?? null,
          answerMode: q.answerMode ?? null,
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
    /** Returns the distinct sorted tag vocabulary (issue #182 tag filter). Teacher actors get the vocabulary of their assigned courses only. */
    async (request: any) => {
      const ctx = ensureTargetOrg(getRequestContext(request));
      const repo = createQuestionRepo(fastify.db);
      // Issue #286: the vocabulary is scope-filtered SQL-side (before
      // aggregation) so a Teacher never learns out-of-scope tags.
      const scope = await resolveTeacherCourseScope(fastify.db, ctx);
      const tags = await repo.listAllTags(ctx, scope ?? undefined);
      return { tags };
    },
  );

  fastify.get(
    "/questions/:id",
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireScopedCapability(
          Permission.QuestionView,
          "question",
          "id",
          { teacherAccess: "course_assignment_scoped" },
        ),
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
        contentDocument: question.contentDocument ?? null,
        answerMode: question.answerMode ?? null,
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
        // Create-style route: the parent course id arrives in the BODY
        // (resourceIdSource), so the resolver + teacher gate validate the
        // target course (existence, org, active assignment) BEFORE creation.
        fastify.requireScopedCapability(
          Permission.QuestionCreate,
          "course",
          "courseId",
          {
            teacherAccess: "course_assignment_scoped",
            resourceIdSource: "body",
          },
        ),
      ],
      schema: {
        body: CreateQuestionRequestSchema,
        security: cookieAuth,
        "x-role": ["Admin", "Teacher"],
        response: {
          201: QuestionSchema,
          400: ErrorResponseSchema,
          404: ErrorResponseSchema,
        },
      },
    },
    /** Create a new question. Validates that the referenced courseId exists. Returns 400 on validation error. */
    async (request: any, reply: any) => {
      const ctx = ensureTargetOrg(getRequestContext(request));
      // Hostile-depth protection is schema-level (corrective pass round-2):
      // ContentDocumentV1Schema preflights every rich slot before its
      // recursive grammar, and Fastify validates the body BEFORE this handler,
      // so a deep bomb never reaches handler code.
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

      // #301: the B′ write authority derives `content` from the normalized
      // document for Rich writes and persists content_document = NULL for
      // Plain writes. Client-supplied projections are never persisted.
      const resolved = resolveQuestionContentWrite({
        type: data.type,
        content: data.content,
        contentDocument: data.contentDocument,
        answerMode: data.answerMode,
        options: data.options,
      });

      const question = await createQuestionRepo(fastify.db).create(ctx, {
        courseId: data.courseId,
        type: data.type,
        content: resolved.content,
        contentDocument: resolved.contentDocument,
        answerMode: resolved.answerMode,
        options: resolved.options,
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
        contentDocument: question.contentDocument ?? null,
        answerMode: question.answerMode ?? null,
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
        fastify.requireScopedCapability(
          Permission.QuestionUpdate,
          "question",
          "id",
          { teacherAccess: "course_assignment_scoped" },
        ),
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
    /** Update an existing question by ID. Validates courseId and question existence. A course MOVE additionally requires an active assignment to the destination course (issue #286 §3H). Returns 404 if not found, 400 on validation error. */
    async (request: any, reply: any) => {
      const ctx = ensureTargetOrg(getRequestContext(request));
      const { id } = request.params as { id: string };
      // Hostile-depth protection is schema-level (corrective pass round-2):
      // ContentDocumentV1Schema preflights every rich slot before its
      // recursive grammar — this covers both Fastify's body validation and the
      // merged re-validation parse below, which replays the raw document slots.
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
      // Issue #286 §3H: moving a question across courses must not widen
      // authority. The gate validated the CURRENT course; the DESTINATION
      // course needs its own active assignment for non-Admin actors. The
      // denial mirrors the missing-course shape exactly (anti-enumeration:
      // an unassigned destination is indistinguishable from a missing one).
      if (validated.courseId !== existing.courseId) {
        const scope = await resolveTeacherCourseScope(fastify.db, ctx);
        if (scope && !scope.includes(validated.courseId)) {
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
      }
      // #301 route-level projection-authority guard: a bare `content` edit on
      // a rich question is rejected — the client must send a new document or
      // explicitly clear it (contentDocument: null).
      assertRichContentUpdateAllowed({
        storedDocument: existing.contentDocument ?? null,
        updateContent: data.content,
        updateDocument: data.contentDocument,
      });
      // #301: merged re-validation (existing + data through the create
      // schema) already rejects a rich fill_blank and answerMode/type
      // mismatches; the seam then re-derives the authoritative slots.
      const resolved = resolveQuestionContentWrite({
        type: validated.type,
        content: validated.content,
        contentDocument: validated.contentDocument,
        answerMode: validated.answerMode,
        options: validated.options,
      });
      const updated = await createQuestionRepo(fastify.db).update(ctx, id, {
        courseId: validated.courseId,
        type: validated.type,
        content: resolved.content,
        contentDocument: resolved.contentDocument,
        answerMode: resolved.answerMode,
        options: resolved.options,
        standardAnswer: validated.standardAnswer,
        attachments: validated.attachments,
        score: validated.score,
        difficulty: validated.difficulty,
        tags: validated.tags,
        gradingRule: validated.gradingRule,
        rubric: validated.rubric,
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
        contentDocument: updated.contentDocument ?? null,
        answerMode: updated.answerMode ?? null,
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
        fastify.requireScopedCapability(
          Permission.QuestionDelete,
          "question",
          "id",
          { teacherAccess: "course_assignment_scoped" },
        ),
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
        // Create-style route: the target course id arrives in the BODY.
        fastify.requireScopedCapability(
          Permission.QuestionImport,
          "course",
          "courseId",
          {
            teacherAccess: "course_assignment_scoped",
            resourceIdSource: "body",
          },
        ),
      ],
      config: { rateLimit: { max: 5, timeWindow: 60 * 1000 } },
      schema: {
        body: QuestionImportRequestSchema,
        security: cookieAuth,
        "x-role": ["Admin", "Teacher"],
        response: {
          200: QuestionImportResultSchema,
          400: ErrorResponseSchema,
          404: ErrorResponseSchema,
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
            // #301: import is Plain-only BY CONSTRUCTION — the seam persists
            // content_document = NULL and derives contents from the plain
            // strings; CSV carries no rich payloads.
            const resolved = resolveQuestionContentWrite({
              type: data.type,
              content: data.content,
              contentDocument: null,
              answerMode: null,
              options: data.options,
            });
            await repo.create(ctx, {
              courseId: data.courseId,
              type: data.type,
              content: resolved.content,
              contentDocument: resolved.contentDocument,
              answerMode: resolved.answerMode,
              options: resolved.options,
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
