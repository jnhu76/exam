import { FastifyPluginAsync } from "fastify";
import {
  CreateUserRequestSchema,
  UpdateUserRequestSchema,
} from "@exam/contracts";
import { PaginationParamsSchema } from "@exam/contracts";
import { hashPassword } from "@exam/auth/src/password.js";
import { createUserRepo } from "@exam/db/src/repository/userRepo.js";
import { ensureTargetOrg } from "./helpers.js";
import { recordAudit } from "./audit.js";
import { buildErrorResponse } from "../lib/errorResponse.js";
import { getRuntimeConfig } from "../config/runtimeConfig.js";

const userRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    "/users",
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireRole(["Admin", "SuperAdmin"]),
      ],
    },
    async (request) => {
      const ctx = ensureTargetOrg(request.ctx!);
      const { page, pageSize } = PaginationParamsSchema.parse(request.query);
      const repo = createUserRepo(fastify.db);
      const { items, total } = await repo.listPaginated(ctx, page, pageSize);
      const hideSuperAdmin = getRuntimeConfig().tenancy.mode === "singleTenant";
      const visibleItems = hideSuperAdmin
        ? items.filter((u) => u.role !== "SuperAdmin")
        : items;
      const visibleTotal = hideSuperAdmin
        ? total - (items.length - visibleItems.length)
        : total;

      return {
        items: visibleItems.map((u) => ({
          id: u.id,
          organizationId: u.organizationId,
          username: u.username,
          name: u.name,
          role: u.role,
          isActive: u.isActive,
          createdAt: u.createdAt.toISOString(),
          updatedAt: u.updatedAt.toISOString(),
        })),
        total: visibleTotal,
        page,
        pageSize,
        totalPages: Math.ceil(visibleTotal / pageSize),
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
    async (request, reply) => {
      const ctx = ensureTargetOrg(request.ctx!);
      const data = CreateUserRequestSchema.parse(request.body);
      const repo = createUserRepo(fastify.db);
      const passwordHash = await hashPassword(data.password);
      const user = await repo.createUnique(ctx, {
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
    async (request, reply) => {
      const ctx = ensureTargetOrg(request.ctx!);
      const { id } = request.params as { id: string };
      const data = UpdateUserRequestSchema.parse(request.body);
      const repo = createUserRepo(fastify.db);
      const hideSuperAdmin = getRuntimeConfig().tenancy.mode === "singleTenant";
      if (hideSuperAdmin) {
        const existing = await repo.findByOrganizationAndId(ctx, id);
        if (existing && existing.role === "SuperAdmin") {
          return reply
            .code(404)
            .send(buildErrorResponse(request.id, "RESOURCE_NOT_FOUND"));
        }
      }
      const updated = await repo.update(ctx, id, {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.role !== undefined ? { role: data.role } : {}),
        ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
      });
      if (!updated) {
        return reply
          .code(404)
          .send(buildErrorResponse(request.id, "RESOURCE_NOT_FOUND"));
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
    async (request, reply) => {
      const ctx = ensureTargetOrg(request.ctx!);
      const { id } = request.params as { id: string };
      const repo = createUserRepo(fastify.db);
      const hideSuperAdmin = getRuntimeConfig().tenancy.mode === "singleTenant";
      if (hideSuperAdmin) {
        const existing = await repo.findByOrganizationAndId(ctx, id);
        if (existing && existing.role === "SuperAdmin") {
          return reply
            .code(404)
            .send(buildErrorResponse(request.id, "RESOURCE_NOT_FOUND"));
        }
      }
      const deleted = await repo.delete(ctx, id);
      if (!deleted) {
        return reply
          .code(404)
          .send(buildErrorResponse(request.id, "RESOURCE_NOT_FOUND"));
      }
      recordAudit(fastify, request, ctx, "user.delete", "user", id);
      return reply.code(204).send();
    },
  );
};

export default userRoutes;
