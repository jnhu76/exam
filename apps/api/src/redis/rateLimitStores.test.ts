import { describe, expect, it, vi } from "vitest";
import type Redis from "ioredis";
import { AppError } from "@exam/domain";
import type { RedisMode } from "../config/runtimeConfig.js";
import {
  DelegatingRateLimitStore,
  LocalRateLimitStore,
  RATE_LIMIT_NAMESPACE,
  RATE_LIMIT_UNAVAILABLE,
  RedisRateLimitStore,
  type RateLimitRuntimeLike,
} from "./rateLimitStores.js";

/** Minimal runtime stub for store-selection unit tests. */
class StubRuntime implements RateLimitRuntimeLike {
  mode: RedisMode;
  private ready: boolean;
  commandErrors = 0;

  constructor(mode: RedisMode, ready: boolean) {
    this.mode = mode;
    this.ready = ready;
  }

  setReady(ready: boolean): void {
    this.ready = ready;
  }

  shouldUseRedis(): boolean {
    return this.ready;
  }

  noteRedisCommandError(): void {
    this.commandErrors += 1;
  }
}

/** A fake ioredis client that records rate-limit command calls. */
function makeFakeRedis(): {
  client: Redis;
  calls: Array<{ key: string; timeWindow: number; max: number }>;
  failNext: Error | null;
} {
  const calls: Array<{ key: string; timeWindow: number; max: number }> = [];
  let failNext: Error | null = null;
  const client = {
    defineCommand: () => {},
    p7RateLimit: (
      key: string,
      timeWindow: number,
      max: number,
      _ce: boolean,
      _eb: boolean,
      cb: (err: Error | null, result?: [number, number]) => void,
    ) => {
      calls.push({ key, timeWindow, max });
      if (failNext) {
        const err = failNext;
        failNext = null;
        cb(err);
        return;
      }
      cb(null, [1, timeWindow]);
    },
  } as unknown as Redis;
  return {
    client,
    calls,
    get failNext() {
      return failNext;
    },
    set failNext(v: Error | null) {
      failNext = v;
    },
  };
}

/** Successful-path helper: resolves the store result, rejects on error. */
function incrOk(
  store: DelegatingRateLimitStore,
  key: string,
  timeWindow = 60_000,
  max = 100,
): Promise<{ current: number; ttl: number }> {
  return new Promise((resolve, reject) => {
    store.incr(
      key,
      (err, result) => (err ? reject(err) : resolve(result!)),
      timeWindow,
      max,
    );
  });
}

/** Failure-path helper: resolves the store error (fail-closed contract). */
function incrErr(
  store: DelegatingRateLimitStore,
  key: string,
  timeWindow = 60_000,
  max = 100,
): Promise<AppError> {
  return new Promise((resolve) => {
    store.incr(key, (err) => resolve(err as AppError), timeWindow, max);
  });
}

describe("LocalRateLimitStore (fixed window, per-process)", () => {
  it("counts hits within a window and resets after it", async () => {
    const store = new LocalRateLimitStore({});
    const first = await new Promise<{ current: number; ttl: number }>((res) =>
      store.incr("k", (_e, r) => res(r!), 20, 100),
    );
    const second = await new Promise<{ current: number; ttl: number }>((res) =>
      store.incr("k", (_e, r) => res(r!), 20, 100),
    );
    expect(first.current).toBe(1);
    expect(first.ttl).toBe(20);
    expect(second.current).toBe(2);
    expect(second.ttl).toBeLessThanOrEqual(20);

    await new Promise((r) => setTimeout(r, 30));
    const after = await new Promise<{ current: number; ttl: number }>((res) =>
      store.incr("k", (_e, r) => res(r!), 20, 100),
    );
    expect(after.current).toBe(1);
  });

  it("keeps keys independent", async () => {
    const store = new LocalRateLimitStore({});
    const a = await new Promise<{ current: number }>((res) =>
      store.incr("a", (_e, r) => res(r!), 60_000, 100),
    );
    const b = await new Promise<{ current: number }>((res) =>
      store.incr("b", (_e, r) => res(r!), 60_000, 100),
    );
    expect(a.current).toBe(1);
    expect(b.current).toBe(1);
  });
});

describe("RedisRateLimitStore (atomic Lua counter)", () => {
  it("incr sends the composed key and returns current/ttl", async () => {
    const { client, calls } = makeFakeRedis();
    const store = new RedisRateLimitStore({}, client, RATE_LIMIT_NAMESPACE);
    const result = await new Promise<{ current: number; ttl: number }>((res) =>
      store.incr("digest-key", (_e, r) => res(r!), 60_000, 100),
    );
    expect(result.current).toBe(1);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.key).toBe("ratelimit:v1:digest-key");
    expect(calls[0]!.timeWindow).toBe(60_000);
    expect(calls[0]!.max).toBe(100);
  });

  it("child() composes the per-route prefix like the plugin RedisStore", async () => {
    const { client, calls } = makeFakeRedis();
    const store = new RedisRateLimitStore({}, client, RATE_LIMIT_NAMESPACE);
    const child = store.child({
      continueExceeding: false,
      exponentialBackoff: false,
      routeInfo: { method: "POST", url: "/api/auth/login" },
    });
    await new Promise<void>((res) =>
      child.incr("key", () => res(), 60_000, 100),
    );
    expect(calls[0]!.key).toBe("ratelimit:v1:POST/api/auth/login-key");
  });
});

