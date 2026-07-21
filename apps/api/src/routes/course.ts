import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  CreateCourseRequestSchema,
  UpdateCourseRequestSchema,
  PaginationParamsSchema,
  ErrorResponseSchema,
} from "@exam/contracts";
import { createCourseRepo } from "@exam/db/src/repository/courseRepo.js";
import { createQuestionRepo } from "@exam/db/src/repository/questionRepo.js";
import type { RequestContext } from "@exam/domain";
import { Permission } from "@exam/authz";
import { ensureTargetOrg, getRequestContext } from "./helpers.js";
import { recordBestEffortAudit } from "../audit/auditWriter.js";
import { buildErrorResponse } from "../lib/errorResponse.js";

/** OpenAPI security scheme: HTTP-only cookie authentication. */
const cookieAuth = [{ cookieAuth: [] }] as const;

/** Zod schema for a single course item returned in list and detail responses. */
const courseItemSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  name: z.string(),
  code: z.string(),
  description: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

/** Zod schema for the paginated course list response. */
const courseListResponseSchema = z.object({
  items: z.array(courseItemSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
  totalPages: z.number().int(),
});

/** Zod schema for route params containing a UUID `id`. */
const idParamsSchema = z.object({ id: z.string().uuid() });

/** Fastify plugin that registers all course CRUD routes. */
const courseRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    "/courses",
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireCapability(Permission.CourseView),
      ],
      schema: {
        querystring: PaginationParamsSchema,
        security: cookieAuth,
        "x-role": ["Admin", "Teacher"],
        response: { 200: courseListResponseSchema },
      },
    },
    /** List courses with pagination. Returns paginated course items. */
    async (request: any) => {
      const ctx = ensureTargetOrg(getRequestContext(request));
      const { page, pageSize } = PaginationParamsSchema.parse(request.query);
      const repo = createCourseRepo(fastify.db);
      const { items, total } = await repo.listPaginated(ctx, page, pageSize);

      return {
        items: items.map((c) => ({
          id: c.id,
          organizationId: c.organizationId,
          name: c.name,
          code: c.code,
          description: c.description,
          createdAt: c.createdAt.toISOString(),
          updatedAt: c.updatedAt.toISOString(),
        })),
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      };
    },
  );

  fastify.get(
    "/courses/:id",
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireCapability(Permission.CourseView),
      ],
      schema: {
        params: idParamsSchema,
        security: cookieAuth,
        "x-role": ["Admin", "Teacher"],
        response: { 200: courseItemSchema, 404: ErrorResponseSchema },
      },
    },
    /** Get a single course by ID. Returns 404 if not found. */
    async (request: any, reply: any) => {
      const ctx = ensureTargetOrg(getRequestContext(request));
      const { id } = request.params as { id: string };
      const repo = createCourseRepo(fastify.db);
      const course = await repo.findById(ctx, id);
      if (!course) {
        return reply
          .code(404)
          .send(buildErrorResponse(request.id, "RESOURCE_NOT_FOUND"));
      }
      return {
        id: course.id,
        organizationId: course.organizationId,
        name: course.name,
        code: course.code,
        description: course.description,
        createdAt: course.createdAt.toISOString(),
        updatedAt: course.updatedAt.toISOString(),
      };
    },
  );

  fastify.post(
    "/courses",
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireCapability(Permission.CourseCreate),
      ],
      schema: {
        body: CreateCourseRequestSchema,
        security: cookieAuth,
        "x-role": ["Admin", "Teacher"],
        response: { 201: courseItemSchema, 409: ErrorResponseSchema },
      },
    },
    /** Create a new course. Returns 409 if the course code already exists. */
    async (request: any, reply: any) => {
      const ctx = ensureTargetOrg(getRequestContext(request));
      const data = CreateCourseRequestSchema.parse(request.body);
      const repo = createCourseRepo(fastify.db);

      const existing = await repo.list(ctx);
      if (existing.some((c) => c.code === data.code)) {
        return reply.code(409).send(
          buildErrorResponse(request.id, "RESOURCE_CONFLICT", {
            fields: [
              {
                field: "code",
                code: "RESOURCE_CONFLICT",
                message: "课程代码已存在",
              },
            ],
          }),
        );
      }

      const course = await createCourseRepo(fastify.db).create(ctx, {
        name: data.name,
        code: data.code,
        description: data.description,
      });
      recordBestEffortAudit(fastify, request, ctx, {
        action: "course.create",
        targetType: "course",
        targetId: course.id,
      });
      return reply.code(201).send({
        id: course.id,
        organizationId: course.organizationId,
        name: course.name,
        code: course.code,
        description: course.description,
        createdAt: course.createdAt.toISOString(),
        updatedAt: course.updatedAt.toISOString(),
      });
    },
  );

  fastify.patch(
    "/courses/:id",
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireCapability(Permission.CourseUpdate),
      ],
      schema: {
        params: idParamsSchema,
        body: UpdateCourseRequestSchema,
        security: cookieAuth,
        "x-role": ["Admin", "Teacher"],
        response: { 200: courseItemSchema, 404: ErrorResponseSchema },
      },
    },
    /** Update an existing course by ID. Returns 404 if not found. */
    async (request: any, reply: any) => {
      const ctx = ensureTargetOrg(getRequestContext(request));
      const { id } = request.params as { id: string };
      const data = UpdateCourseRequestSchema.parse(request.body);
      const updated = await createCourseRepo(fastify.db).update(
        ctx,
        id,
        data as Record<string, unknown>,
      );
      if (updated) {
        recordBestEffortAudit(fastify, request, ctx, {
          action: "course.update",
          targetType: "course",
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
        name: updated.name,
        code: updated.code,
        description: updated.description,
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
      };
    },
  );

  fastify.delete(
    "/courses/:id",
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireCapability(Permission.CourseDelete),
      ],
      schema: {
        params: idParamsSchema,
        security: cookieAuth,
        "x-role": ["Admin"],
        response: {
          204: z.null(),
          404: ErrorResponseSchema,
          409: ErrorResponseSchema,
        },
      },
    },
    /** Delete a course by ID. Returns 409 if the course still contains questions, 404 if not found. */
    async (request: any, reply: any) => {
      const ctx = ensureTargetOrg(getRequestContext(request));
      const { id } = request.params as { id: string };
      const repo = createCourseRepo(fastify.db);
      const questionCount = await createQuestionRepo(
        fastify.db,
      ).countByCourseId(ctx, id);
      if (questionCount > 0) {
        return reply.code(409).send(
          buildErrorResponse(request.id, "RESOURCE_CONFLICT", {
            fields: [
              {
                field: "courseId",
                code: "RESOURCE_CONFLICT",
                message: "课程下仍有题目，无法删除",
              },
            ],
          }),
        );
      }
      const deleted = await createCourseRepo(fastify.db).delete(ctx, id);
      if (deleted) {
        recordBestEffortAudit(fastify, request, ctx, {
          action: "course.delete",
          targetType: "course",
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
};

export default courseRoutes;
