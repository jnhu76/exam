import { z } from "zod";
import type { FastifyPluginAsync } from "fastify";
import {
  EffectiveAuthorityResponseSchema,
  ErrorResponseSchema,
  PermissionRegistryResponseSchema,
} from "@exam/contracts";
import {
  Permission,
  PERMISSION_METADATA,
  ROLE_PRESETS,
  type PermissionKey,
} from "@exam/authz";
import { createUserRepo } from "@exam/db/src/repository/userRepo.js";
import { createUserRoleAssignmentRepo } from "@exam/db/src/repository/userRoleAssignmentRepo.js";
import { deriveAssignmentAuthority } from "../authz/assignmentAuthority.js";
import { ensureTargetOrg, getRequestContext } from "./helpers.js";
import { buildErrorResponse } from "../lib/errorResponse.js";

/** OpenAPI security definition for cookie-based authentication. */
const cookieAuth = [{ cookieAuth: [] }] as const;

const idParamsSchema = z.object({ id: z.string().uuid() });

/**
 * Read-projection routes for the authorization surfaces.
 *
 * Both endpoints are Admin-only VISIBILITY projections over existing
 * authority — they never mutate and never re-derive a second authority:
 *   - `GET /admin/permission-registry` projects the @exam/authz catalog +
 *     role presets verbatim (the closed unions ARE the authority);
 *   - `GET /admin/users/:id/effective-authority` reuses the canonical
 *     `deriveAssignmentAuthority` kernel and returns the assignment rows so
 *     the UI can answer "who has which capability and why".
 */
export const permissionRegistryRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /admin/permission-registry
   *
   * Admin-only. Returns every permission (key + semantic category) and every
   * role preset (label, purpose, default scope, permission union, sensitive
   * subset). Pure projection of `@exam/authz` constants — no DB table, no
   * frontend registry, no second role→permission mapping.
   */
  fastify.get(
    "/admin/permission-registry",
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireCapability(Permission.UserRoleAssign),
      ],
      schema: {
        security: cookieAuth,
        "x-role": ["Admin"],
        response: { 200: PermissionRegistryResponseSchema },
      },
    },
    async () => {
      const permissions = (Object.keys(PERMISSION_METADATA) as PermissionKey[])
        .map((key) => ({
          key,
          category: PERMISSION_METADATA[key].category,
        }))
        .sort((a, b) => a.key.localeCompare(b.key));
      const rolePresets = Object.values(ROLE_PRESETS).map((preset) => ({
        key: preset.key,
        label: preset.label,
        purpose: preset.purpose,
        isSystem: preset.isSystem,
        assignable: preset.assignable,
        loginAllowed: preset.loginAllowed,
        defaultScope: preset.defaultScope,
        permissions: [...preset.permissions],
        sensitivePermissions: [...preset.sensitivePermissions],
      }));
      return { permissions, rolePresets };
    },
  );

  /**
   * GET /admin/users/:id/effective-authority
   *
   * Admin-only. Answers "which capabilities does this user hold and why" by
   * reusing the canonical assignment-authority kernel:
   *   - `assignments` are the authoritative source rows (org-scoped);
   *   - `authority` is `deriveAssignmentAuthority`'s discriminated result —
   *     the SAME derivation the login/authenticate path runs, never a
   *     re-computed preset union in this route.
   * A user outside the current organization answers 404 (no cross-org
   * enumeration); a user with no active assignment is a NORMAL result
   * (`ok:false, reason:"no_active_assignments"`), not an error.
   */
  fastify.get(
    "/admin/users/:id/effective-authority",
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireCapability(Permission.UserRoleAssign),
      ],
      schema: {
        params: idParamsSchema,
        security: cookieAuth,
        "x-role": ["Admin"],
        response: {
          200: EffectiveAuthorityResponseSchema,
          404: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const ctx = ensureTargetOrg(getRequestContext(request));
      const { id } = request.params as { id: string };

      const userRepo = createUserRepo(fastify.db);
      const users = await userRepo.findByIds(ctx, [id]);
      const user = users[0];
      if (!user) {
        return reply
          .code(404)
          .send(buildErrorResponse(request.id, "RESOURCE_NOT_FOUND"));
      }

      const assignmentRepo = createUserRoleAssignmentRepo(fastify.db);
      const assignments = await assignmentRepo.listForUser(ctx, id);
      // Deterministic display order: active first, then chronological.
      const ordered = [...assignments].sort(
        (a, b) =>
          Number(b.isActive) - Number(a.isActive) ||
          a.createdAt.getTime() - b.createdAt.getTime(),
      );

      const authority = deriveAssignmentAuthority(
        assignments,
        ctx.organizationId,
        id,
      );

      return {
        user: { id: user.id, name: user.name, username: user.username },
        authority,
        assignments: ordered.map((a) => ({
          id: a.id,
          role: a.role,
          isPrimary: a.isPrimary,
          isActive: a.isActive,
          createdAt: a.createdAt.toISOString(),
        })),
      };
    },
  );
};
