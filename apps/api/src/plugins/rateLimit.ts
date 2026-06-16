import { FastifyPluginAsync, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import rateLimit from "@fastify/rate-limit";
import { AppError } from "@exam/domain";
import { getRuntimeConfig } from "../config/runtimeConfig.js";

function isApiReferenceRequest(request: FastifyRequest): boolean {
  const config = getRuntimeConfig();
  if (!config.apiReference.enabled) {
    return false;
  }
  const uiPath = config.apiReference.uiPath;
  const url = request.url ?? "";
  const pathOnly = url.split("?", 1)[0] ?? "";
  return pathOnly === uiPath || pathOnly.startsWith(`${uiPath}/`);
}

const rateLimitPlugin: FastifyPluginAsync = async (fastify) => {
  const config = getRuntimeConfig();
  if (!config.rateLimit.enabled) {
    return;
  }

  fastify.register(rateLimit, {
    max: config.rateLimit.max,
    timeWindow: config.rateLimit.timeWindow,
    keyGenerator(request: FastifyRequest) {
      return request.ip;
    },
    allowList(request: FastifyRequest) {
      return isApiReferenceRequest(request);
    },
    errorResponseBuilder(_request, context) {
      return new AppError(
        "Rate limit exceeded",
        "RATE_LIMITED",
        context.statusCode,
      );
    },
  });
};

export default fp(rateLimitPlugin);
