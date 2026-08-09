import { FastifyPluginAsync } from "fastify";
import { timingSafeEqual } from "node:crypto";
import {
  LaunchpadStatusResponseSchema,
  LaunchpadBootstrapRequestSchema,
  LaunchpadBootstrapResponseSchema,
  ErrorResponseSchema,
} from "@exam/contracts";
import { createOrganizationRepo } from "@exam/db/src/repository/organizationRepo.js";
import { bootstrapAdminOnFreshDb } from "../scripts/bootstrap-admin.js";
import { getRuntimeConfig } from "../config/runtimeConfig.js";
import { buildErrorResponse } from "../lib/errorResponse.js";

/**
 * Constant-time equality check for two secret strings.
 *
 * Compares the UTF-8 byte representations only after confirming equal
 * length, so a caller cannot learn the configured token length from a
 * timing side channel. Returns false (not throw) on length mismatch —
 * `crypto.timingSafeEqual` throws on Buffer length mismatch, so we guard
 * it and return false instead to keep the call site branch-free on the
 * secret.
 */
function constantTimeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");
  if (aBuf.length !== bBuf.length) {
    // Still do a comparison to keep wall-clock time independent of length.
    timingSafeEqual(bBuf, bBuf);
    return false;
  }
  return timingSafeEqual(aBuf, bBuf);
}

/**
 * Fastify plugin that registers the launchpad first-install routes.
 *
 * Launchpad is INITIAL INSTALLATION ONLY: it creates the first Admin and
 * the internal default organization. It is NOT signup, NOT login, and NOT
 * Admin recovery. Once the installation is initialized (the default
 * organization exists), launchpad bootstrap is refused and the status
 * endpoint redirects behavior to the normal login flow. Removing/disabling
 * the last Admin does NOT reopen launchpad — Admin-loss recovery is
 * operator CLI territory.
 *
 * The canonical mutation body is `bootstrapAdminOnFreshDb`, shared with the
 * `bootstrap-admin` CLI (P6-008): organization + Admin + primary Admin role
 * assignment + `admin.bootstrap` audit commit atomically in one
 * transaction. The HTTP adapter is a thin shim that performs the
 * installation-initialized gate and setup-token check before delegating to
 * that canonical body — it does NOT duplicate the irreversible mutation
 * logic.
 *
 * Setup-token contract (P7-C1):
 *   - high entropy (operator-generated, e.g. `openssl rand -hex 32`)
 *   - body only, never URL — validated from the JSON request body
 *   - never audit-logged in plaintext (the audit row written by the
 *     canonical body carries username/name/source only, not the token)
 *   - rate limited (max 5 attempts / minute per IP)
 *   - a completed installation MUST NOT become a token-validity oracle:
 *     the installation-initialized check runs FIRST; once initialized,
 *     bootstrap returns 409 regardless of whether the token is correct
 */
const launchpadRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * Internal helper: is this installation initialized? Returns true once the
   * internal default organization (slug "default") exists. This is the
   * FIRST-INSTALL gate only — it is deliberately NOT `activeAdminCount == 0`
   * (removing the last Admin must not reopen launchpad). Delegates to the
   * organization repository so the route never imports DB schema directly
   * (architecture lint: routes use repositories, not raw queries).
   */
  async function isInstallationInitialized(): Promise<boolean> {
    return createOrganizationRepo(fastify.db).defaultOrganizationExists();
  }

  fastify.get(
    "/launchpad/status",
    {
      schema: {
        response: {
          200: LaunchpadStatusResponseSchema,
        },
      },
    },
    /**
     * GET /launchpad/status — public installation-status probe.
     *
     * Reveals only whether the installation has been initialized (the
     * default organization exists). This is NOT a token-validity oracle
     * and never reveals token state. The frontend uses it to decide
     * whether to render the first-Admin setup form or redirect to /login.
     */
    async () => {
      const initialized = await isInstallationInitialized();
      return { initialized };
    },
  );

  fastify.post(
    "/launchpad/bootstrap",
    {
      config: { rateLimit: { max: 5, timeWindow: 60 * 1000 } },
      schema: {
        body: LaunchpadBootstrapRequestSchema,
        response: {
          200: LaunchpadBootstrapResponseSchema,
          403: ErrorResponseSchema,
          409: ErrorResponseSchema,
        },
      },
    },
    /**
     * POST /launchpad/bootstrap — first-Admin setup (first-install only).
     *
     * Ordering is security-critical:
     *   1. Check installation NOT initialized FIRST. If already initialized,
     *      return 409 without distinguishing token validity — a completed
     *      installation must not become a token-validation oracle.
     *   2. Constant-time compare the body setupToken against the configured
     *      token. An unset/empty configured token means launchpad is
     *      disabled → 403.
     *   3. Delegate to the canonical `bootstrapAdminOnFreshDb` atomic
     *      mutation body (shared with the bootstrap-admin CLI).
     *
     * The role is NOT selectable: the server always creates role = Admin.
     */
    async (request, reply) => {
      const data = LaunchpadBootstrapRequestSchema.parse(request.body);

      // 1. Installation-initialized gate FIRST (no token oracle).
      const initialized = await isInstallationInitialized();
      if (initialized) {
        return reply
          .code(409)
          .send(
            buildErrorResponse(request.id, "LAUNCHPAD_ALREADY_INITIALIZED"),
          );
      }

      // 2. Setup-token check (constant-time; disabled if unset/empty).
      const configuredToken = getRuntimeConfig().launchpad.setupToken;
      if (
        !configuredToken ||
        !constantTimeEqual(data.setupToken, configuredToken)
      ) {
        return reply
          .code(403)
          .send(
            buildErrorResponse(request.id, "LAUNCHPAD_INVALID_SETUP_TOKEN"),
          );
      }

      // 3. Canonical atomic mutation (org + Admin + assignment + audit in
      //    one transaction). Refuses a second active Admin internally.
      const orgOptions: {
        organizationName: string;
        organizationDisplayName?: string;
      } = { organizationName: data.organizationName };
      if (data.organizationDisplayName) {
        orgOptions.organizationDisplayName = data.organizationDisplayName;
      }
      const result = await bootstrapAdminOnFreshDb(
        fastify.db,
        {
          username: data.adminUsername,
          password: data.adminPassword,
          name: data.adminName,
        },
        orgOptions,
      );

      return {
        ok: true as const,
        organizationSlug: result.organization.slug,
        adminUsername: result.user.username,
      };
    },
  );
};

export default launchpadRoutes;
