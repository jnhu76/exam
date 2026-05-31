import { FastifyPluginAsync, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import rateLimit from "@fastify/rate-limit";

const rateLimitPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.register(rateLimit, {
    max: 100,
    timeWindow: 60 * 1000,
    keyGenerator(request: FastifyRequest) {
      return request.ip;
    },
    errorResponseBuilder() {
      return {
        message: "Too many requests, please try again later",
        code: "TOO_MANY_REQUESTS",
      };
    },
  });
};

export default fp(rateLimitPlugin);
