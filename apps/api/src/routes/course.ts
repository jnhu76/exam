import { FastifyPluginAsync } from "fastify";
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

const courseRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    "/courses",
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireRole(["Admin", "SuperAdmin", "Teacher"]),
      ],
    },
    async (request: any) => {
      const ctx = ensureTargetOrg(request["ctx"] as RequestContext);
      const { page, pageSize } = PaginationParamsSchema.parse(request.query);
      const repo = createCourseRepo(fastify.db);
      const { items, total } = repo.listPaginated(ctx, page, pageSize);

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
        fastify.requireRole(["Admin", "SuperAdmin", "Teacher"]),
      ],
    },
    async (request: any, reply: any) => {
      const ctx = ensureTargetOrg(request["ctx"] as RequestContext);
      const { id } = request.params as { id: string };
      const repo = createCourseRepo(fastify.db);
      const course = repo.findById(ctx, id);
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
      preHandler: [
        fastify.authenticate,
        fastify.requireRole(["Admin", "SuperAdmin", "Teacher"]),
      ],
    },
    async (request: any, reply: any) => {
      const ctx = ensureTargetOrg(request["ctx"] as RequestContext);
      const data = CreateCourseRequestSchema.parse(request.body);
      const repo = createCourseRepo(fastify.db);

      const existing = repo.list(ctx);
      if (existing.some((c) => c.code === data.code)) {
        return reply.code(409).send({
          error: {
            code: "DUPLICATE",
            message: "Course code already exists",
          },
        });
      }

      const course = repo.create(ctx, {
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
      preHandler: [
        fastify.authenticate,
        fastify.requireRole(["Admin", "SuperAdmin", "Teacher"]),
      ],
    },
    async (request: any, reply: any) => {
      const ctx = ensureTargetOrg(request["ctx"] as RequestContext);
      const { id } = request.params as { id: string };
      const data = UpdateCourseRequestSchema.parse(request.body);
      const repo = createCourseRepo(fastify.db);
      const updated = repo.update(ctx, id, data as Record<string, unknown>);
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
      preHandler: [
        fastify.authenticate,
        fastify.requireRole(["Admin", "SuperAdmin", "Teacher"]),
      ],
    },
    async (request: any, reply: any) => {
      const ctx = ensureTargetOrg(request["ctx"] as RequestContext);
      const { id } = request.params as { id: string };
      const repo = createCourseRepo(fastify.db);
      if (
        createQuestionRepo(fastify.db)
          .list(ctx)
          .some((q) => q.courseId === id)
      ) {
        return reply.code(409).send({
          error: {
            code: "CONFLICT",
            message: "Course still contains questions",
          },
        });
      }
      const deleted = repo.delete(ctx, id);
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
