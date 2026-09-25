import type { FastifyPluginAsync } from "fastify";
import rateLimitPlugin from "../plugins/rateLimit.js";
import {
  buildReadinessProbeDeps,
  probeApplicationReadiness,
} from "../plugins/operabilityMonitor.js";
import { z } from "zod";
import { ErrorResponseSchema } from "@exam/contracts";
import { buildErrorResponse } from "../lib/errorResponse.js";
import { healthResponseSchema, readyResponseSchema } from "./healthSchema.js";
import { registerApiRouteModules } from "./registerApiRouteModules.js";

/**
 * The single Fastify scope that owns the whole /api namespace.
 *
 * ROUTER OWNS ROUTING SEMANTICS: Fastify/find-my-way decides whether a
 * request belongs to the /api namespace. For registered routes the main
 * router matches them; for unmatched requests the /api-scoped
 * `setNotFoundHandler` lives as a route (`/api` + `/api/*`) in Fastify's
 * internal 404 router, which applies the exact same find-my-way URL
 * semantics. There is no application-side path parsing anywhere.
 *
 * APPLICATION OWNS RESPONSE POLICY: this plugin only supplies the canonical
 * API JSON 404 for requests the router classified as /api but matched to no
 * route. It never parses, decodes, inspects, or classifies request URLs.
 *
 * INVARIANT (#429): every /api route AND the /api unmatched policy live in
 * this one encapsulated scope — there is no second routing authority. The
 * plugin must be registered with `{ prefix: "/api" }` on the root instance
 * (never wrapped in fastify-plugin: its purpose is the prefix
 * encapsulation).
 *
 * RATE LIMIT IS AN API CONCERN: the rate-limit plugin is registered here —
 * before any route — so the limiter covers exactly the /api surface by
 * encapsulation and the docs/web surfaces never enter it (no allow-list,
 * no URL inspection).
 *
 * REGISTRATION ORDER: route modules call auth/authz decorators (e.g.
 * `fastify.requireCapability(...)`) at registration time, so this plugin
 * must be registered AFTER the root infrastructure plugins (auth, authz,
 * db, ...) and BEFORE the static frontend fallback.
 */
const apiSurfacePlugin: FastifyPluginAsync = async (api) => {
  // Rate limiting first: its onRoute hook must run before any route in this
  // scope registers so per-route `config.rateLimit` overrides are observed.
  await api.register(rateLimitPlugin);

  // GET /health — public liveness probe. External contract: GET /api/health.
  api.get(
    "/health",
    {
      schema: {
        response: {
          200: healthResponseSchema,
        },
      },
    },
    async () => ({ status: "ok" }),
  );

  // GET /ready — public DEPLOYMENT READINESS gate (#547). Liveness above
  // stays dependency-blind; this route answers whether the instance's
  // MANDATORY serving dependencies (PostgreSQL; Redis only when
  // REDIS_MODE=required) are currently usable, via the single
  // probeApplicationReadiness derivation shared with the operability alert
  // transitions. When the HANDLER runs, the body carries only the gate
  // answer — no dependency names, latency, or error detail. The route stays
  // under the default /api rate-limit policy (the anti-amplification bound;
  // the Compose healthcheck cadence can never self-429).
  //
  // TWO 503 SHAPES (deliberate; both mean "not ready" to a probe):
  //   1. handler reached → {status:"not_ready"} (the gate body);
  //   2. REDIS_MODE=required and the limiter's Redis backend is unusable →
  //      the limiter fails CLOSED before this handler with the standard API
  //      error envelope (RATE_LIMIT_UNAVAILABLE). The 503 schema is therefore
  //      a UNION of both shapes — declaring only the gate body would make
  //      Fastify serialize-reject the envelope and mask the outage as a 500
  //      (regression-pinned in readiness.test.ts; scoped in 01-semantics §3).
  api.get(
    "/ready",
    {
      schema: {
        response: {
          200: readyResponseSchema,
          503: z.union([readyResponseSchema, ErrorResponseSchema]),
        },
      },
    },
    async (_request, reply) => {
      const readiness = await probeApplicationReadiness(
        buildReadinessProbeDeps(api),
      );
      if (!readiness.ready) {
        return reply.code(503).send({ status: "not_ready" });
      }
      return { status: "ready" };
    },
  );

  await registerApiRouteModules(api);

  // Canonical unmatched-request policy for the /api namespace (#429): any
  // request the router classifies as /api without a matching route stays in
  // the JSON error boundary — never HTML, never the static/SPA fallback.
  api.setNotFoundHandler((request, reply) => {
    reply.code(404).send(buildErrorResponse(request.id, "RESOURCE_NOT_FOUND"));
  });
};

export default apiSurfacePlugin;
