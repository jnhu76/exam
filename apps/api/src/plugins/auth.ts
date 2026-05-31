import { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import { verifyJWT } from "@exam/auth/src/session.js";
import { createUserRepo } from "@exam/db/src/repository/userRepo.js";
import { createDatabase } from "@exam/db/src/database.js";
import { RequestContext } from "@exam/domain";

const authPlugin: FastifyPluginAsync = async (fastify) => {
  // 注册 JWT 插件
  fastify.decorate("authenticate", async (request: any, reply: any) => {
    try {
      const token = request.cookies["auth-token"];
      if (!token) {
        return reply.code(401).send({
          message: "Unauthorized",
          code: "UNAUTHORIZED",
        });
      }

      const payload = verifyJWT(token);

      request["ctx"] = {
        actorId: payload.actorId,
        organizationId: payload.organizationId,
        role: payload.role,
        permissions: [], // TODO: 实现权限管理
        sessionId: token,
      } as RequestContext;
    } catch (error) {
      return reply.code(401).send({
        message: "Unauthorized",
        code: "UNAUTHORIZED",
      });
    }
  });

  fastify.decorate("requireRole", (roles: string[]) => {
    return async (request: any, reply: any) => {
      const ctx = request["ctx"];
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
