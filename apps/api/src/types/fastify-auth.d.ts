import "fastify";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { RequestContext, Role } from "@exam/domain";

declare module "fastify" {
  interface FastifyRequest {
    ctx?: RequestContext;
  }

  interface FastifyInstance {
    authenticate: (
      request: FastifyRequest,
      reply: FastifyReply,
    ) => Promise<void>;
    requireRole: (
      roles: Role[],
    ) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}
