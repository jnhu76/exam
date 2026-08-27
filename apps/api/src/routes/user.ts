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
import { createCandidateRepo } from "@exam/db/src/repository/candidateRepo.js";
import { executeInTransaction } from "@exam/db/src/types.js";
import { ValidationError } from "@exam/domain";
import { Permission } from "@exam/authz";
import { ensureTargetOrg, getRequestContext } from "./helpers.js";
import {
  recordAtomicHttpAudit,
  recordBestEffortAudit,
} from "../audit/auditWriter.js";
import { syncUsersRoleFromPrimary } from "../authz/roleSync.js";
import { mutateWithEffectiveAdminPostcondition } from "../authz/adminInvariant.js";
import { mutateWithAuthorityInvariants } from "../authz/adminMaintainerExclusion.js";
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
  email: z.string().email().nullable(),
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

/**
 * Staff-management list contract (GET /users). P7-RBAC-REMEDIATION F-03: the
 * prior hardcoded `PHASE1_SUPPORTED_ROLES = ["Admin","Candidate","Maintainer"]`
 * subset made Teacher/Proctor/Grader users invisible in the admin list (created
 * but unmanageable via the UI), and listing by `users.role` alone let candidate
 * volume crowd staff out of pagination. The list is now sourced from
 * `listStaffPaginated` (repository level): staff membership = an ACTIVE
 * assignment with any of the six assignable roles except Candidate (so
 * Candidate-primary + staff-secondary users stay visible), OR a stale
 * staff-valued `users.role` compatibility cache (zero-primary fallback, F-06 —
 * a staff account never vanishes from management). `users.role` never widens
 * authority (authority = the union of active assignment presets); `System` is
 * non-assignable and `SuperAdmin` is not defined, so neither can match.
 *
 * Fastify plugin that registers user management routes (list, create, update,
 * delete, password-reset). Gates use capability-based authorization
 * (RBAC-M10-C). All six target permissions (UserView, UserCreate, UserUpdate,
 * UserPasswordReset, UserDelete, and indirectly UserRoleAssign via the
 * assignment surface) are Admin-only in the current permission presets, so the
 * migration from legacy requireRole(["Admin"]) is access-matrix-neutral.
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
     * GET /users — list staff users with pagination (assignment-aware).
     *
     * Staff membership (repository-level, BEFORE pagination): an ACTIVE
     * assignment with any assignable role except Candidate, or a stale
     * staff-valued `users.role` cache (F-06 zero-primary fallback). The
     * frontend renders the list as-is — no post-filter, so Candidate-only
     * users can never crowd staff off a page (F-03).
     */
    async (request) => {
      const ctx = ensureTargetOrg(getRequestContext(request));
      const { page, pageSize } = PaginationParamsSchema.parse(request.query);
      const repo = createUserRepo(fastify.db);
      const { items, total } = await repo.listStaffPaginated(
        ctx,
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
          email: u.email ?? null,
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
      const passwordHash = await hashPassword(data.password);
      // RBAC-M10-E: create the user AND its primary active assignment in ONE
      // transaction. A crash between the two writes previously left a user
      // with no authority row, which the M10-E flip would lock out. Both
      // writes succeed atomically or roll back together (P0-2 / E19).
      // P7-E2A (ADR-017 D14): user creation writes a PRIMARY active
      // assignment — run inside the canonical authority-mutation seam so
      // Admin↔Maintainer exclusion is enforced transactionally (creating a
      // Maintainer for an actor that already holds active Admin, or an Admin
      // for an actor holding active Maintainer, is rejected).
      const user = await mutateWithAuthorityInvariants(
        fastify.db,
        ctx,
        async (tx) => {
          const created = await createUserRepo(tx).createUnique(ctx, {
            username: data.username,
            passwordHash,
            name: data.name,
            role: data.role,
            isActive: true,
            // P5-N1 §13: optional recipient email; contract normalizes + maps
            // blank to undefined, so we store null when absent.
            email: data.email ?? null,
          });
          await createUserRoleAssignmentRepo(tx).assignWithinTransaction(
            tx,
            ctx,
            {
              userId: created.id,
              role: data.role,
              isPrimary: true,
              isActive: true,
            },
          );
          await recordAtomicHttpAudit(tx, request, ctx, {
            action: "user.create",
            targetType: "user",
            targetId: created.id,
          });
          return created;
        },
      );
      return reply.code(201).send({
        id: user.id,
        organizationId: user.organizationId,
        username: user.username,
        name: user.name,
        role: user.role,
        isActive: user.isActive,
        email: user.email ?? null,
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
     * Self-deactivation is rejected before any authority check. All other
     * mutations that can remove effective Admin authority (disable, role
     * replacement) run inside {@link mutateWithEffectiveAdminPostcondition},
     * which holds an organization advisory lock and rolls back if the
     * organization would be left with zero effective Admins.
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

      const newRole = data.role;
      const roleChanged = newRole !== undefined && newRole !== target.role;
      const activeChanged =
        data.isActive !== undefined && data.isActive !== target.isActive;
      const profileChanged =
        data.name !== undefined && data.name !== target.name;
      // P5-N1 §13: `email` is optional. The contract normalizes blank to
      // undefined; the route treats "field present in body" as an explicit
      // write (blank -> null clears it), and "field absent" as a no-op.
      const emailProvided =
        request.body != null && "email" in (request.body as object);
      const emailChanged =
        emailProvided && (data.email ?? null) !== (target.email ?? null);

      const finalUser = await mutateWithEffectiveAdminPostcondition(
        fastify.db,
        ctx,
        async (tx) => {
          const txUserRepo = createUserRepo(tx);
          const txAssignmentRepo = createUserRoleAssignmentRepo(tx);

          const updated = await txUserRepo.update(ctx, id, {
            ...(data.name !== undefined ? { name: data.name } : {}),
            ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
            ...(emailProvided ? { email: data.email ?? null } : {}),
          });
          if (!updated) {
            return null;
          }

          if (roleChanged) {
            await txAssignmentRepo.replacePrimaryRoleWithinTransaction(
              tx,
              ctx,
              {
                userId: id,
                role: newRole,
              },
            );
          }

          await syncUsersRoleFromPrimary(tx, ctx, id);
          const final = await txUserRepo.findByOrganizationAndId(ctx, id);
          if (!final) return null;
          if (roleChanged) {
            await recordAtomicHttpAudit(tx, request, ctx, {
              action: "user.role_changed",
              targetType: "user",
              targetId: id,
              metadata: { oldRole: target.role, newRole },
            });
          }
          if (activeChanged) {
            await recordAtomicHttpAudit(tx, request, ctx, {
              action: data.isActive ? "user.reactivated" : "user.disabled",
              targetType: "user",
              targetId: id,
            });
          }
          return final;
        },
      );

      if (!finalUser) {
        return reply
          .code(404)
          .send(buildErrorResponse(request.id, "RESOURCE_NOT_FOUND"));
      }

      if (profileChanged || emailChanged) {
        recordBestEffortAudit(fastify, request, ctx, {
          action: "user.profile_updated",
          targetType: "user",
          targetId: id,
          metadata: {
            changedFields: [
              ...(profileChanged ? ["name"] : []),
              ...(emailChanged ? ["email"] : []),
            ],
          },
        });
      }

      return {
        id: finalUser.id,
        organizationId: finalUser.organizationId,
        username: finalUser.username,
        name: finalUser.name,
        role: finalUser.role,
        isActive: finalUser.isActive,
        email: finalUser.email ?? null,
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
     * Targets users who have a CandidateProfile (the candidate examinee
     * identity). RBAC-M10-E (P0-7): the target identity is the candidate
     * profile, NOT a role projection — a user with primary Teacher + secondary
     * Candidate (and a candidate profile) is a valid target; a pure Admin is
     * not. This endpoint is the "candidate password reset" surface.
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

      const candidateProfile = await createCandidateRepo(
        fastify.db,
      ).findByUserId(ctx, id);
      if (!candidateProfile) {
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
      // #325: admin candidate password reset also advances the credential
      // epoch atomically — a compromised candidate's stolen JWTs die with
      // the old password.
      const updated = await executeInTransaction(fastify.db, async (tx) => {
        const changed = await createUserRepo(
          tx,
        ).updatePasswordAndAdvanceAuthEpoch(ctx, id, newHash);
        if (!changed) return null;
        await recordAtomicHttpAudit(tx, request, ctx, {
          action: "candidate.password_reset",
          targetType: "user",
          targetId: id,
        });
        return changed;
      });
      if (!updated) {
        return reply
          .code(404)
          .send(buildErrorResponse(request.id, "RESOURCE_NOT_FOUND"));
      }
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
     * Removes the user record from the organization. Runs inside
     * {@link mutateWithEffectiveAdminPostcondition} so deleting the last
     * effective Admin is rejected.
     * Returns 404 if the user does not exist.
     */
    async (request, reply) => {
      const ctx = ensureTargetOrg(getRequestContext(request));
      const { id } = request.params as { id: string };
      const repo = createUserRepo(fastify.db);

      const target = await repo.findByOrganizationAndId(ctx, id);
      if (!target) {
        return reply
          .code(404)
          .send(buildErrorResponse(request.id, "RESOURCE_NOT_FOUND"));
      }

      await mutateWithEffectiveAdminPostcondition(
        fastify.db,
        ctx,
        async (tx) => {
          await createUserRepo(tx).delete(ctx, id);
          await recordAtomicHttpAudit(tx, request, ctx, {
            action: "user.delete",
            targetType: "user",
            targetId: id,
          });
        },
      );
      return reply.code(204).send();
    },
  );
};

export default userRoutes;