describe("DelegatingRateLimitStore (selection seam)", () => {
  it("ready + optional: delegates to the Redis store", async () => {
    const { client, calls } = makeFakeRedis();
    const runtime = new StubRuntime("optional", true);
    const store = new DelegatingRateLimitStore(
      {},
      runtime,
      client,
      RATE_LIMIT_NAMESPACE,
    );
    const result = await incrOk(store, "k");
    expect(calls).toHaveLength(1);
    expect(result).toEqual({ current: 1, ttl: 60_000 });
    expect(runtime.commandErrors).toBe(0);
  });

  it("degraded + optional: falls back to the local store (no Redis call)", async () => {
    const { client, calls } = makeFakeRedis();
    const runtime = new StubRuntime("optional", false);
    const store = new DelegatingRateLimitStore(
      {},
      runtime,
      client,
      RATE_LIMIT_NAMESPACE,
    );
    const first = await incrOk(store, "k");
    const second = await incrOk(store, "k");
    expect(calls).toHaveLength(0);
    expect(first.current).toBe(1);
    expect(second.current).toBe(2);
  });

  it("optional + Redis command failure: falls back to local and reports the error", async () => {
    const fake = makeFakeRedis();
    const runtime = new StubRuntime("optional", true);
    const store = new DelegatingRateLimitStore(
      {},
      runtime,
      fake.client,
      RATE_LIMIT_NAMESPACE,
    );
    fake.failNext = new Error("ECONNREFUSED");
    const result = await incrOk(store, "k");
    expect(runtime.commandErrors).toBe(1);
    expect(result.current).toBe(1); // local fallback served the request
  });

  it("required + not ready: fails closed with RATE_LIMIT_UNAVAILABLE (no local fallback)", async () => {
    const { client, calls } = makeFakeRedis();
    const runtime = new StubRuntime("required", false);
    const store = new DelegatingRateLimitStore(
      {},
      runtime,
      client,
      RATE_LIMIT_NAMESPACE,
    );
    const result = await incrErr(store, "k");
    expect(calls).toHaveLength(0);
    expect(result.code).toBe(RATE_LIMIT_UNAVAILABLE);
    expect(result.statusCode).toBe(503);
  });

  it("required + ready + Redis command failure: fails closed (never local)", async () => {
    const fake = makeFakeRedis();
    const runtime = new StubRuntime("required", true);
    const store = new DelegatingRateLimitStore(
      {},
      runtime,
      fake.client,
      RATE_LIMIT_NAMESPACE,
    );
    fake.failNext = new Error("ECONNREFUSED");
    const result = await incrErr(store, "k");
    expect(runtime.commandErrors).toBe(1);
    expect(result.code).toBe(RATE_LIMIT_UNAVAILABLE);
  });

  it("recovers to Redis when the runtime becomes ready again", async () => {
    const { client, calls } = makeFakeRedis();
    const runtime = new StubRuntime("optional", false);
    const store = new DelegatingRateLimitStore(
      {},
      runtime,
      client,
      RATE_LIMIT_NAMESPACE,
    );
    await incrOk(store, "k");
    expect(calls).toHaveLength(0);
    runtime.setReady(true);
    await incrOk(store, "k");
    expect(calls).toHaveLength(1);
  });

  it("child() composes the route prefix on the Redis path", async () => {
    const { client, calls } = makeFakeRedis();
    const runtime = new StubRuntime("optional", true);
    const store = new DelegatingRateLimitStore(
      {},
      runtime,
      client,
      RATE_LIMIT_NAMESPACE,
    );
    const child = store.child({
      continueExceeding: false,
      exponentialBackoff: false,
      routeInfo: { method: "GET", url: "/limited" },
    }) as DelegatingRateLimitStore;
    await incrOk(child, "k");
    expect(calls[0]!.key).toBe("ratelimit:v1:GET/limited-k");
  });

  it("mode off (no redis client): local store only", async () => {
    const runtime = new StubRuntime("off", false);
    const store = new DelegatingRateLimitStore(
      {},
      runtime,
      null,
      RATE_LIMIT_NAMESPACE,
    );
    const first = await incrOk(store, "k");
    const second = await incrOk(store, "k");
    expect(first.current).toBe(1);
    expect(second.current).toBe(2);
  });

  it("concurrent incr on the redis path is atomic (single Lua call per request)", async () => {
    const { client, calls } = makeFakeRedis();
    const runtime = new StubRuntime("optional", true);
    const store = new DelegatingRateLimitStore(
      {},
      runtime,
      client,
      RATE_LIMIT_NAMESPACE,
    );
    await Promise.all([
      incrOk(store, "k"),
      incrOk(store, "k"),
      incrOk(store, "k"),
    ]);
    // One INCR+EXPIRE script invocation per request; no JS read-modify-write.
    expect(calls).toHaveLength(3);
    expect(calls.every((c) => c.key === "ratelimit:v1:k")).toBe(true);
    void vi;
  });
});
