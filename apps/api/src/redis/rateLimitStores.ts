import type Redis from "ioredis";
import { AppError } from "@exam/domain";
import type { RedisMode } from "../config/runtimeConfig.js";

/**
 * The runtime surface the delegating store needs (structural, so tests can
 * stub it; {@link RedisRuntime} satisfies it).
 */
export interface RateLimitRuntimeLike {
  mode: RedisMode;
  shouldUseRedis(): boolean;
  noteRedisCommandError(): void;
}

/** ioredis client extended with the custom rate-limit Lua command. */
interface RateLimitRedisClient extends Redis {
  p7RateLimit(
    key: string,
    timeWindow: number,
    max: number,
    continueExceeding: boolean,
    exponentialBackoff: boolean,
    callback: (err: Error | null, result: [number, number]) => void,
  ): void;
}

/**
 * Rate-limit stores for the shared limiter (P7).
 *
 * The @fastify/rate-limit plugin accepts a custom `store` class implementing
 * `constructor(globalParams)`, `incr(key, cb, timeWindow, max)` and
 * `child(routeOptions)` (the plugin instantiates it as `new Store(params)` and
 * calls `child()` for route-level configuration). This module provides:
 *
 * - `RedisRateLimitStore` — atomic fixed-window counter backed by a single
 *   Lua script (INCR + PEXPIRE/PTTL). Same semantics as the plugin's own
 *   RedisStore; implemented locally so the runtime can own store selection
 *   without deep-importing plugin internals. TTL is mandatory: every key
 *   expires after the window, so no rate-limit key accumulates forever.
 * - `LocalRateLimitStore` — per-process fixed-window counter mirroring the
 *   plugin's in-memory semantics. Used for Redis-off and optional-degraded.
 * - `DelegatingRateLimitStore` — the single selection seam between the two,
 *   driven by {@link RedisRuntime} state. Routes never know Redis exists.
 */

/** Shared workload namespace for rate-limit keys (P7 §12). */
export const RATE_LIMIT_NAMESPACE = "ratelimit:v1:";

/** The canonical structured error code for fail-closed required mode. */
export const RATE_LIMIT_UNAVAILABLE = "RATE_LIMIT_UNAVAILABLE";

/**
 * Store parameters: the plugin passes its merged global/route options. All
 * fields are optional so any option object (or a test stub) satisfies it.
 */
export interface RateLimitStoreParams {
  continueExceeding?: boolean;
  exponentialBackoff?: boolean;
  cache?: number;
  routeInfo?: { method: string; url: string };
}

interface StoreResult {
  current: number;
  ttl: number;
}

type IncrCallback = (err: Error | null, result: StoreResult | null) => void;

interface RateLimitStoreShape {
  incr(key: string, cb: IncrCallback, timeWindow: number, max: number): void;
  child(routeOptions: RateLimitStoreParams): RateLimitStoreShape;
}

/** Atomic INCR + PEXPIRE/PTTL fixed-window counter (mirrors plugin semantics). */
const RATE_LIMIT_LUA = `
  local key = KEYS[1]
  local timeWindow = tonumber(ARGV[1])
  local max = tonumber(ARGV[2])
  local continueExceeding = ARGV[3] == 'true'
  local exponentialBackoff = ARGV[4] == 'true'
  local MAX_SAFE_INTEGER = (2^53) - 1

  local current = redis.call('INCR', key)

  if current == 1 or (continueExceeding and current > max) then
    redis.call('PEXPIRE', key, timeWindow)
  elseif exponentialBackoff and current > max then
    local backoffExponent = current - max - 1
    timeWindow = math.min(timeWindow * (2 ^ backoffExponent), MAX_SAFE_INTEGER)
    redis.call('PEXPIRE', key, timeWindow)
  else
    timeWindow = redis.call('PTTL', key)
  end

  return {current, timeWindow}
`;

/** Keys are prefixed by the ioredis client `keyPrefix` (verified empirically). */
export class RedisRateLimitStore implements RateLimitStoreShape {
  private readonly continueExceeding: boolean;
  private readonly exponentialBackoff: boolean;
  private readonly redis: RateLimitRedisClient;
  private readonly prefix: string;

  constructor(params: RateLimitStoreParams, redis: Redis, prefix: string) {
    this.continueExceeding = params.continueExceeding ?? false;
    this.exponentialBackoff = params.exponentialBackoff ?? false;
    this.redis = redis as RateLimitRedisClient;
    this.prefix = prefix;
    if (!this.redis.p7RateLimit) {
      this.redis.defineCommand("p7RateLimit", {
        numberOfKeys: 1,
        lua: RATE_LIMIT_LUA,
      });
    }
  }

  incr(key: string, cb: IncrCallback, timeWindow: number, max: number): void {
    this.redis.p7RateLimit(
      this.prefix + key,
      timeWindow,
      max,
      this.continueExceeding,
      this.exponentialBackoff,
      (err: Error | null, result: [number, number]) => {
        if (err) {
          cb(err, null);
          return;
        }
        cb(null, { current: result[0], ttl: result[1] });
      },
    );
  }

  child(routeOptions: RateLimitStoreParams): RateLimitStoreShape {
    const route = routeOptions.routeInfo;
    const childPrefix = route
      ? `${this.prefix}${route.method}${route.url}-`
      : this.prefix;
    return new RedisRateLimitStore(routeOptions, this.redis, childPrefix);
  }
}

