import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import fp from "fastify-plugin";
import { verifyJWT, deriveSessionId } from "@exam/auth/src/session.js";
import type { Role, Permission } from "@exam/domain";
import { type PermissionKey } from "@exam/authz";
import { createUserRepo } from "@exam/db/src/repository/userRepo.js";
import { buildErrorResponse } from "../lib/errorResponse.js";
import { getRuntimeConfig } from "../config/runtimeConfig.js";
import type { AuthzPreHandler } from "../types/fastify-auth.d.js";
import type { RuntimeRequestContext } from "../types/requestContext.js";
import {
  loadAssignmentAuthority,
  type AssignmentAuthorityFailureReason,
} from "../authz/assignmentAuthority.js";

/**
 * Dependency-injection seam for the assignment authority loader (RBAC-M10-E,
 * P1-5). Production wires the real {@link loadAssignmentAuthority}; tests
 * inject a throwing stub to prove `authenticate` fails closed end-to-end
 * (E14) without falling back to `users.role`.
 */
export type LoadAssignmentAuthorityFn = typeof loadAssignmentAuthority;

/** Reasons that map to 401 (the actor is genuinely not authorized). */
const AUTHORITY_401_REASONS = new Set<AssignmentAuthorityFailureReason>([
  "no_active_assignments",
]);

/**
 * Fastify plugin that registers authentication and authorization decorators
 * on the Fastify instance. Provides {@link authenticate} for JWT-based
 * request authentication and {@link requireCapability}/{@link requireRole}
 * for route-level authorization guards.
 *
 * `authenticate` resolves the actor's authority from ACTIVE
 * `user_role_assignments` rows (RBAC-M10-E) — NOT from `users.role` or the
 * JWT `role` claim. The JWT claim is telemetry only. All integrity / DB
 * failures fail closed; none fall back to `users.role`.
 */
export interface AuthPluginOptions {
  /** Override the assignment authority loader (test seam; default: real). */
  loadAssignmentAuthority?: LoadAssignmentAuthorityFn;
}

