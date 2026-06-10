import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import fp from "fastify-plugin";
import {
  validateTenantAccess,
  validateTargetOrganizationExists,
  isPublicEndpoint,
} from "@exam/auth/src/tenantGuard.js";
import { createOrganizationRepo } from "@exam/db/src/repository/organizationRepo.js";
import type { AnyDatabase } from "@exam/db/src/types.js";

const tenantGuardHook = async (
  request: FastifyRequest,
  reply: FastifyReply,
  db: AnyDatabase,
) => {
  if (!request.ctx) return;
  if (isPublicEndpoint(request.url)) return;

  if (request.ctx.role === "SuperAdmin") {
    const targetOrgHeader = request.headers["x-target-org"];
    if (typeof targetOrgHeader === "string") {
      request.ctx.targetOrganizationId = targetOrgHeader;
    }
  }

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

  if (request.ctx.role === "SuperAdmin" && request.ctx.targetOrganizationId) {
    const orgRepo = createOrganizationRepo(db);
    await validateTargetOrganizationExists(request.ctx, async (id) => {
      const org = await orgRepo.findById(request.ctx!, id);
      return org !== null;
    });
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
      tenantGuardHook(req, reply, fastify.db as AnyDatabase);

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
