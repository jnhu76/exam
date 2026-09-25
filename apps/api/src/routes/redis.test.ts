import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Fastify from "fastify";
import Redis from "ioredis";
import { resetRuntimeConfigForTest } from "../config/runtimeConfig.js";
import redisPlugin from "../plugins/redis.js";

/**
 * Resolve the Redis URL the baseline tests connect to. Redis is OPTIONAL
 * infrastructure (ADR-001), so when no URL is configured (or it is unset/empty)
 * the connection-requiring tests are SKIPPED, never failed. This keeps the
 * suite green in environments without Redis while still exercising the plugin
 * when Redis is available.
 */
function resolveRedisUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = env.REDIS_URL;
  if (!raw) return null;
  const trimmed = raw.trim();
  return trimmed.length === 0 ? null : trimmed;
}

const REDIS_URL = resolveRedisUrl();

/**
 * Lazily prove Redis is actually reachable (not just configured). Used to gate
 * the connection-requiring tests so a misconfigured/unreachable Redis results
 * in a SKIP with a clear reason rather than a 10s retry storm + failure.
 */
async function canReachRedis(url: string): Promise<boolean> {
  const probe = new Redis(url, {
    maxRetriesPerRequest: 1,
    connectTimeout: 500,
    retryStrategy: () => null,
    enableOfflineQueue: false,
    lazyConnect: true,
  });
  try {
    await probe.connect();
    await probe.ping();
    return true;
  } catch {
    return false;
  } finally {
    if (probe.status !== "end") {
      try {
        await probe.quit();
      } catch {
        /* ignore */
      }
    }
  }
}

let redisReachable = false;

beforeAll(async () => {
  redisReachable = REDIS_URL ? await canReachRedis(REDIS_URL) : false;
});

describe("Redis baseline", () => {
  describe("plugin lifecycle", () => {
    it("connects and decorates fastify.redis", async ({ skip }) => {
      if (!REDIS_URL) return skip("REDIS_URL not set");
      if (!redisReachable) return skip("Redis not reachable");

      const savedEnv = { ...process.env };
      process.env.REDIS_URL = REDIS_URL;
      resetRuntimeConfigForTest();

      const app = Fastify();
      await app.register(redisPlugin);
      await app.ready();

      expect(app.redis).not.toBeNull();
      expect(app.redis).toBeInstanceOf(Redis);

      const pong = await app.redis!.ping();
      expect(pong).toBe("PONG");

      await app.close();
      process.env = savedEnv;
      resetRuntimeConfigForTest();
    });

    it("decorates null when REDIS_URL is unset", async () => {
      const savedEnv = { ...process.env };
      delete process.env.REDIS_URL;
      delete process.env.TEST_REDIS_URL;
      resetRuntimeConfigForTest();

      const app = Fastify();
      await app.register(redisPlugin);
      await app.ready();

      expect(app.redis).toBeNull();

      await app.close();
      process.env = savedEnv;
      resetRuntimeConfigForTest();
    });

    it("decorates null when REDIS_URL is empty", async () => {
      const savedEnv = { ...process.env };
      process.env.REDIS_URL = "  ";
      resetRuntimeConfigForTest();

      const app = Fastify();
      await app.register(redisPlugin);
      await app.ready();

      expect(app.redis).toBeNull();

      await app.close();
      process.env = savedEnv;
      resetRuntimeConfigForTest();
    });

    it("closes connection gracefully", async ({ skip }) => {
      if (!REDIS_URL) return skip("REDIS_URL not set");
      if (!redisReachable) return skip("Redis not reachable");

      const savedEnv = { ...process.env };
      process.env.REDIS_URL = REDIS_URL;
      resetRuntimeConfigForTest();

      const app = Fastify();
      await app.register(redisPlugin);
      await app.ready();

      expect(app.redis).not.toBeNull();

      const client = app.redis!;
      expect(client.status).toBe("ready");

      await app.close();

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(client.status).not.toBe("ready");
      process.env = savedEnv;
      resetRuntimeConfigForTest();
    });
  });

  // ioredis keyPrefix isolation and SCAN-based prefix cleanup semantics are
  // library behavior, not product behavior: the deleted "test prefix
  // isolation" / "cleanup only current prefix" witnesses exercised ioredis
  // directly (and an inline re-implementation of the cleanup loop) without
  // importing any production code. If the scan/delete algorithm in
  // testRedis.ts is ever productized, pin the real helper — not a copy.
});
