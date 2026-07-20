import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  AssignRoleRequestSchema,
  PatchRoleAssignmentRequestSchema,
  UserRoleAssignmentSchema,
  AssignableRoleSchema,
  ErrorResponseSchema,
} from "@exam/contracts";
import { ROLE_PRESETS, Role, type RoleKey, Permission } from "@exam/authz";
import type { RolePreset } from "@exam/authz";
import { createUserRoleAssignmentRepo } from "@exam/db/src/repository/userRoleAssignmentRepo.js";
import { createUserRepo } from "@exam/db/src/repository/userRepo.js";
import { NotFoundError } from "@exam/domain";
import { ensureTargetOrg, getRequestContext } from "./helpers.js";
import { recordAudit } from "./audit.js";
import { syncUsersRoleFromPrimary } from "../authz/roleSync.js";
import { mutateWithEffectiveAdminPostcondition } from "../authz/adminInvariant.js";

/** OpenAPI security definition for cookie-based authentication. */
const cookieAuth = [{ cookieAuth: [] }] as const;

/** Zod schema for route params containing a UUID `id`. */
const idParamsSchema = z.object({ id: z.string().uuid() });

/** Zod schema for route params containing a UUID `userId` + `assignmentId`. */
const assignmentParamsSchema = z.object({ assignmentId: z.string().uuid() });

/** Response schema for the assignable-roles list. */
const assignableRoleItemSchema = z.object({
  key: AssignableRoleSchema,
  label: z.string(),
  purpose: z.string(),
});
const assignableRolesResponseSchema = z.object({
  items: z.array(assignableRoleItemSchema),
});

/**
 * Fastify plugin registering role-assignment routes (RBAC-M8).
 *
 * Gates use capability-based authorization (RBAC-M10-C). All four mutating /
 * management routes use Permission.UserRoleAssign; the per-user list route
 * uses Permission.UserView. Both permissions are Admin-only in the current
 * permission presets, so the migration from legacy requireRole(["Admin"]) is
 * access-matrix-neutral.
 *
 * These routes keep `users.role` synced to the primary active assignment
 * (ADR migration cache). Runtime authority remains users.role until M10-E.
 */
