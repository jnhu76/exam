import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  CreateCourseRequestSchema,
  UpdateCourseRequestSchema,
  PaginationParamsSchema,
} from "@exam/contracts";
import { createCourseRepo } from "@exam/db/src/repository/courseRepo.js";
import { createQuestionRepo } from "@exam/db/src/repository/questionRepo.js";
import type { RequestContext } from "@exam/domain";
import { ensureTargetOrg } from "./helpers.js";
import { recordAudit } from "./audit.js";

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
      preHandler: [fastify.authenticate, fastify.requireRole(["Admin"])],
      schema: {
        querystring: PaginationParamsSchema,
        security: cookieAuth,
        "x-role": ["Admin"],
        response: { 200: courseListResponseSchema },
      },
    },
    /** List courses with pagination. Returns paginated course items. */
    async (request: any) => {
      const ctx = ensureTargetOrg(request["ctx"] as RequestContext);
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
      preHandler: [fastify.authenticate, fastify.requireRole(["Admin"])],
      schema: {
        params: idParamsSchema,
        security: cookieAuth,
        "x-role": ["Admin"],
        response: { 200: courseItemSchema },
      },
    },
    /** Get a single course by ID. Returns 404 if not found. */
    async (request: any, reply: any) => {
      const ctx = ensureTargetOrg(request["ctx"] as RequestContext);
      const { id } = request.params as { id: string };
      const repo = createCourseRepo(fastify.db);
      const course = await repo.findById(ctx, id);
      if (!course) {
        return reply
          .code(404)
          .send({ error: { code: "NOT_FOUND", message: "Course not found" } });
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
      preHandler: [fastify.authenticate, fastify.requireRole(["Admin"])],
      schema: {
        body: CreateCourseRequestSchema,
        security: cookieAuth,
        "x-role": ["Admin"],
        response: { 201: courseItemSchema },
      },
    },
    /** Create a new course. Returns 409 if the course code already exists. */
    async (request: any, reply: any) => {
      const ctx = ensureTargetOrg(request["ctx"] as RequestContext);
      const data = CreateCourseRequestSchema.parse(request.body);
      const repo = createCourseRepo(fastify.db);

      const existing = await repo.list(ctx);
      if (existing.some((c) => c.code === data.code)) {
        return reply.code(409).send({
          error: {
            code: "DUPLICATE",
            message: "Course code already exists",
          },
        });
      }

      const course = await repo.create(ctx, {
        name: data.name,
        code: data.code,
        description: data.description,
      });
      recordAudit(fastify, request, ctx, "course.create", "course", course.id);
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
      preHandler: [fastify.authenticate, fastify.requireRole(["Admin"])],
      schema: {
        params: idParamsSchema,
        body: UpdateCourseRequestSchema,
        security: cookieAuth,
        "x-role": ["Admin"],
        response: { 200: courseItemSchema },
      },
    },
    /** Update an existing course by ID. Returns 404 if not found. */
    async (request: any, reply: any) => {
      const ctx = ensureTargetOrg(request["ctx"] as RequestContext);
      const { id } = request.params as { id: string };
      const data = UpdateCourseRequestSchema.parse(request.body);
      const repo = createCourseRepo(fastify.db);
      const updated = await repo.update(
        ctx,
        id,
        data as Record<string, unknown>,
      );
      if (!updated) {
        return reply
          .code(404)
          .send({ error: { code: "NOT_FOUND", message: "Course not found" } });
      }
      recordAudit(fastify, request, ctx, "course.update", "course", id);
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
      preHandler: [fastify.authenticate, fastify.requireRole(["Admin"])],
      schema: {
        params: idParamsSchema,
        security: cookieAuth,
        "x-role": ["Admin"],
        response: {
          204: z.null(),
        },
      },
    },
    /** Delete a course by ID. Returns 409 if the course still contains questions, 404 if not found. */
    async (request: any, reply: any) => {
      const ctx = ensureTargetOrg(request["ctx"] as RequestContext);
      const { id } = request.params as { id: string };
      const repo = createCourseRepo(fastify.db);
      const questions = await createQuestionRepo(fastify.db).list(ctx);
      if (questions.some((q) => q.courseId === id)) {
        return reply.code(409).send({
          error: {
            code: "CONFLICT",
            message: "Course still contains questions",
          },
        });
      }
      const deleted = await repo.delete(ctx, id);
      if (!deleted) {
        return reply
          .code(404)
          .send({ error: { code: "NOT_FOUND", message: "Course not found" } });
      }
      recordAudit(fastify, request, ctx, "course.delete", "course", id);
      return reply.code(204).send();
    },
  );
};

export default courseRoutes;
