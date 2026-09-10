import type { FastifyPluginAsync } from "fastify";
import { buildErrorResponse } from "../lib/errorResponse.js";
import { healthResponseSchema } from "./healthSchema.js";
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
 */
const apiSurfacePlugin: FastifyPluginAsync = async (api) => {
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

  await registerApiRouteModules(api);

  // Canonical unmatched-request policy for the /api namespace (#429): any
  // request the router classifies as /api without a matching route stays in
  // the JSON error boundary — never HTML, never the static/SPA fallback.
  api.setNotFoundHandler((request, reply) => {
    reply.code(404).send(buildErrorResponse(request.id, "RESOURCE_NOT_FOUND"));
  });
};

export default apiSurfacePlugin;
