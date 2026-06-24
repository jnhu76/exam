import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import Redis from "ioredis";
import { getRuntimeConfig } from "../config/runtimeConfig.js";

export interface RedisClient extends Redis {
  prefix: string;
}

declare module "fastify" {
  interface FastifyInstance {
    redis: RedisClient | null;
  }
}

function createRedisClient(url: string, keyPrefix: string): RedisClient {
  const client = new Redis(url, {
    keyPrefix,
    maxRetriesPerRequest: 3,
    retryStrategy(times: number) {
      if (times > 3) return null;
      return Math.min(times * 200, 2000);
    },
    lazyConnect: true,
  }) as RedisClient;
  client.prefix = keyPrefix;
  return client;
}

const redisPlugin: FastifyPluginAsync = async (fastify) => {
  const config = getRuntimeConfig();

  if (!config.redis.enabled || !config.redis.url) {
    fastify.decorate<RedisClient | null>("redis", null);
    return;
  }

  const client = createRedisClient(config.redis.url, config.redis.keyPrefix);

  await client.connect();

  fastify.decorate<RedisClient>("redis", client);

  fastify.addHook("onClose", async () => {
    await client.quit();
  });
};

export default fp(redisPlugin);
