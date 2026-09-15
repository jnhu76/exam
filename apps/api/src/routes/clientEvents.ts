import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  ClientEventBatchSchema,
  ErrorResponseSchema,
  sanitizeClientEvent,
  type ClientEventBatchResponse,
} from "@exam/contracts";
import { createClientEventRepo } from "@exam/db/src/repository/clientEventRepo.js";
import { normalizeClientEventReferences } from "../lib/clientEventReferenceNormalizer.js";
import { getRequestContext } from "./helpers.js";

/** OpenAPI security scheme requiring cookie-based authentication. */
const cookieAuth = [{ cookieAuth: [] }] as const;

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
 * events. The route is AUTHENTICATE-ONLY (every authenticated role may report
 * its own events; there is no role gate — see the intentional
 * authenticate-only set in routeRegistryConformanceWholeApp.test.ts). It is
 * self-service LOW-TRUST telemetry (#544): authentication proves who sent the
 * event, never that the event's content or resource references are true.
 *
 * Trust semantics:
 *
 * - `organizationId` and `userId` come from the authenticated `request.ctx`,
 *   never from the payload; `receivedAt` is stamped server-side and is the
 *   sole ordering/lifecycle authority. `occurredAt` (client-asserted) is
 *   stored as an advisory display instant and never orders anything.
 * - `kind` is a client-provided classification label, NOT provenance:
 *   `kind == "proctor"` carries no extra trust.
 * - `attemptId` / `examId` / `questionId` are persisted only when
 *   {@link normalizeClientEventReferences} can prove the claimed relationship
 *   for the actor (org + candidate ownership, frozen exam question set);
 *   unprovable references are NULLed silently while the event stays accepted.
 *   The response is always `{ accepted: <batch size> }` — no existence oracle.
 * - These events are advisory inputs (debugging, operational observation,
 *   proctor attention UI). They are never, alone, an incident / violation /
 *   punishment / score / attempt-state / deadline authority.
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
        security: cookieAuth,
        response: {
          200: clientEventBatchResponseSchema,
          401: ErrorResponseSchema,
        },
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

      // Reference trust boundary (#544): prove or NULLIFY the client-asserted
      // attempt/exam/question references before persisting. Event acceptance
      // is unconditional for schema-valid events, so the accepted count never
      // leaks whether a reference existed or was owned.
      const references = await normalizeClientEventReferences(
        fastify.db,
        ctx,
        events,
      );

      const inserted = await createClientEventRepo(fastify.db).createMany(
        ctx,
        events.map((event, i) => ({
          userId: ctx.actorId,
          attemptId: references[i]!.attemptId,
          examId: references[i]!.examId,
          questionId: references[i]!.questionId,
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
