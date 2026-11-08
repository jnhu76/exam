import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { buildErrorResponse } from "../lib/errorResponse.js";

/**
 * Canonical unmatched-request response for any Fastify scope (#429/#925):
 * the JSON error envelope with the request's correlation id. One shared
 * implementation so the /api-scoped policy (routes/apiSurface.ts) and the
 * root-scope policy cannot drift apart.
 */
export function sendResourceNotFound(
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  reply.code(404).send(buildErrorResponse(request.id, "RESOURCE_NOT_FOUND"));
}

/**
 * #925 root-scope unmatched-request boundary. WHY it exists: Fastify's
 * default `basic404` logs `Route ${request.raw.url} not found` — persisting
 * raw client-controlled URL bytes (query and path). The deployed edge only
 * forwards /api/**, but direct API access (dev :3000, misrouted proxies)
 * must not regress the login-privacy invariant either.
 *
 * OWNERSHIP: exactly ONE root notFound handler per process. When the static
 * frontend is present, IT owns the root policy (SPA shell fallback; it logs
 * no URL), so register this function only on the API-only layout — see the
 * conditional in server.ts. A second root registration throws fastify's
 * "Not found handler already set".
 */
export function registerRootNotFoundBoundary(app: FastifyInstance): void {
  app.setNotFoundHandler(sendResourceNotFound);
}
