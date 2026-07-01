import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import fp from "fastify-plugin";
import { verifyJWT, deriveSessionId } from "@exam/auth/src/session.js";
import type { Role, Permission } from "@exam/domain";
import { getPermissionsForRole } from "@exam/auth/src/rbac.js";
import {
  permissionsForRole,
  type PermissionKey,
  type RoleKey,
} from "@exam/authz";
import { createUserRepo } from "@exam/db/src/repository/userRepo.js";
import { buildErrorResponse } from "../lib/errorResponse.js";
import { getRuntimeConfig } from "../config/runtimeConfig.js";

/**
 * Memoized role-preset permission sets (Phase 3 dotted keys). Presets are
 * static, so the cache is safe for the process lifetime. Admin is a documented
 * superset (RBAC-M6), so it passes every capability check.
 */
const PRESET_SETS = new Map<RoleKey, ReadonlySet<PermissionKey>>();
function presetSet(role: RoleKey): ReadonlySet<PermissionKey> {
  let set = PRESET_SETS.get(role);
  if (!set) {
    set = new Set<PermissionKey>(permissionsForRole(role));
    PRESET_SETS.set(role, set);
  }
  return set;
}

/**
 * Fastify plugin that registers authentication and authorization decorators
 * on the Fastify instance. Provides {@link authenticate} for JWT-based
 * request authentication and {@link requirePermission}/{@link requireRole}
 * for route-level authorization guards.
 */
const authPlugin: FastifyPluginAsync = async (fastify) => {
  const jwtSecret = getRuntimeConfig().authSecret.jwtSecret;
  /**
   * Pre-handler that authenticates a request via the `auth-token` cookie.
   * Verifies the JWT, loads the user from the database, and populates
   * `request.ctx` with the authenticated actor's context. Replies 401 on
   * missing/invalid token or inactive user.
   */
  const authenticateFn = async (
    request: FastifyRequest,
    reply: FastifyReply,
  ) => {
    let token: string | undefined;
    try {
      token = request.cookies["auth-token"];
      if (!token) {
        return reply
          .code(401)
          .send(buildErrorResponse(request.id, "AUTH_REQUIRED"));
      }
    } catch {
      return reply
        .code(401)
        .send(buildErrorResponse(request.id, "AUTH_REQUIRED"));
    }

    let payload: Awaited<ReturnType<typeof verifyJWT>>;
    try {
      payload = verifyJWT(token, jwtSecret);
    } catch {
      return reply
        .code(401)
        .send(buildErrorResponse(request.id, "AUTH_REQUIRED"));
    }

    let user: Awaited<
      ReturnType<ReturnType<typeof createUserRepo>["findByOrganizationAndId"]>
    >;
    try {
      user = await createUserRepo(fastify.db).findByOrganizationAndId(
        {
          actorId: payload.actorId,
          organizationId: payload.organizationId,
          role: payload.role,
          permissions: [],
          sessionId: "",
        },
        payload.actorId,
      );
    } catch (err) {
      fastify.log.error(
        { err, actorId: payload.actorId },
        "Database error during authentication",
      );
      return reply
        .code(500)
        .send(buildErrorResponse(request.id, "INTERNAL_ERROR"));
    }

    if (!user?.isActive) {
      return reply
        .code(401)
        .send(buildErrorResponse(request.id, "AUTH_REQUIRED"));
    }

    request.ctx = {
      actorId: payload.actorId,
      organizationId: payload.organizationId,
      role: user.role as Role,
      permissions: getPermissionsForRole(user.role as Role) as Permission[],
      sessionId: deriveSessionId(token),
    };

    request.log = request.log.child({
      actorId: payload.actorId,
      actorRole: user.role,
      organizationId: payload.organizationId,
    });
  };

  Object.assign(authenticateFn, { _isAuthenticate: true });
  fastify.decorate("authenticate", authenticateFn);

  /**
   * Returns a pre-handler that checks whether the authenticated actor holds
   * the specified permission. Replies 401 if no context is present, or 403
   * if the permission is not in the actor's role permission set.
   */
  fastify.decorate("requirePermission", (permission: Permission) => {
    return async (request, reply) => {
      const ctx = request.ctx;
      if (!ctx) {
        return reply
          .code(401)
          .send(buildErrorResponse(request.id, "AUTH_REQUIRED"));
      }

      if (!ctx.permissions.includes(permission)) {
        return reply
          .code(403)
          .send(buildErrorResponse(request.id, "PERMISSION_DENIED"));
      }
    };
  });

  /**
   * Returns a pre-handler that checks whether the authenticated actor's role
   * is one of the allowed roles. Replies 401 if no context is present, or
   * 403 if the role is not in the allowed list.
   */
  fastify.decorate("requireRole", (roles: Role[]) => {
    return async (request, reply) => {
      const ctx = request.ctx;
      if (!ctx) {
        return reply
          .code(401)
          .send(buildErrorResponse(request.id, "AUTH_REQUIRED"));
      }

      if (!roles.includes(ctx.role)) {
        return reply
          .code(403)
          .send(buildErrorResponse(request.id, "PERMISSION_DENIED"));
      }
    };
  });

  /**
   * Returns a pre-handler that checks the authenticated actor's role PRESET
   * for a Phase 3 {@link PermissionKey} (RBAC runtime activation, PR #3).
   * This is the capability gate replacing `requireRole` on sensitive routes.
   *
   * Decision: consults the `@exam/authz` role preset (Admin is a superset, so
   * Admin passes every check; Proctor passes proctor perms; Grader passes
   * grading perms; Candidate/Teacher do not get proctor/grading/admin perms).
   * Replies 401 if no ctx, 403 if the preset lacks the permission.
   *
   * NOTE: this base decorator is permission-only. Resource-aware checks
   * (org-anchor / ownership via resolvers) are layered on top in the route
   * preHandler chain (Step 3 resolvers) — not here.
   */
  fastify.decorate("requireCapability", (permission: PermissionKey) => {
    return async (request, reply) => {
      const ctx = request.ctx;
      if (!ctx) {
        return reply
          .code(401)
          .send(buildErrorResponse(request.id, "AUTH_REQUIRED"));
      }

      if (!presetSet(ctx.role as RoleKey).has(permission)) {
        return reply
          .code(403)
          .send(buildErrorResponse(request.id, "PERMISSION_DENIED"));
      }
    };
  });
};

export default fp(authPlugin);
