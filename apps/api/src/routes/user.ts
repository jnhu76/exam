import { FastifyPluginAsync } from "fastify";
import {
  CreateUserRequestSchema,
  UpdateUserRequestSchema,
} from "@exam/contracts";
import { PaginationParamsSchema } from "@exam/contracts";
import { hashPassword } from "@exam/auth/src/password.js";
import { createUserRepo } from "@exam/db/src/repository/userRepo.js";
import type { RequestContext } from "@exam/domain";
import { ensureTargetOrg } from "./helpers.js";
import { recordAudit } from "./audit.js";

const userRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    "/users",
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireRole(["Admin", "SuperAdmin"]),
      ],
    },
    async (request: any) => {
      const ctx = ensureTargetOrg(request["ctx"] as RequestContext);
      const { page, pageSize } = PaginationParamsSchema.parse(request.query);
      const repo = createUserRepo(fastify.db);
      const { items, total } = repo.listPaginated(ctx, page, pageSize);

      return {
        items: items.map((u) => ({
          id: u.id,
          organizationId: u.organizationId,
          username: u.username,
          name: u.name,
          role: u.role,
          isActive: u.isActive,
          createdAt: u.createdAt.toISOString(),
          updatedAt: u.updatedAt.toISOString(),
        })),
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      };
    },
  );

  fastify.post(
    "/users",
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireRole(["Admin", "SuperAdmin"]),
      ],
    },
    async (request: any, reply: any) => {
      const ctx = ensureTargetOrg(request["ctx"] as RequestContext);
      const data = CreateUserRequestSchema.parse(request.body);
      const repo = createUserRepo(fastify.db);
      const passwordHash = await hashPassword(data.password);
      const user = repo.create(ctx, {
        username: data.username,
        passwordHash,
        name: data.name,
        role: data.role,
        isActive: true,
      });
      recordAudit(fastify, request, ctx, "user.create", "user", user.id);
      return reply.code(201).send({
        id: user.id,
        organizationId: user.organizationId,
        username: user.username,
        name: user.name,
        role: user.role,
        isActive: user.isActive,
        createdAt: user.createdAt.toISOString(),
        updatedAt: user.updatedAt.toISOString(),
      });
    },
  );

  fastify.patch(
    "/users/:id",
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireRole(["Admin", "SuperAdmin"]),
      ],
    },
    async (request: any, reply: any) => {
      const ctx = ensureTargetOrg(request["ctx"] as RequestContext);
      const { id } = request.params as { id: string };
      const data = UpdateUserRequestSchema.parse(request.body);
      const repo = createUserRepo(fastify.db);
      const updated = repo.update(ctx, id, data as Record<string, unknown>);
      if (!updated) {
        return reply
          .code(404)
          .send({ error: { code: "NOT_FOUND", message: "User not found" } });
      }
      recordAudit(fastify, request, ctx, "user.update", "user", id);
      return {
        id: updated.id,
        organizationId: updated.organizationId,
        username: updated.username,
        name: updated.name,
        role: updated.role,
        isActive: updated.isActive,
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
      };
    },
  );

  fastify.delete(
    "/users/:id",
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireRole(["Admin", "SuperAdmin"]),
      ],
    },
    async (request: any, reply: any) => {
      const ctx = ensureTargetOrg(request["ctx"] as RequestContext);
      const { id } = request.params as { id: string };
      const repo = createUserRepo(fastify.db);
      const deleted = repo.delete(ctx, id);
      if (!deleted) {
        return reply
          .code(404)
          .send({ error: { code: "NOT_FOUND", message: "User not found" } });
      }
      recordAudit(fastify, request, ctx, "user.delete", "user", id);
      return reply.code(204).send();
    },
  );
};

export default userRoutes;
