import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import fp from "fastify-plugin";
import { verifyJWT } from "@exam/auth/src/session.js";
import type { Role } from "@exam/domain";
import { createUserRepo } from "@exam/db/src/repository/userRepo.js";

const authPlugin: FastifyPluginAsync = async (fastify) => {
  const authenticateFn = async (
    request: FastifyRequest,
    reply: FastifyReply,
  ) => {
    let token: string | undefined;
    try {
      token = request.cookies["auth-token"];
      if (!token) {
        return reply.code(401).send({
          error: { message: "Unauthorized", code: "UNAUTHORIZED" },
        });
      }
    } catch {
      return reply.code(401).send({
        error: { message: "Unauthorized", code: "UNAUTHORIZED" },
      });
    }

    let payload: Awaited<ReturnType<typeof verifyJWT>>;
    try {
      payload = verifyJWT(token);
    } catch {
      return reply.code(401).send({
        error: { message: "Unauthorized", code: "UNAUTHORIZED" },
      });
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
      return reply.code(500).send({
        error: {
          message: "Internal server error",
          code: "INTERNAL_SERVER_ERROR",
        },
      });
    }

    if (!user?.isActive) {
      return reply.code(401).send({
        error: { message: "Unauthorized", code: "UNAUTHORIZED" },
      });
    }

    request.ctx = {
      actorId: payload.actorId,
      organizationId: payload.organizationId,
      role: user.role,
      permissions: [],
      sessionId: token,
    };
  };

  Object.assign(authenticateFn, { _isAuthenticate: true });
  fastify.decorate("authenticate", authenticateFn);

  fastify.decorate("requireRole", (roles: Role[]) => {
    return async (request, reply) => {
      const ctx = request.ctx;
      if (!ctx) {
        return reply.code(401).send({
          error: { message: "Unauthorized", code: "UNAUTHORIZED" },
        });
      }

      if (!roles.includes(ctx.role)) {
        return reply.code(403).send({
          error: { message: "Forbidden", code: "FORBIDDEN" },
        });
      }
    };
  });
};

export default fp(authPlugin);
