/**
 * ADR-007 Phase 7 — Redis test isolation helper.
 *
 * Provides prefix-scoped Redis connections for tests. Each test scope gets
 * its own key prefix, and cleanup only deletes keys under that prefix.
 *
 * Non-goals:
 *   - Does NOT replace PostgreSQL as source of truth.
 *   - Does NOT introduce queue/BullMQ.
 *   - Does NOT modify production code paths.
 */

import Redis from "ioredis";
import { resolveTestScope, type ResolverEnv } from "@exam/db/src/testScope.js";

export interface TestRedisHandle {
  client: Redis;
  prefix: string;
  resetByPrefix(): Promise<void>;
  close(): Promise<void>;
}

function resolveRedisUrl(env: ResolverEnv): string {
  const url = env.REDIS_URL ?? env.TEST_REDIS_URL;
  if (!url) {
    throw new Error(
      "[testRedis] REDIS_URL or TEST_REDIS_URL is required for Redis test isolation",
    );
  }
  return url;
}

/**
 * Create a prefix-scoped Redis client for the current test scope.
 * Cleanup only deletes keys matching the scope prefix.
 */
export async function setupTestRedis(options?: {
  env?: ResolverEnv;
  prefix?: string;
}): Promise<TestRedisHandle> {
  const env = options?.env ?? process.env;
  const url = resolveRedisUrl(env);

  const scope = resolveTestScope(env);
  const prefix = options?.prefix ?? scope.redisPrefix;

  const client = new Redis(url, {
    keyPrefix: prefix,
    maxRetriesPerRequest: 1,
    lazyConnect: true,
  });

  await client.connect();

  return {
    client,
    prefix,
    async resetByPrefix() {
      let cursor = "0";
      do {
        const [nextCursor, keys] = await client.scan(
          cursor,
          "MATCH",
          `${prefix}*`,
          "COUNT",
          100,
        );
        cursor = nextCursor;
        if (keys.length > 0) {
          await client.del(...keys);
        }
      } while (cursor !== "0");
    },
    async close() {
      await client.quit();
    },
  };
}

/**
 * Check if Redis is available for tests (URL is configured).
 */
export function isRedisAvailable(env: ResolverEnv = process.env): boolean {
  const url = env.REDIS_URL ?? env.TEST_REDIS_URL;
  return !!url && url.trim().length > 0;
}
