import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  CreateUserRequestSchema,
  UpdateUserRequestSchema,
  ResetPasswordRequestSchema,
  ErrorResponseSchema,
  AssignableRoleSchema,
} from "@exam/contracts";
import { PaginationParamsSchema } from "@exam/contracts";
import { hashPassword } from "@exam/auth/src/password.js";
import { createUserRepo } from "@exam/db/src/repository/userRepo.js";
import { createUserRoleAssignmentRepo } from "@exam/db/src/repository/userRoleAssignmentRepo.js";
import { ValidationError } from "@exam/domain";
import { Permission } from "@exam/authz";
import { ensureTargetOrg, getRequestContext } from "./helpers.js";
import { recordAudit } from "./audit.js";
import { syncUsersRoleFromPrimary } from "../authz/roleSync.js";
import { buildErrorResponse } from "../lib/errorResponse.js";

/** Zod schema for route params containing a UUID `id`. */
const idParamsSchema = z.object({ id: z.string().uuid() });

/** OpenAPI security scheme requiring cookie-based authentication. */
const cookieAuth = [{ cookieAuth: [] }] as const;

/** Zod schema for a single user item in list/detail responses. */
const userItemSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  username: z.string(),
  name: z.string(),
  role: AssignableRoleSchema,
  isActive: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

/** Zod schema for a paginated user list response. */
const userListResponseSchema = z.object({
  items: z.array(userItemSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
  totalPages: z.number().int(),
});

/** Generic success response schema used for mutation endpoints that return only a confirmation. */
const okResponseSchema = z.object({ ok: z.literal(true) });

/** Roles supported in Phase 1 — used to filter the user list to Admin and Candidate only. */
const PHASE1_SUPPORTED_ROLES = ["Admin", "Candidate"] as const;

/**
 * Fastify plugin that registers user management routes.
 *
 * Provides list, create, update, delete, and password-reset endpoints.
 * Gates use capability-based authorization (RBAC-M10-C). All six target
 * permissions (UserView, UserCreate, UserUpdate, UserPasswordReset,
 * UserDelete, and indirectly UserRoleAssign via the assignment surface)
 * are Admin-only in the current permission presets, so the migration from
 * legacy requireRole(["Admin"]) is access-matrix-neutral.
 */
const userRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    "/users",
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireCapability(Permission.UserView),
      ],
      schema: {
        querystring: PaginationParamsSchema,
        security: cookieAuth,
        "x-role": ["Admin"],
        response: { 200: userListResponseSchema },
      },
    },
    /**
     * GET /users — list users with pagination (Admin and Candidate roles only).
     *
     * Returns paginated user records. Only Admin and Candidate roles
     * are included, filtered by PHASE1_SUPPORTED_ROLES.
     */
    async (request) => {
      const ctx = ensureTargetOrg(getRequestContext(request));
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
      preHandler: [
        fastify.authenticate,
        fastify.requireCapability(Permission.UserCreate),
      ],
      schema: {
        body: CreateUserRequestSchema,
        security: cookieAuth,
        "x-role": ["Admin"],
        response: { 201: userItemSchema },
      },
    },
    /**
     * POST /users — create a new user.
     *
     * Hashes the provided password and creates a user with the given role.
     * The username must be unique within the organization.
     */
    async (request, reply) => {
      const ctx = ensureTargetOrg(getRequestContext(request));
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
      // RBAC-M8 sync: seed a primary active assignment mirroring the created
      // role so both stores agree (users.role cache + assignment source).
      const assignmentRepo = createUserRoleAssignmentRepo(fastify.db);
      await assignmentRepo.assign(ctx, {
        userId: user.id,
        role: data.role,
        isPrimary: true,
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
        fastify.requireCapability(Permission.UserUpdate),
      ],
      schema: {
        params: idParamsSchema,
        body: UpdateUserRequestSchema,
        security: cookieAuth,
        "x-role": ["Admin"],
        response: {
          200: userItemSchema,
          400: ErrorResponseSchema,
          404: ErrorResponseSchema,
        },
      },
    },
    /**
     * PATCH /users/:id — update a user's name, role, or active status.
     *
     * Prevents self-deactivation and protects the last active Admin
     * from being disabled or downgraded.
     */
    async (request, reply) => {
      const ctx = ensureTargetOrg(getRequestContext(request));
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
        ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
      });
      if (!updated) {
        return reply
          .code(404)
          .send(buildErrorResponse(request.id, "RESOURCE_NOT_FOUND"));
      }
      // RBAC-M8 sync: when the role changes, mutate the primary active
      // assignment (the source of truth) and re-sync users.role from it so
      // both stores agree. isActive=false deactivates the assignment too.
      if (data.role !== undefined && data.role !== target.role) {
        const assignmentRepo = createUserRoleAssignmentRepo(fastify.db);
        await assignmentRepo.assign(ctx, {
          userId: id,
          role: data.role,
          isPrimary: true,
          // Preserve the user's existing active status when only the role
          // changes; only an explicit isActive=false deactivates. (Review #1:
          // the prior `data.isActive !== false` wrongly re-activated.)
          isActive:
            data.isActive !== undefined ? data.isActive : target.isActive,
        });
        await syncUsersRoleFromPrimary(fastify.db, ctx, id);
      }
      const refreshed = await repo.findByOrganizationAndId(ctx, id);
      recordAudit(fastify, request, ctx, "user.update", "user", id);
      // AUDIT-M2: privilege change gets its own sensitive audit (ADR sec.11.5).
      // Metadata is opaque scalar state only (old/new role) — no PII.
      if (data.role !== undefined && data.role !== target.role) {
        recordAudit(fastify, request, ctx, "user.role_changed", "user", id, {
          oldRole: target.role,
          newRole: data.role,
        });
      }
      const finalUser = refreshed ?? updated;
      return {
        id: finalUser.id,
        organizationId: finalUser.organizationId,
        username: finalUser.username,
        name: finalUser.name,
        role: finalUser.role,
        isActive: finalUser.isActive,
        createdAt: finalUser.createdAt.toISOString(),
        updatedAt: finalUser.updatedAt.toISOString(),
      };
    },
  );

  fastify.post(
    "/users/:id/reset-password",
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireCapability(Permission.UserPasswordReset),
      ],
      schema: {
        params: idParamsSchema,
        body: ResetPasswordRequestSchema,
        security: cookieAuth,
        "x-role": ["Admin"],
        response: {
          200: okResponseSchema,
          400: ErrorResponseSchema,
          404: ErrorResponseSchema,
        },
      },
    },
    /**
     * POST /users/:id/reset-password — reset a candidate user's password.
     *
     * Only targets users with the Candidate role. Admin password
     * resets are not allowed through this endpoint.
     */
    async (request, reply) => {
      const ctx = ensureTargetOrg(getRequestContext(request));
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
      preHandler: [
        fastify.authenticate,
        fastify.requireCapability(Permission.UserDelete),
      ],
      schema: {
        params: idParamsSchema,
        security: cookieAuth,
        "x-role": ["Admin"],
        response: { 204: z.null(), 404: ErrorResponseSchema },
      },
    },
    /**
     * DELETE /users/:id — permanently delete a user.
     *
     * Removes the user record from the organization.
     * Returns 404 if the user does not exist.
     */
    async (request, reply) => {
      const ctx = ensureTargetOrg(getRequestContext(request));
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
