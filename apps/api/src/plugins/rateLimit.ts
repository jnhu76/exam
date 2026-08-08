import { FastifyPluginAsync, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import rateLimit, {
  type FastifyRateLimitOptions,
  type FastifyRateLimitStore,
  type FastifyRateLimitStoreCtor,
} from "@fastify/rate-limit";
import { AppError } from "@exam/domain";
import { getRuntimeConfig } from "../config/runtimeConfig.js";
import { createRateLimitKey } from "../redis/rateLimitKey.js";
import {
  DelegatingRateLimitStore,
  RATE_LIMIT_NAMESPACE,
  type RateLimitStoreParams,
} from "../redis/rateLimitStores.js";
import { RedisRuntime } from "../redis/redisRuntime.js";

/**
 * Checks whether the incoming request targets the API reference UI path.
 * When the API reference feature is enabled, requests to its UI path
 * are exempted from rate limiting.
 */
function isApiReferenceRequest(request: FastifyRequest): boolean {
  const config = getRuntimeConfig();
  if (!config.apiReference.enabled) {
    return false;
  }
  const uiPath = config.apiReference.uiPath;
  const url = request.url ?? "";
  const pathOnly = url.split("?", 1)[0] ?? "";
  return pathOnly === uiPath || pathOnly.startsWith(`${uiPath}/`);
}

/**
 * Fastify plugin that registers IP-based rate limiting when enabled in
 * runtime config. API reference UI requests are excluded from the limit.
 * Returns a structured `AppError` with code `RATE_LIMITED` when the
 * limit is exceeded.
 *
 * Store selection (P7): the plugin registers a {@link DelegatingRateLimitStore}
 * so the limiter uses the shared Redis store while the Redis runtime is
 * `ready`, the local in-memory store when Redis is off or degraded in
 * `optional` mode, and fails closed (503 RATE_LIMIT_UNAVAILABLE) in
 * `required` mode when Redis is unusable. Routes never know Redis exists;
 * the HTTP contract (RATE_LIMITED) is unchanged.
 */
const rateLimitPlugin: FastifyPluginAsync = async (fastify) => {
  const config = getRuntimeConfig();
  if (!config.rateLimit.enabled) {
    return;
  }

  const runtime: RedisRuntime = fastify.redisRuntime ?? RedisRuntime.disabled();
  const secret = config.authSecret.jwtSecret;

  /**
   * The plugin instantiates the store as `new Store(globalParams)` and calls
   * `child(routeOptions)` for route-level configuration; the closure binds
   * the runtime, client, and namespace at registration time.
   */
  class DelegatingStore implements FastifyRateLimitStore {
    private readonly delegate: DelegatingRateLimitStore;

    constructor(
      options: FastifyRateLimitOptions,
      delegate?: DelegatingRateLimitStore,
    ) {
      this.delegate =
        delegate ??
        new DelegatingRateLimitStore(
          options as RateLimitStoreParams,
          runtime,
          runtime.client,
          RATE_LIMIT_NAMESPACE,
        );
    }

    incr(
      key: string,
      callback: (
        error: Error | null,
        result?: { current: number; ttl: number },
      ) => void,
      timeWindow = 60_000,
      max = 100,
    ): void {
      this.delegate.incr(
        key,
        (err, result) => callback(err, result ?? undefined),
        timeWindow,
        max,
      );
    }

    child(routeOptions: FastifyRateLimitOptions): FastifyRateLimitStore {
      // The plugin merges `routeInfo` into the child params at runtime; the
      // plugin's declared type does not carry it, so cast to the runtime
      // shape. The delegate composes `${prefix}${method}${url}-` per route
      // and always returns a DelegatingRateLimitStore instance.
      const child = this.delegate.child(
        routeOptions as RateLimitStoreParams,
      ) as DelegatingRateLimitStore;
      return new DelegatingStore(routeOptions, child);
    }
  }

  fastify.register(rateLimit, {
    max: config.rateLimit.max,
    timeWindow: config.rateLimit.timeWindow,
    store: DelegatingStore as FastifyRateLimitStoreCtor,
    keyGenerator(request: FastifyRequest) {
      // Stable opaque digest of the IP — raw IPs never enter the shared
      // Redis keyspace (P7 §13).
      return createRateLimitKey(request, secret);
    },
    allowList(request: FastifyRequest) {
      return isApiReferenceRequest(request);
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
