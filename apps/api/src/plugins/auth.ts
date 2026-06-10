import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import { verifyJWT } from "@exam/auth/src/session.js";
import type { Role } from "@exam/domain";
import { createUserRepo } from "@exam/db/src/repository/userRepo.js";

const authPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.decorate("authenticate", async (request, reply) => {
    try {
      const token = request.cookies["auth-token"];
      if (!token) {
        return reply.code(401).send({
          message: "Unauthorized",
          code: "UNAUTHORIZED",
        });
      }

      const payload = verifyJWT(token);
      const user = await createUserRepo(fastify.db).findByOrganizationAndId(
        {
          actorId: payload.actorId,
          organizationId: payload.organizationId,
          role: payload.role,
          permissions: [],
          sessionId: "",
        },
        payload.actorId,
      );
      if (!user?.isActive) {
        return reply.code(401).send({
          message: "Unauthorized",
          code: "UNAUTHORIZED",
        });
      }

      request.ctx = {
        actorId: payload.actorId,
        organizationId: payload.organizationId,
        role: user.role,
        permissions: [],
        sessionId: token,
      };
    } catch {
      return reply.code(401).send({
        message: "Unauthorized",
        code: "UNAUTHORIZED",
      });
    }
  });

  fastify.decorate("requireRole", (roles: Role[]) => {
    return async (request, reply) => {
      const ctx = request.ctx;
      if (!ctx) {
        return reply.code(401).send({
          message: "Unauthorized",
          code: "UNAUTHORIZED",
        });
      }

      if (!roles.includes(ctx.role)) {
        return reply.code(403).send({
          message: "Forbidden",
          code: "FORBIDDEN",
        });
      }
    };
  });
};

export default fp(authPlugin);
