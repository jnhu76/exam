import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import fp from "fastify-plugin";
import { verifyJWT, deriveSessionId } from "@exam/auth/src/session.js";
import type { Role, Permission } from "@exam/domain";
import { getPermissionsForRole } from "@exam/auth/src/rbac.js";
import { createUserRepo } from "@exam/db/src/repository/userRepo.js";
import { buildErrorResponse } from "../lib/errorResponse.js";
import { getRuntimeConfig } from "../config/runtimeConfig.js";

const authPlugin: FastifyPluginAsync = async (fastify) => {
  const jwtSecret = getRuntimeConfig().authSecret.jwtSecret;
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
  };

  Object.assign(authenticateFn, { _isAuthenticate: true });
  fastify.decorate("authenticate", authenticateFn);

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
};

export default fp(authPlugin);
