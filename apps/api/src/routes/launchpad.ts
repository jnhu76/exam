import type { FastifyPluginAsync } from "fastify";
import { timingSafeEqual } from "node:crypto";
import {
  ErrorResponseSchema,
  LaunchpadBootstrapRequestSchema,
  LaunchpadBootstrapResponseSchema,
  LaunchpadStatusResponseSchema,
} from "@exam/contracts";
import { buildErrorResponse } from "../lib/errorResponse.js";
import {
  bootstrapInitialAdminWithLock,
  isInstallationFresh,
  InstallationAlreadyCompletedError,
} from "../services/initialSetupService.js";

/**
 * P7-C1 C1.6 — Launchpad first-install handoff routes.
 *
 * Mounts under /api/launchpad. Two routes:
 *   GET  /status   — minimal state probe for the /launchpad page.
 *   POST /bootstrap — create the first Admin (operator→business-admin handoff).
 *
 * Invariant: usable ONLY when (a) LAUNCHPAD_SETUP_TOKEN is configured AND (b)
 * the deployment is genuinely fresh (no org AND no user has ever existed).
 * Once initialized, permanently COMPLETED — never reopens, even if all Admins
 * are later removed (no privilege takeover). `/register` stays 403 forever;
 * the launchpad is the supported first-install path, not a reopening of
 * public self-registration.
 */

/**
 * Constant-time equality check for two secret strings. Returns false when the
 * lengths differ (length is not secret for a setup token, but we avoid the
 * early-return timing channel anyway by comparing uniformly). The token is
 * never written to audit/log.
 */
function tokensMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // Still do a comparison of equal length to keep timing uniform.
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

const launchpadRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /status — return the launchpad state for the /launchpad page.
   *
   * Returns ONLY the state (READY / OPERATOR_ACTIVATION_REQUIRED / COMPLETED);
   * no organization ids, admin counts, or database details (minimal info
   * surface). The setup token presence is reported only as a boolean-ish
   * state, never the token value itself.
   */
  fastify.get(
    "/status",
    {
      schema: {
        response: {
          200: LaunchpadStatusResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const fresh = await isInstallationFresh(fastify.db);
      if (!fresh) {
        return reply.code(200).send({ state: "COMPLETED" });
      }
      const tokenConfigured = !!process.env.LAUNCHPAD_SETUP_TOKEN;
      return reply.code(200).send({
        state: tokenConfigured ? "READY" : "OPERATOR_ACTIVATION_REQUIRED",
      });
    },
  );

  /**
   * POST /bootstrap — create the first Admin (operator→business-admin handoff).
   *
   * Validates the setup token (constant-time), re-checks installation-fresh,
   * then runs the canonical bootstrap under a transaction-scoped advisory
   * lock (P2-5 single-winner). Returns 201 + minimal identity; does NOT
   * auto-login (bootstrap authority and authentication stay separate — the
   * new Admin proceeds to /login).
   *
   * Rate-limited like the login route to blunt token-guessing.
   */
  fastify.post(
    "/bootstrap",
    {
      config: { rateLimit: { max: 10, timeWindow: 60 * 1000 } },
      schema: {
        body: LaunchpadBootstrapRequestSchema,
        response: {
          201: LaunchpadBootstrapResponseSchema,
          403: ErrorResponseSchema,
          409: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const data = LaunchpadBootstrapRequestSchema.parse(request.body);

      const configuredToken = process.env.LAUNCHPAD_SETUP_TOKEN;
      if (!configuredToken) {
        // No setup token configured → the operator has not activated the
        // launchpad. Refuse (the page should show OPERATOR_ACTIVATION_REQUIRED
        // and never POST, but defend in depth).
        return reply
          .code(403)
          .send(buildErrorResponse(request.id, "LAUNCHPAD_SETUP_REQUIRED"));
      }
      if (!tokensMatch(data.setupToken, configuredToken)) {
        // Constant-time mismatch. Do NOT reveal which field is wrong.
        return reply
          .code(403)
          .send(
            buildErrorResponse(request.id, "LAUNCHPAD_SETUP_TOKEN_INVALID"),
          );
      }

      // Re-check freshness BEFORE acquiring the lock (fast-fail for the
      // already-completed case; the lock-protected re-check handles the race).
      const fresh = await isInstallationFresh(fastify.db);
      if (!fresh) {
        return reply
          .code(409)
          .send(buildErrorResponse(request.id, "LAUNCHPAD_ALREADY_COMPLETED"));
      }

      try {
        const result = await bootstrapInitialAdminWithLock(
          fastify.db,
          {
            username: data.username,
            password: data.password,
            name: data.name,
          },
          {
            organizationName: data.organizationName,
            ...(data.organizationDisplayName
              ? { organizationDisplayName: data.organizationDisplayName }
              : {}),
          },
        );
        return reply.code(201).send({
          organizationName: result.organization.name,
          username: result.user.username,
        });
      } catch (error) {
        if (error instanceof InstallationAlreadyCompletedError) {
          // Lost the race: another bootstrap completed concurrently.
          return reply
            .code(409)
            .send(
              buildErrorResponse(request.id, "LAUNCHPAD_ALREADY_COMPLETED"),
            );
        }
        throw error;
      }
    },
  );
};

export default launchpadRoutes;
