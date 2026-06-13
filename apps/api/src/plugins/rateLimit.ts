import { FastifyPluginAsync, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import rateLimit from "@fastify/rate-limit";
import { AppError } from "@exam/domain";

function isDocsRequest(request: FastifyRequest): boolean {
  if (
    process.env.API_DOCS_ENABLED !== "true" ||
    process.env.NODE_ENV === "production"
  ) {
    return false;
  }
  const url = request.url ?? "";
  const pathOnly = url.split("?", 1)[0] ?? "";
  return pathOnly === "/docs" || pathOnly.startsWith("/docs/");
}

const rateLimitPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.register(rateLimit, {
    max: 100,
    timeWindow: 60 * 1000,
    keyGenerator(request: FastifyRequest) {
      return request.ip;
    },
    allowList(request: FastifyRequest) {
      return isDocsRequest(request);
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
