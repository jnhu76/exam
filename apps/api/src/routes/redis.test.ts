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

  describe("test prefix isolation", () => {
    const prefix1 = "exam:test:isolation:w1:";
    const prefix2 = "exam:test:isolation:w2:";
    let raw: Redis | undefined;
    let client1: Redis | undefined;
    let client2: Redis | undefined;

    beforeAll(async () => {
      // beforeAll has no access to the test-context `skip`; gate on the
      // module-level reachability flag instead. The individual `it` cases
      // still call `skip()` when Redis is absent, so this block no-ops then.
      if (!REDIS_URL || !redisReachable) return;

      raw = new Redis(REDIS_URL, { lazyConnect: true });
      await raw.connect();
      client1 = new Redis(REDIS_URL, { keyPrefix: prefix1, lazyConnect: true });
      client2 = new Redis(REDIS_URL, { keyPrefix: prefix2, lazyConnect: true });
      await client1.connect();
      await client2.connect();
    });

    afterAll(async () => {
      if (raw) {
        await raw.del(
          `${prefix1}shared-key`,
          `${prefix1}key-a`,
          `${prefix2}shared-key`,
          `${prefix2}key-b`,
        );
        await raw.quit();
      }
      await client1?.quit();
      await client2?.quit();
    });

    it("prefix1 and prefix2 are isolated", async ({ skip }) => {
      if (!REDIS_URL || !redisReachable || !client1 || !client2) {
        return skip("Redis not available");
      }

      await client1.set("shared-key", "value1");
      await client2.set("shared-key", "value2");

      const v1 = await client1.get("shared-key");
      const v2 = await client2.get("shared-key");

      expect(v1).toBe("value1");
      expect(v2).toBe("value2");
    });

    it("deleting prefix1 keys does not affect prefix2", async ({ skip }) => {
      if (!REDIS_URL || !redisReachable || !raw || !client1 || !client2) {
        return skip("Redis not available");
      }

      await client1.set("key-a", "from-1");
      await client2.set("key-b", "from-2");

      await raw.del(`${prefix1}key-a`);

      const v1 = await client1.get("key-a");
      const v2 = await client2.get("key-b");

      expect(v1).toBeNull();
      expect(v2).toBe("from-2");

      await raw.del(`${prefix2}key-b`);
    });
  });

  describe("cleanup only current prefix", () => {
    it("prefix-scoped delete only removes scoped keys", async ({ skip }) => {
      if (!REDIS_URL || !redisReachable) return skip("Redis not available");

      const scopedPrefix = `exam:test:cleanup:${Date.now()}:`;
      const externalPrefix = `exam:test:external:${Date.now()}:`;

      const raw = new Redis(REDIS_URL, { lazyConnect: true });
      await raw.connect();

      await raw.set(`${scopedPrefix}scoped-key`, "scoped-value");
      await raw.set(`${externalPrefix}external-key`, "external-value");

      let cursor = "0";
      do {
        const [nextCursor, keys] = await raw.scan(
          cursor,
          "MATCH",
          `${scopedPrefix}*`,
          "COUNT",
          100,
        );
        cursor = nextCursor;
        if (keys.length > 0) await raw.del(...keys);
      } while (cursor !== "0");

      const remainingScoped = await raw.keys(`${scopedPrefix}*`);
      const remainingExternal = await raw.keys(`${externalPrefix}*`);

      expect(remainingScoped).toHaveLength(0);
      expect(remainingExternal).toHaveLength(1);

      await raw.del(`${externalPrefix}external-key`);
      await raw.quit();
    });
  });
});