const roleAssignmentRoutes: FastifyPluginAsync = async (fastify) => {
  // ── GET /roles/assignable ───────────────────────────────────────
  fastify.get(
    "/roles/assignable",
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireCapability(Permission.UserRoleAssign),
      ],
      schema: {
        security: cookieAuth,
        "x-role": ["Admin"],
        response: { 200: assignableRolesResponseSchema },
      },
    },
    async () => {
      // Source: the @exam/authz ROLE_PRESETS (assignable === true).
      const items = (Object.values(ROLE_PRESETS) as RolePreset[])
        .filter((p) => p.assignable)
        .map((p) => ({ key: p.key, label: p.label, purpose: p.purpose }));
      return { items };
    },
  );

  // ── GET /users/:id/role-assignments ─────────────────────────────
  fastify.get(
    "/users/:id/role-assignments",
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireCapability(Permission.UserView),
      ],
      schema: {
        params: idParamsSchema,
        security: cookieAuth,
        "x-role": ["Admin"],
        response: {
          200: z.object({ items: z.array(UserRoleAssignmentSchema) }),
          404: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const ctx = ensureTargetOrg(getRequestContext(request));
      const { id } = request.params as { id: string };
      const userRepo = createUserRepo(fastify.db);
      const target = await userRepo.findByOrganizationAndId(ctx, id);
      if (!target) {
        return reply
          .code(404)
          .send({ requestId: request.id, error: "RESOURCE_NOT_FOUND" });
      }
      const assignmentRepo = createUserRoleAssignmentRepo(fastify.db);
      const rows = await assignmentRepo.listForUser(ctx, id);
      return {
        items: rows.map((r) => ({
          id: r.id,
          userId: r.userId,
          role: r.role,
          isPrimary: r.isPrimary,
          isActive: r.isActive,
        })),
      };
    },
  );

  // ── POST /users/:id/role-assignments ────────────────────────────
  fastify.post(
    "/users/:id/role-assignments",
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireCapability(Permission.UserRoleAssign),
      ],
      schema: {
        params: idParamsSchema,
        body: AssignRoleRequestSchema,
        security: cookieAuth,
        "x-role": ["Admin"],
        response: { 201: UserRoleAssignmentSchema, 404: ErrorResponseSchema },
      },
    },
    async (request, reply) => {
      const ctx = ensureTargetOrg(getRequestContext(request));
      const { id } = request.params as { id: string };
      const data = AssignRoleRequestSchema.parse(request.body);
      const userRepo = createUserRepo(fastify.db);
      const target = await userRepo.findByOrganizationAndId(ctx, id);
      if (!target) {
        return reply
          .code(404)
          .send({ requestId: request.id, error: "RESOURCE_NOT_FOUND" });
      }
      const assignmentRepo = createUserRoleAssignmentRepo(fastify.db);
      const created = await assignmentRepo.assign(ctx, {
        userId: id,
        role: data.role,
        isPrimary: data.isPrimary ?? false,
        isActive: true,
      });
      // RBAC-M8 sync: a new primary assignment must update users.role cache.
      // H6 fix: secondary assignment creates also emit a user.role_changed
      // audit (privilege change tracking, ADR §7.2).
      if (created.isPrimary) {
        const prevRole = target.role;
        await syncUsersRoleFromPrimary(fastify.db, ctx, id);
        recordAudit(fastify, request, ctx, "user.role_changed", "user", id, {
          oldRole: prevRole,
          newRole: data.role,
        });
      } else {
        recordAudit(fastify, request, ctx, "user.role_changed", "user", id, {
          assignmentAdded: true,
          role: data.role,
          isPrimary: false,
        });
      }
      return reply.code(201).send({
        id: created.id,
        userId: created.userId,
        role: created.role,
        isPrimary: created.isPrimary,
        isActive: created.isActive,
      });
    },
  );

  // ── PATCH /role-assignments/:assignmentId ───────────────────────
  fastify.patch(
    "/role-assignments/:assignmentId",
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireCapability(Permission.UserRoleAssign),
      ],
      schema: {
        params: assignmentParamsSchema,
        body: PatchRoleAssignmentRequestSchema,
        security: cookieAuth,
        "x-role": ["Admin"],
        response: { 200: UserRoleAssignmentSchema, 404: ErrorResponseSchema },
      },
    },
    async (request, reply) => {
      const ctx = ensureTargetOrg(getRequestContext(request));
      const { assignmentId } = request.params as { assignmentId: string };
      const data = PatchRoleAssignmentRequestSchema.parse(request.body);
      const assignmentRepo = createUserRoleAssignmentRepo(fastify.db);

      if (data.isPrimary === true) {
        const promoted = await assignmentRepo.setPrimary(ctx, assignmentId);
        if (!promoted) throw new NotFoundError("role assignment");
        // Sync users.role to the newly-promoted primary role.
        await syncUsersRoleFromPrimary(fastify.db, ctx, promoted.userId);
        recordAudit(
          fastify,
          request,
          ctx,
          "user.role_changed",
          "user",
          promoted.userId,
          { newRole: promoted.role },
        );
        return {
          id: promoted.id,
          userId: promoted.userId,
          role: promoted.role,
          isPrimary: promoted.isPrimary,
          isActive: promoted.isActive,
        };
      }
      if (data.isActive === false) {
        const targetAssignment = await assignmentRepo.findById(
          ctx,
          assignmentId,
        );
        if (!targetAssignment) throw new NotFoundError("role assignment");

        const deactivated = await mutateWithEffectiveAdminPostcondition(
          fastify.db,
          ctx,
          async (tx) => {
            const txRepo = createUserRoleAssignmentRepo(tx);
            const result = await txRepo.deactivateWithinTransaction(
              tx,
              ctx.organizationId,
              assignmentId,
            );
            if (result?.isPrimary) {
              await syncUsersRoleFromPrimary(tx, ctx, result.userId);
            }
            return result;
          },
        );

        if (deactivated?.isPrimary) {
          const userRepo = createUserRepo(fastify.db);
          const user = await userRepo.findById(ctx, deactivated.userId);
          recordAudit(
            fastify,
            request,
            ctx,
            "user.role_changed",
            "user",
            deactivated.userId,
            {
              assignmentDeactivated: true,
              oldPrimaryRole: deactivated.role,
              resultingPrimaryRole: user?.role ?? null,
              assignmentId: deactivated.id,
            },
          );
        } else {
          recordAudit(
            fastify,
            request,
            ctx,
            "user.role_changed",
            "user",
            deactivated!.userId,
            {
              assignmentDeactivated: true,
              role: deactivated!.role,
              isPrimary: false,
              assignmentId: deactivated!.id,
            },
          );
        }
        return {
          id: deactivated!.id,
          userId: deactivated!.userId,
          role: deactivated!.role,
          isPrimary: deactivated!.isPrimary,
          isActive: deactivated!.isActive,
        };
      }
      // No-op patch (neither isPrimary nor isActive=false given): return as-is.
      throw new NotFoundError("role assignment");
    },
  );

  // ── DELETE /role-assignments/:assignmentId ──────────────────────
  fastify.delete(
    "/role-assignments/:assignmentId",
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireCapability(Permission.UserRoleAssign),
      ],
      schema: {
        params: assignmentParamsSchema,
        security: cookieAuth,
        "x-role": ["Admin"],
        response: { 204: z.null(), 404: ErrorResponseSchema },
      },
    },
    async (request, reply) => {
      const ctx = ensureTargetOrg(getRequestContext(request));
      const { assignmentId } = request.params as { assignmentId: string };
      const assignmentRepo = createUserRoleAssignmentRepo(fastify.db);

      const targetAssignment = await assignmentRepo.findById(ctx, assignmentId);
      if (!targetAssignment) throw new NotFoundError("role assignment");

      const removed = await mutateWithEffectiveAdminPostcondition(
        fastify.db,
        ctx,
        async (tx) => {
          const txRepo = createUserRoleAssignmentRepo(tx);
          const result = await txRepo.removeWithinTransaction(
            tx,
            ctx.organizationId,
            assignmentId,
          );
          if (result?.isPrimary) {
            await syncUsersRoleFromPrimary(tx, ctx, result.userId);
          }
          return result;
        },
      );

      recordAudit(
        fastify,
        request,
        ctx,
        "user.role_changed",
        "role_assignment",
        assignmentId,
        { removed: true, affectedUserId: removed!.userId },
      );
      return reply.code(204).send();
    },
  );
};

export default roleAssignmentRoutes;
