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
import { recordAtomicHttpAudit } from "../audit/auditWriter.js";
import { syncUsersRoleFromPrimary } from "../authz/roleSync.js";
import { mutateWithEffectiveAdminPostcondition } from "../authz/adminInvariant.js";
import { mutateWithAuthorityInvariants } from "../authz/adminMaintainerExclusion.js";

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
      // P7-E2A (ADR-017 D14): assignment creation runs inside the canonical
      // authority-mutation seam — same org advisory lock + Admin↔Maintainer
      // exclusion post-condition. A secondary Maintainer assignment for an
      // Admin actor (or vice versa) is rejected before commit.
      const created = await mutateWithAuthorityInvariants(
        fastify.db,
        ctx,
        async (tx) => {
          const assignment = await createUserRoleAssignmentRepo(
            tx,
          ).assignWithinTransaction(tx, ctx, {
            userId: id,
            role: data.role,
            isPrimary: data.isPrimary ?? false,
            isActive: true,
          });
          if (assignment.isPrimary) {
            await syncUsersRoleFromPrimary(tx, ctx, id);
          }
          await recordAtomicHttpAudit(tx, request, ctx, {
            action: "user.role_changed",
            targetType: "user",
            targetId: id,
            metadata: assignment.isPrimary
              ? { oldRole: target.role, newRole: data.role }
              : {
                  assignmentAdded: true,
                  role: data.role,
                  isPrimary: false,
                },
          });
          return assignment;
        },
      );
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
        // P7-E2A (ADR-017 D14): promoting a secondary assignment to primary
        // changes effective authority — run inside the authority-mutation
        // seam so Admin↔Maintainer exclusion is enforced transactionally.
        const promoted = await mutateWithAuthorityInvariants(
          fastify.db,
          ctx,
          async (tx) => {
            const value = await createUserRoleAssignmentRepo(
              tx,
            ).setPrimaryWithinTransaction(tx, ctx, assignmentId);
            if (!value) return null;
            await syncUsersRoleFromPrimary(tx, ctx, value.userId);
            await recordAtomicHttpAudit(tx, request, ctx, {
              action: "user.role_changed",
              targetType: "user",
              targetId: value.userId,
              metadata: { newRole: value.role },
            });
            return value;
          },
        );
        if (!promoted) throw new NotFoundError("role assignment");
        return {
          id: promoted.id,
          userId: promoted.userId,
          role: promoted.role,
          isPrimary: promoted.isPrimary,
          isActive: promoted.isActive,
        };
      }
      if (data.isActive === true) {
        // P7-E2A (ADR-017 D14): reactivating a deactivated assignment can
        // make an Admin/Maintainer authority effective again — run inside
        // the authority-mutation seam (org advisory lock + exclusion
        // post-condition). A reactivated primary restores that role as the
        // user's active primary authority (users.role re-synced).
        const activated = await mutateWithAuthorityInvariants(
          fastify.db,
          ctx,
          async (tx) => {
            const result = await createUserRoleAssignmentRepo(
              tx,
            ).activateWithinTransaction(tx, ctx, assignmentId);
            if (!result) return null;
            const { row: value, changed } = result;
            // Audit/sync truthfulness (P7-E review P2-1): a no-op reactivation
            // of an already-active assignment must NOT re-sync users.role (an
            // unconditional UPDATE that bumps updatedAt with no real change)
            // and must NOT emit role_changed (a state change that never
            // happened). Only a genuine inactive→active transition is.
            if (changed && value.isPrimary) {
              await syncUsersRoleFromPrimary(tx, ctx, value.userId);
            }
            if (changed) {
              await recordAtomicHttpAudit(tx, request, ctx, {
                action: "user.role_changed",
                targetType: "user",
                targetId: value.userId,
                metadata: {
                  assignmentActivated: true,
                  role: value.role,
                  isPrimary: value.isPrimary,
                  assignmentId: value.id,
                },
              });
            }
            return value;
          },
        );
        if (!activated) throw new NotFoundError("role assignment");
        return {
          id: activated.id,
          userId: activated.userId,
          role: activated.role,
          isPrimary: activated.isPrimary,
          isActive: activated.isActive,
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
              ctx,
              assignmentId,
            );
            if (result?.isPrimary) {
              await syncUsersRoleFromPrimary(tx, ctx, result.userId);
            }
            if (result) {
              const user = result.isPrimary
                ? await createUserRepo(tx).findById(ctx, result.userId)
                : null;
              await recordAtomicHttpAudit(tx, request, ctx, {
                action: "user.role_changed",
                targetType: "user",
                targetId: result.userId,
                metadata: result.isPrimary
                  ? {
                      assignmentDeactivated: true,
                      oldPrimaryRole: result.role,
                      resultingPrimaryRole: user?.role ?? null,
                      assignmentId: result.id,
                    }
                  : {
                      assignmentDeactivated: true,
                      role: result.role,
                      isPrimary: false,
                      assignmentId: result.id,
                    },
              });
            }
            return result;
          },
        );
        return {
          id: deactivated!.id,
          userId: deactivated!.userId,
          role: deactivated!.role,
          isPrimary: deactivated!.isPrimary,
          isActive: deactivated!.isActive,
        };
      }
      // Unreachable in practice: PatchRoleAssignmentRequestSchema (XOR
      // command contract, P7-E review P2-1) rejects any payload that does not
      // carry exactly one of { isPrimary: true } / { isActive: true } /
      // { isActive: false } with 400 before the handler runs. This guard only
      // catches a future contract regression where a payload slips through.
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

      await mutateWithEffectiveAdminPostcondition(
        fastify.db,
        ctx,
        async (tx) => {
          const txRepo = createUserRoleAssignmentRepo(tx);
          const result = await txRepo.removeWithinTransaction(
            tx,
            ctx,
            assignmentId,
          );
          if (result?.isPrimary) {
            await syncUsersRoleFromPrimary(tx, ctx, result.userId);
          }
          if (result) {
            await recordAtomicHttpAudit(tx, request, ctx, {
              action: "user.role_changed",
              targetType: "role_assignment",
              targetId: assignmentId,
              metadata: { removed: true, affectedUserId: result.userId },
            });
          }
          return result;
        },
      );
      return reply.code(204).send();
    },
  );
};

export default roleAssignmentRoutes;
