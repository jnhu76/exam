import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import Redis from "ioredis";
import { getRuntimeConfig } from "../config/runtimeConfig.js";
import { RedisRuntime } from "../redis/redisRuntime.js";

export interface RedisClient extends Redis {
  prefix: string;
}

declare module "fastify" {
  interface FastifyInstance {
    redis: RedisClient | null;
    redisRuntime: RedisRuntime;
  }
}

/**
 * Redis runtime plugin (P7 — Redis first real adoption).
 *
 * Owns the Redis client lifecycle for the process: creates the bounded
 * client, runs the bounded startup (mode-dependent), exposes the runtime
 * state via `fastify.redisRuntime` (used by the rate-limit store selection
 * and diagnostics), and shuts down cleanly on close.
 *
 * The runtime never crashes on client events and never hangs startup:
 * `optional` degrades, `required` fails fast inside the startup window.
 */
const redisPlugin: FastifyPluginAsync = async (fastify) => {
  const config = getRuntimeConfig();

  const runtime = new RedisRuntime({
    config: config.redis,
    logger: fastify.log,
    // ADR-006: latency measurement uses the exam time authority. The thunk is
    // evaluated only on demand (after nowPlugin is registered).
    now: () => fastify.now(),
  });

  await runtime.start();

  fastify.decorate("redisRuntime", runtime);

  const client = runtime.client;
  if (client) {
    (client as RedisClient).prefix = config.redis.keyPrefix;
  }
  fastify.decorate<RedisClient | null>("redis", client as RedisClient | null);

  fastify.addHook("onClose", async () => {
    await runtime.close();
  });
};

export default fp(redisPlugin);
