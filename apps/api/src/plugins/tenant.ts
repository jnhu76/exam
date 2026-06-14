import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import fp from "fastify-plugin";
import { validateTenantAccess } from "@exam/auth/src/tenantGuard.js";

const tenantGuardHook = async (
  request: FastifyRequest,
  reply: FastifyReply,
) => {
  if (!request.ctx) return;
  try {
    validateTenantAccess(request.ctx, request.method, request.url);
  } catch (err) {
    if (err && typeof err === "object" && "statusCode" in err) {
      const e = err as {
        statusCode: number;
        message: string;
        code?: string;
      };
      return reply.code(e.statusCode).send({
        error: {
          code: e.code ?? "TENANT_ACCESS_DENIED",
          message: e.message,
        },
      });
    }
    throw err;
  }
};

const tenantPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("onRoute", (routeOptions) => {
    const preHandlers = routeOptions.preHandler;
    if (!preHandlers) return;

    const handlerArray = Array.isArray(preHandlers)
      ? preHandlers
      : [preHandlers];

    const hasAuthenticate = handlerArray.some((h) => {
      const fn = h as unknown as Record<string, unknown>;
      return fn._isAuthenticate === true;
    });

    if (!hasAuthenticate) return;

    const tenantHandler = (req: FastifyRequest, reply: FastifyReply) =>
      tenantGuardHook(req, reply);

    if (Array.isArray(routeOptions.preHandler)) {
      const authIdx = routeOptions.preHandler.findIndex((h) => {
        const fn = h as unknown as Record<string, unknown>;
        return fn._isAuthenticate === true;
      });
      routeOptions.preHandler.splice(authIdx + 1, 0, tenantHandler as never);
    } else {
      routeOptions.preHandler = [
        routeOptions.preHandler as never,
        tenantHandler as never,
      ];
    }
  });
};

export default fp(tenantPlugin);