/**
 * Per-process fixed-window counter (in-memory). Mirrors the plugin's
 * LocalStore semantics: entries expire after `timeWindow` from first hit and
 * TTL counts down; `continueExceeding`/`exponentialBackoff` keep the window
 * behavior identical to the Redis path.
 */
export class LocalRateLimitStore implements RateLimitStoreShape {
  private readonly continueExceeding: boolean;
  private readonly exponentialBackoff: boolean;
  private readonly cacheSize: number;
  private readonly entries = new Map<
    string,
    { current: number; ttl: number; iterationStartMs: number }
  >();

  constructor(params: RateLimitStoreParams) {
    this.continueExceeding = params.continueExceeding ?? false;
    this.exponentialBackoff = params.exponentialBackoff ?? false;
    this.cacheSize = params.cache ?? 5000;
  }

  incr(key: string, cb: IncrCallback, timeWindow: number, max: number): void {
    const nowInMs = Date.now();
    let entry = this.entries.get(key);

    if (!entry) {
      entry = { current: 1, ttl: timeWindow, iterationStartMs: nowInMs };
    } else if (entry.iterationStartMs + timeWindow <= nowInMs) {
      entry.current = 1;
      entry.ttl = timeWindow;
      entry.iterationStartMs = nowInMs;
    } else {
      entry.current += 1;
      if (this.continueExceeding && entry.current > max) {
        entry.ttl = timeWindow;
        entry.iterationStartMs = nowInMs;
      } else if (this.exponentialBackoff && entry.current > max) {
        const exponent = entry.current - max - 1;
        const ttl = timeWindow * 2 ** exponent;
        entry.ttl = Number.isSafeInteger(ttl) ? ttl : Number.MAX_SAFE_INTEGER;
        entry.iterationStartMs = nowInMs;
      } else {
        entry.ttl = timeWindow - (nowInMs - entry.iterationStartMs);
      }
    }

    this.entries.set(key, entry);
    if (this.entries.size > this.cacheSize) {
      // Map preserves insertion order; evict the oldest entry.
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    cb(null, { current: entry.current, ttl: entry.ttl });
  }

  child(routeOptions: RateLimitStoreParams): RateLimitStoreShape {
    // Mirrors the plugin's LocalStore.child: a fresh per-route store; keys
    // are composed by the caller (DelegatingRateLimitStore), so isolation
    // between routes is preserved by the composed key.
    return new LocalRateLimitStore({
      continueExceeding: routeOptions.continueExceeding ?? false,
      exponentialBackoff: routeOptions.exponentialBackoff ?? false,
      cache: routeOptions.cache ?? this.cacheSize,
    });
  }
}

/**
 * The store selection seam (P7 §30): delegates to the Redis store while the
 * runtime is `ready`, to the local store in optional-degraded mode, and fails
 * closed (503 RATE_LIMIT_UNAVAILABLE) in required mode when Redis is not
 * usable — never a silent switch to local counters.
 */
export class DelegatingRateLimitStore implements RateLimitStoreShape {
  private readonly runtime: RateLimitRuntimeLike;
  private readonly redis: Redis | null;
  private readonly redisPrefix: string;
  private readonly redisStore: RedisRateLimitStore | null;
  private readonly localStore: LocalRateLimitStore;

  constructor(
    params: RateLimitStoreParams,
    runtime: RateLimitRuntimeLike,
    redis: Redis | null,
    redisPrefix: string,
  ) {
    this.runtime = runtime;
    this.redis = redis;
    this.redisPrefix = redisPrefix;
    this.redisStore = redis
      ? new RedisRateLimitStore(params, redis, redisPrefix)
      : null;
    this.localStore = new LocalRateLimitStore(params);
  }

  incr(key: string, cb: IncrCallback, timeWindow: number, max: number): void {
    if (this.redisStore && this.runtime.shouldUseRedis()) {
      this.redisStore.incr(
        key,
        (err, result) => {
          if (err) {
            this.runtime.noteRedisCommandError();
            if (this.runtime.mode === "required") {
              cb(this.backendUnavailableError(), null);
            } else {
              this.localStore.incr(key, cb, timeWindow, max);
            }
            return;
          }
          cb(null, result);
        },
        timeWindow,
        max,
      );
      return;
    }

    if (this.runtime.mode === "required") {
      // Required + Redis not ready: fail closed. Requests are rejected rather
      // than passing through unthrottled or switching to local counters.
      cb(this.backendUnavailableError(), null);
      return;
    }

    this.localStore.incr(key, cb, timeWindow, max);
  }

  child(routeOptions: RateLimitStoreParams): RateLimitStoreShape {
    // Same key composition as the plugin's RedisStore.child:
    // `${prefix}${method}${url}-` per route.
    const route = routeOptions.routeInfo;
    const childPrefix = route
      ? `${this.redisPrefix}${route.method}${route.url}-`
      : this.redisPrefix;
    return new DelegatingRateLimitStore(
      routeOptions,
      this.runtime,
      this.redis,
      childPrefix,
    );
  }

  private backendUnavailableError(): AppError {
    return new AppError(
      "Rate limiting backend unavailable",
      RATE_LIMIT_UNAVAILABLE,
      503,
    );
  }
}
