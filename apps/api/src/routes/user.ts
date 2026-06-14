import { FastifyPluginAsync } from "fastify";
import {
  CreateUserRequestSchema,
  UpdateUserRequestSchema,
  ResetPasswordRequestSchema,
} from "@exam/contracts";
import { PaginationParamsSchema } from "@exam/contracts";
import { hashPassword } from "@exam/auth/src/password.js";
import { createUserRepo } from "@exam/db/src/repository/userRepo.js";
import { ValidationError } from "@exam/domain";
import { ensureTargetOrg } from "./helpers.js";
import { recordAudit } from "./audit.js";
import { buildErrorResponse } from "../lib/errorResponse.js";

const PHASE1_SUPPORTED_ROLES = ["Admin", "Candidate"] as const;

const userRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    "/users",
    {
      preHandler: [fastify.authenticate, fastify.requireRole(["Admin"])],
    },
    async (request) => {
      const ctx = ensureTargetOrg(request.ctx!);
      const { page, pageSize } = PaginationParamsSchema.parse(request.query);
      const repo = createUserRepo(fastify.db);
      const { items, total } = await repo.listPaginatedByRoles(
        ctx,
        PHASE1_SUPPORTED_ROLES,
        page,
        pageSize,
      );

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
      preHandler: [fastify.authenticate, fastify.requireRole(["Admin"])],
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
      preHandler: [fastify.authenticate, fastify.requireRole(["Admin"])],
    },
    async (request, reply) => {
      const ctx = ensureTargetOrg(request.ctx!);
      const { id } = request.params as { id: string };
      const data = UpdateUserRequestSchema.parse(request.body);
      const repo = createUserRepo(fastify.db);

      const isSelf = id === ctx.actorId;
      if (isSelf && data.isActive === false) {
        throw new ValidationError("不能停用自己的账号", {
          reason: "CANNOT_DISABLE_SELF",
        });
      }

      const target = await repo.findByOrganizationAndId(ctx, id);
      if (!target) {
        return reply
          .code(404)
          .send(buildErrorResponse(request.id, "RESOURCE_NOT_FOUND"));
      }

      const willDisableAdmin =
        target.role === "Admin" &&
        target.isActive &&
        ((data.isActive !== undefined && data.isActive === false) ||
          (data.role !== undefined && data.role !== "Admin"));
      if (willDisableAdmin) {
        const activeAdminCount = await repo.countActiveByRole(ctx, "Admin");
        if (activeAdminCount <= 1) {
          throw new ValidationError("不能停用或降级最后一位活跃管理员", {
            reason: "LAST_ACTIVE_ADMIN",
          });
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

  fastify.post(
    "/users/:id/reset-password",
    {
      preHandler: [fastify.authenticate, fastify.requireRole(["Admin"])],
    },
    async (request, reply) => {
      const ctx = ensureTargetOrg(request.ctx!);
      const { id } = request.params as { id: string };
      const data = ResetPasswordRequestSchema.parse(request.body);
      const repo = createUserRepo(fastify.db);

      const target = await repo.findByOrganizationAndId(ctx, id);
      if (!target) {
        return reply
          .code(404)
          .send(buildErrorResponse(request.id, "RESOURCE_NOT_FOUND"));
      }

      if (target.role !== "Candidate") {
        return reply
          .code(400)
          .send(
            buildErrorResponse(
              request.id,
              "PASSWORD_RESET_TARGET_ROLE_NOT_ALLOWED",
              { targetRole: target.role },
            ),
          );
      }

      const newHash = await hashPassword(data.newPassword);
      const updated = await repo.update(ctx, id, { passwordHash: newHash });
      if (!updated) {
        return reply
          .code(404)
          .send(buildErrorResponse(request.id, "RESOURCE_NOT_FOUND"));
      }
      recordAudit(
        fastify,
        request,
        ctx,
        "candidate.password_reset",
        "user",
        id,
        { username: target.username },
      );
      return { ok: true as const };
    },
  );

  fastify.delete(
    "/users/:id",
    {
      preHandler: [fastify.authenticate, fastify.requireRole(["Admin"])],
    },
    async (request, reply) => {
      const ctx = ensureTargetOrg(request.ctx!);
      const { id } = request.params as { id: string };
      const repo = createUserRepo(fastify.db);
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
