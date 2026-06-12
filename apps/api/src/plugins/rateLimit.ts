import { FastifyPluginAsync, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import rateLimit from "@fastify/rate-limit";
import { AppError } from "@exam/domain";

const rateLimitPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.register(rateLimit, {
    max: 100,
    timeWindow: 60 * 1000,
    keyGenerator(request: FastifyRequest) {
      return request.ip;
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
