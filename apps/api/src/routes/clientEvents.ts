import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  ClientEventBatchSchema,
  sanitizeClientEvent,
  type ClientEventBatchResponse,
} from "@exam/contracts";
import { createClientEventRepo } from "@exam/db/src/repository/clientEventRepo.js";
import { getRequestContext } from "./helpers.js";

/**
 * Maximum length of the persisted `user_agent` column. Browsers can send
 * very long UA strings; truncate to keep storage bounded.
 */
const USER_AGENT_MAX_LENGTH = 500;

/** Local response schema — the request body schema lives in contracts. */
const clientEventBatchResponseSchema = z.object({
  accepted: z.number().int().min(0),
});

/**
 * Fastify plugin that registers the client-event ingestion route.
 *
 * `POST /client-events` accepts a validated batch of frontend observability
 * events. The route requires an authenticated user (Admin or Candidate) but
 * performs no role gating — both roles may report their own events. The
 * server is the source of truth for tenant identity and receive time:
 *
 * - `organizationId` and `userId` come from the authenticated `request.ctx`,
 *   never from the payload.
 * - `receivedAt` is stamped server-side; `occurredAt` (client-reported) is
 *   preserved as the event instant but never used for receive ordering.
 * - `attemptId` is accepted as opaque telemetry only. Per the spec we do not
 *   treat it as an authorization handle — verifying per-attempt ownership
 *   is out of scope for this infra layer and would require attempt-loading
 *   capability the route does not have. The org/user boundary is the guard.
 */
const clientEventRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * POST /client-events
   *
   * Body: {@link ClientEventBatchSchema}. Response: `{ accepted: number }`.
   * Returns 401 if unauthenticated (via the `authenticate` preHandler) and
   * 400 with the standard error envelope if the body fails schema validation
   * (via the Zod type provider + global error handler).
   */
  fastify.post(
    "/client-events",
    {
      preHandler: [fastify.authenticate],
      schema: {
        body: ClientEventBatchSchema,
        response: { 200: clientEventBatchResponseSchema },
      },
    },
    async (request): Promise<ClientEventBatchResponse> => {
      const ctx = getRequestContext(request);
      // Re-parse defensively so handler logic gets a typed value regardless
      // of the provider's runtime inference; matches the course/exam route
      // convention. The provider already rejected invalid bodies with 400.
      const { events } = ClientEventBatchSchema.parse(request.body);

      const receivedAt = fastify.now();
      const rawUserAgent = request.headers["user-agent"];
      const userAgent =
        typeof rawUserAgent === "string"
          ? rawUserAgent.slice(0, USER_AGENT_MAX_LENGTH)
          : null;

      const inserted = await createClientEventRepo(fastify.db).createMany(
        ctx,
        events.map((event) => ({
          userId: ctx.actorId,
          attemptId: event.attemptId ?? null,
          examId: event.examId ?? null,
          questionId: event.questionId ?? null,
          kind: event.kind,
          level: event.level,
          name: event.name,
          route: event.route ?? null,
          occurredAt: new Date(event.occurredAt),
          receivedAt,
          clientSessionId: event.clientSessionId ?? null,
          // Defense-in-depth: re-sanitize server-side so a malicious client
          // that bypassed (or skipped) client-side redaction cannot persist
          // credentials or exam content. The shared implementation in
          // @exam/contracts is the single source of truth.
          metadata: sanitizeClientEvent(event.metadata),
          userAgent,
        })),
      );

      return { accepted: inserted };
    },
  );
};

export default clientEventRoutes;