export function buildAuthPlugin(
  options: AuthPluginOptions = {},
): FastifyPluginAsync {
  const loadAuthority =
    options.loadAssignmentAuthority ?? loadAssignmentAuthority;
  const authPlugin: FastifyPluginAsync = async (fastify) => {
    const jwtSecret = getRuntimeConfig().authSecret.jwtSecret;
    /**
     * Pre-handler that authenticates a request via the `auth-token` cookie.
     * Verifies the JWT, loads the user from the database, resolves the
     * assignment-backed authority, and populates `request.ctx`. Replies 401
     * on missing/invalid token, inactive user, or no active assignment;
     * 503 AUTHZ_UNAVAILABLE on DB / authority-integrity failure (never 401
     * for an operational failure — that would hide an authz-system outage).
     */
    const authenticateFn = async (
      request: FastifyRequest,
      reply: FastifyReply,
    ) => {
      let token: string | undefined;
      try {
        token = request.cookies["auth-token"];
        if (!token) {
          return reply
            .code(401)
            .send(buildErrorResponse(request.id, "AUTH_REQUIRED"));
        }
      } catch {
        return reply
          .code(401)
          .send(buildErrorResponse(request.id, "AUTH_REQUIRED"));
      }

      let payload: Awaited<ReturnType<typeof verifyJWT>>;
      try {
        payload = verifyJWT(token, jwtSecret);
      } catch {
        return reply
          .code(401)
          .send(buildErrorResponse(request.id, "AUTH_REQUIRED"));
      }

      let user: Awaited<
        ReturnType<ReturnType<typeof createUserRepo>["findByOrganizationAndId"]>
      >;
      try {
        user = await createUserRepo(fastify.db).findByOrganizationAndId(
          {
            actorId: payload.actorId,
            organizationId: payload.organizationId,
            role: payload.role,
            permissions: [],
            sessionId: "",
          },
          payload.actorId,
        );
      } catch (err) {
        fastify.log.error(
          { err, actorId: payload.actorId },
          "Database error during authentication",
        );
        return reply
          .code(500)
          .send(buildErrorResponse(request.id, "INTERNAL_ERROR"));
      }

      if (!user?.isActive) {
        return reply
          .code(401)
          .send(buildErrorResponse(request.id, "AUTH_REQUIRED"));
      }

      // RBAC-M10-E: resolve the authoritative runtime authority from ACTIVE
      // user_role_assignments. users.role / JWT role are NO LONGER
      // authoritative — they are compatibility projections only.
      const lookupCtx = {
        actorId: user.id,
        organizationId: user.organizationId,
        role: user.role as Role,
        permissions: [] as Permission[],
        sessionId: "",
      };
      let authority: Awaited<ReturnType<LoadAssignmentAuthorityFn>>;
      try {
        authority = await loadAuthority(fastify.db, lookupCtx, user.id);
      } catch (err) {
        // The loader threw (unexpected failure). Treat identically to an
        // operational / integrity failure: 503, never masquerade as 401,
        // never fall back to users.role (E14 / P1-3 / ADR §3.9).
        fastify.log.error(
          { err, actorId: user.id },
          "authenticate: assignment authority loader threw — fail closed",
        );
        return reply
          .code(503)
          .send(buildErrorResponse(request.id, "AUTHZ_UNAVAILABLE"));
      }
      if (!authority.ok) {
        // 401: the actor is genuinely not authorized (no active assignment).
        // 503: an operational / integrity failure — never masquerade as auth
        // failure, never fall back to users.role (P1-3 / ADR §3.9).
        if (AUTHORITY_401_REASONS.has(authority.reason)) {
          fastify.log.warn(
            { actorId: user.id, reason: authority.reason },
            "authenticate: no active assignment authority — deny login",
          );
          return reply
            .code(401)
            .send(buildErrorResponse(request.id, "AUTH_REQUIRED"));
        }
        fastify.log.error(
          { actorId: user.id, reason: authority.reason },
          "authenticate: assignment authority resolution failed — fail closed",
        );
        return reply
          .code(503)
          .send(buildErrorResponse(request.id, "AUTHZ_UNAVAILABLE"));
      }

      const ctx: RuntimeRequestContext = {
        actorId: user.id,
        organizationId: user.organizationId,
        role: authority.authority.primaryRole as Role,
        roles: authority.authority.activeRoles,
        capabilities: authority.authority.capabilities,
        // Legacy compatibility slot; documented non-authoritative. No
        // production authz decision reads it.
        permissions: [],
        sessionId: deriveSessionId(token),
      };
      request.ctx = ctx;

      // Drift telemetry ONLY: the JWT role claim is advisory. A mismatch must
      // NEVER widen access (it cannot — capabilities come from assignments,
      // not the claim). Logged at debug so staging can spot stale sessions.
      if (payload.role && payload.role !== authority.authority.primaryRole) {
        request.log.debug(
          {
            actorId: user.id,
            jwtRole: payload.role,
            assignmentPrimary: authority.authority.primaryRole,
          },
          "auth.role_drift: JWT role claim differs from assignment primary (non-authoritative)",
        );
      }

      request.log = request.log.child({
        actorId: user.id,
        actorRole: authority.authority.primaryRole,
        organizationId: user.organizationId,
      });
    };

    Object.assign(authenticateFn, { _isAuthenticate: true });
    fastify.decorate("authenticate", authenticateFn);

    /**
     * Returns a pre-handler that checks whether the authenticated actor's role
     * is one of the allowed roles. Replies 401 if no context is present, or
     * 403 if the role is not in the allowed list.
     *
     * Tagged with `_isRequireRole: true` so conformance tests can distinguish a
     * legacy role gate from a capability gate by reference identity / marker
     * (mirroring the existing `_isAuthenticate` pattern). M10-B routes must NOT
     * carry a role gate; the conformance test asserts this is zero.
     */
    fastify.decorate("requireRole", (roles: Role[]) => {
      const handler = async (request: FastifyRequest, reply: FastifyReply) => {
        const ctx = request.ctx;
        if (!ctx) {
          return reply
            .code(401)
            .send(buildErrorResponse(request.id, "AUTH_REQUIRED"));
        }

        if (!roles.includes(ctx.role)) {
          return reply
            .code(403)
            .send(buildErrorResponse(request.id, "PERMISSION_DENIED"));
        }
      };
      Object.assign(handler, { _isRequireRole: true, _allowedRoles: roles });
      return handler;
    });

    // NOTE: the dead legacy `requirePermission` decorator was removed in P4-C1.
    // It had zero route consumers (verified: `rg fastify.requirePermission\(`)
    // and read only `ctx.permissions`, which is `[]` on every runtime context.
    // The authoritative capability gate is `requireCapability` below
    // (`ctx.capabilities`). See docs/audits/P4-C1-AUTHORIZATION-RESIDUE-CLEANUP.md.
    // The legacy `requireRole` decorator is retained solely as the test-fixture
    // seam for the whole-app zero-requireRole regression lock's negative
    // control (it lets the conformance test prove the classifier detects a
    // synthetic role gate); it has zero production route consumers.

    /**
     * Returns a pre-handler that checks the authenticated actor's EFFECTIVE
     * capability set for a Phase 3 {@link PermissionKey} (RBAC-M10-E runtime
     * authority). This is the capability gate replacing `requireRole` on
     * sensitive routes.
     *
     * Decision: consults `ctx.capabilities` — the union of every active role
     * assignment's preset, resolved at authenticate time from
     * `user_role_assignments` (NOT from `users.role` or a single primary role).
     * A multi-role actor (e.g. primary Candidate + secondary Teacher) holds the
     * union of both presets. Replies 401 if no ctx, 403 if the capability set
     * lacks the permission.
     *
     * NOTE: this base decorator is capability-only. Resource-aware checks
     * (org-anchor / ownership via resolvers) are layered on top in the route
     * preHandler chain (Step 3 resolvers) — not here.
     */
    fastify.decorate("requireCapability", (permission: PermissionKey) => {
      const preHandler: AuthzPreHandler = async (request, reply) => {
        const ctx = request.ctx;
        if (!ctx) {
          return reply
            .code(401)
            .send(buildErrorResponse(request.id, "AUTH_REQUIRED"));
        }

        if (!ctx.capabilities.includes(permission)) {
          return reply
            .code(403)
            .send(buildErrorResponse(request.id, "PERMISSION_DENIED"));
        }
      };
      preHandler.authz = { kind: "flat", permission };
      return preHandler;
    });
  };

  return authPlugin;
}

/** Default plugin instance (production wiring: real assignment loader). */
const authPlugin = buildAuthPlugin();

export default fp(authPlugin);

/**
 * Default fastify-plugin-wrapped plugin factory (production wiring). Tests
 * that need to override the assignment loader (e.g. to inject a throwing
 * stub for E14) call this and get an fp-wrapped plugin so decorators land on
 * the root instance (matching the default export's behavior).
 */
export function buildAuthPluginFp(options: AuthPluginOptions = {}) {
  return fp(buildAuthPlugin(options));
}
