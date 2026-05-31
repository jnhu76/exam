import { FastifyPluginAsync } from "fastify";
import {
  CreateUserRequestSchema,
  UpdateUserRequestSchema,
} from "@exam/contracts";
import { hashPassword } from "@exam/auth/src/password.js";
import { createDatabase } from "@exam/db/src/database.js";
import { createUserRepo } from "@exam/db/src/repository/userRepo.js";
import type { RequestContext } from "@exam/domain";

function ensureTargetOrg(ctx: RequestContext): RequestContext {
  if (!ctx.targetOrganizationId) {
    return { ...ctx, targetOrganizationId: ctx.organizationId };
  }
  return ctx;
}

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
      const { db } = createDatabase();
      const repo = createUserRepo(db);
      const users = repo.list(ctx);
      return users.map((u) => ({
        id: u.id,
        organizationId: u.organizationId,
        username: u.username,
        name: u.name,
        role: u.role,
        isActive: u.isActive,
        createdAt: u.createdAt.toISOString(),
        updatedAt: u.updatedAt.toISOString(),
      }));
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
      const { db } = createDatabase();
      const repo = createUserRepo(db);
      const passwordHash = await hashPassword(data.password);
      const user = repo.create(ctx, {
        username: data.username,
        passwordHash,
        name: data.name,
        role: data.role,
        isActive: true,
      });
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
      const { db } = createDatabase();
      const repo = createUserRepo(db);
      const updated = repo.update(ctx, id, data as Record<string, unknown>);
      if (!updated) {
        return reply
          .code(404)
          .send({ error: { code: "NOT_FOUND", message: "User not found" } });
      }
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
      const { db } = createDatabase();
      const repo = createUserRepo(db);
      const deleted = repo.delete(ctx, id);
      if (!deleted) {
        return reply
          .code(404)
          .send({ error: { code: "NOT_FOUND", message: "User not found" } });
      }
      return reply.code(204).send();
    },
  );
};

export default userRoutes;
