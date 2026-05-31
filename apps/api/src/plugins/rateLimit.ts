import { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import rateLimit from "fastify-rate-limit";

const rateLimitPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.register(rateLimit, {
    max: 10,
    timeWindow: 60 * 1000, // 1 minute
    async keyGenerator(request: any) {
      // 使用用户名作为限流 key
      const body = request.body as { username?: string };
      return body.username || request.ip;
    },
    errorResponseBuilder(request: any, context: any) {
      return {
        message: "Too many login attempts",
        code: "TOO_MANY_REQUESTS",
        retryAfter: Math.ceil(context.remainingTimeWindow / 1000),
      };
    },
  });
};

export default fp(rateLimitPlugin);
