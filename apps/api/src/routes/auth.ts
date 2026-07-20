import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  LoginRequestSchema,
  LoginResponseSchema,
  MeResponseSchema,
  ChangePasswordRequestSchema,
  UpdateProfileRequestSchema,
  ErrorResponseSchema,
} from "@exam/contracts";

/** Generic success response schema used for mutation endpoints that return only a confirmation. */
const okResponseSchema = z.object({ ok: z.literal(true) });

/** OpenAPI security scheme requiring cookie-based authentication. */
const cookieAuth = [{ cookieAuth: [] }] as const;
import {
  hashPassword,
  verifyPassword,
  verifyPasswordOrDummy,
} from "@exam/auth/src/password.js";
import { signJWT, verifyJWT } from "@exam/auth/src/session.js";
import { createUserRepo } from "@exam/db/src/repository/userRepo.js";
import { createOrganizationRepo } from "@exam/db/src/repository/organizationRepo.js";
import type { PublicBrandingContext, RequestContext, Role } from "@exam/domain";
import { NotFoundError } from "@exam/domain";
import {
  buildErrorResponse,
  buildValidationErrorResponse,
} from "../lib/errorResponse.js";
import { recordAudit } from "./audit.js";
import { getRequestContext } from "./helpers.js";
import { getRuntimeConfig } from "../config/runtimeConfig.js";
import { loadAssignmentAuthority } from "../authz/assignmentAuthority.js";

/**
 * Fastify plugin that registers authentication routes.
 *
 * Provides login, logout, current-user retrieval, and password change
 * for the internal default organization. Registration is disabled in Phase 1.
 */
/** Login-capable assignable roles (RBAC runtime activation). Static. */
const ASSIGNABLE_LOGIN_ROLES = new Set([
  "Admin",
  "Teacher",
  "Proctor",
  "Grader",
  "Candidate",
]);

const authRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post(
    "/register",
    {
      schema: {
        response: {
          403: ErrorResponseSchema,
        },
      },
    },
    /**
     * POST /register — always returns 403.
     *
     * Registration is disabled in Phase 1; this endpoint exists
     * to return a clear "registration disabled" error to any client
     * that attempts self-service account creation.
     */
    async (request, reply) => {
      return reply
        .code(403)
        .send(buildErrorResponse(request.id, "AUTH_REGISTER_DISABLED"));
    },
  );

  fastify.post(
    "/login",
    {
      config: { rateLimit: { max: 10, timeWindow: 60 * 1000 } },
      schema: {
        body: LoginRequestSchema,
        response: {
          200: LoginResponseSchema,
          401: ErrorResponseSchema,
          503: ErrorResponseSchema,
        },
      },
    },
    /**
     * POST /login — authenticate a user and issue an auth-token cookie.
     *
     * Resolves the default organization, verifies credentials, and
     * signs a JWT stored in an httpOnly cookie. Only Admin and
     * Candidate roles are supported in Phase 1.
     */
    async (request, reply) => {
      const data = LoginRequestSchema.parse(request.body);
      const tenancy = getRuntimeConfig().tenancy;
      const resolvedSlug = tenancy.defaultTenantSlug;
      const userRepo = createUserRepo(fastify.db);
      let org;
      try {
        org = await createOrganizationRepo(fastify.db).resolveBrandingTenant(
          { purpose: "public_branding" } as PublicBrandingContext,
          resolvedSlug,
        );
      } catch (error) {
        if (error instanceof NotFoundError) {
          await verifyPasswordOrDummy(data.password, null);
          fastify.log.warn(
            {
              event: "login.failure",
              reason: "unknown_organization",
              organizationSlug: resolvedSlug,
              username: data.username,
            },
            "Login failed: unknown organization",
          );
          return reply
            .code(401)
            .send(buildErrorResponse(request.id, "AUTH_INVALID_CREDENTIALS"));
        }
        throw error;
      }

      const anonCtx = {
        organizationId: org.id,
        actorId: "anonymous",
        role: "Candidate" as const,
        permissions: [],
      };
      const user = await userRepo.findByOrganizationAndUsername(
        anonCtx,
        data.username,
      );

      const isPasswordValid = await verifyPasswordOrDummy(
        data.password,
        user?.isActive ? user.passwordHash : null,
      );
      if (!user?.isActive || !isPasswordValid) {
        const failureCtx: RequestContext = {
          actorId: "anonymous",
          organizationId: org.id,
          targetOrganizationId: org.id,
          role: "Candidate",
          permissions: [],
          sessionId: "anonymous",
        };
        recordAudit(
          fastify,
          request,
          failureCtx,
          "login.failure",
          "login",
          data.username,
          {
            reason: "invalid_credentials",
            username: data.username,
          },
        );
        return reply
          .code(401)
          .send(buildErrorResponse(request.id, "AUTH_INVALID_CREDENTIALS"));
      }

      // RBAC-M10-E: the actor's authority is resolved from ACTIVE
      // user_role_assignments. users.role / JWT role are NO LONGER
      // authoritative — they are compatibility projections. Login must fail
      // closed for a user with no active assignment (locked out), and must
      // surface operational / integrity failures as 503 (never 401, which
      // would hide an authz-system outage behind a credentials error; P1-3).
      const authority = await loadAssignmentAuthority(
        fastify.db,
        {
          actorId: user.id,
          organizationId: user.organizationId,
          role: user.role as Role,
          permissions: [],
          sessionId: "login",
        },
        user.id,
      );
      if (!authority.ok) {
        if (authority.reason === "no_active_assignments") {
          // Record the login failure for audit (mirrors the legacy
          // non_login_role audit shape). The response stays generic so it
          // does not leak the no-assignment reason to the client.
          const noAssignmentCtx: RequestContext = {
            actorId: user.id,
            organizationId: user.organizationId,
            targetOrganizationId: user.organizationId,
            role: user.role as Role,
            permissions: [],
            sessionId: "anonymous",
          };
          recordAudit(
            fastify,
            request,
            noAssignmentCtx,
            "login.failure",
            "login",
            user.id,
            {
              reason: "no_active_assignments",
              username: data.username,
            },
          );
          fastify.log.warn(
            {
              event: "login.failure",
              reason: "no_active_assignments",
              username: data.username,
            },
            "Login failed: user has no active role assignment",
          );
          return reply
            .code(401)
            .send(buildErrorResponse(request.id, "AUTH_INVALID_CREDENTIALS"));
        }
        fastify.log.error(
          {
            event: "login.failure",
            reason: authority.reason,
            username: data.username,
          },
          "Login failed: assignment authority resolution failed — fail closed",
        );
        return reply
          .code(503)
          .send(buildErrorResponse(request.id, "AUTHZ_UNAVAILABLE"));
      }

      const primaryRole = authority.authority.primaryRole;

      // RBAC runtime activation: only the 5 assignable human roles
      // (Admin/Teacher/Proctor/Grader/Candidate) may log in. System is the
      // synthetic non-login actor; any other/unknown role string (SuperAdmin,
      // legacy future roles, garbage) is rejected. ADR §System Actor Policy.
      // The check is against the authoritative primaryRole, not users.role.
      if (!ASSIGNABLE_LOGIN_ROLES.has(primaryRole)) {
        const blockedCtx: RequestContext = {
          actorId: user.id,
          organizationId: user.organizationId,
          targetOrganizationId: user.organizationId,
          role: primaryRole as unknown as Role,
          permissions: [],
          sessionId: "anonymous",
        };
        recordAudit(
          fastify,
          request,
          blockedCtx,
          "login.failure",
          "login",
          user.id,
          {
            reason: "non_login_role",
            username: user.username,
            role: primaryRole,
          },
        );
        fastify.log.warn(
          {
            event: "login.failure",
            reason: "non_login_role",
            username: user.username,
            role: primaryRole,
          },
          "Login failed: primary assignment role is not login-capable",
        );
        return reply
          .code(401)
          .send(buildErrorResponse(request.id, "AUTH_INVALID_CREDENTIALS"));
      }

      // JWT role claim is a compatibility projection only; it never
      // authorizes (authenticate resolves authority fresh from assignments).
      const token = signJWT(
        {
          actorId: user.id,
          role: primaryRole as Role,
          organizationId: user.organizationId,
        },
        getRuntimeConfig().authSecret.jwtSecret,
      );

      reply.setCookie("auth-token", token, {
        httpOnly: true,
        secure: getRuntimeConfig().authSecret.cookieSecure,
        sameSite: "strict",
        maxAge: 24 * 60 * 60,
        path: "/",
      });

      const successCtx: RequestContext = {
        actorId: user.id,
        organizationId: user.organizationId,
        targetOrganizationId: user.organizationId,
        role: primaryRole as Role,
        permissions: [],
        sessionId: "login",
      };
      recordAudit(
        fastify,
        request,
        successCtx,
        "login.success",
        "user",
        user.id,
        { username: user.username },
      );

      const response = LoginResponseSchema.parse({
        id: user.id,
        username: user.username,
        name: user.name,
        role: primaryRole,
        organizationId: user.organizationId,
        capabilities: authority.authority.capabilities,
      });

      return reply.code(200).send(response);
    },
  );

  fastify.post(
    "/logout",
    {
      schema: {
        response: {
          204: z.null(),
        },
      },
    },
    /**
     * POST /logout — clear the auth-token cookie and record an audit event.
     *
     * Attempts to verify the existing token for audit logging but
     * clears the cookie regardless of token validity.
     */
    async (request, reply) => {
      const token = request.cookies["auth-token"];
      if (token) {
        try {
          const payload = verifyJWT(
            token,
            getRuntimeConfig().authSecret.jwtSecret,
          );
          const ctx: RequestContext = {
            actorId: payload.actorId,
            organizationId: payload.organizationId,
            targetOrganizationId: payload.organizationId,
            role: payload.role,
            permissions: [],
            sessionId: "logout",
          };
          recordAudit(fastify, request, ctx, "logout", "user", payload.actorId);
        } catch (err) {
          fastify.log.warn(
            { err, event: "logout.invalid_token" },
            "logout: invalid or expired token",
          );
        }
      }
      reply.clearCookie("auth-token", { path: "/" });
      return reply.code(204).send();
    },
  );

  fastify.get(
    "/me",
    {
      preHandler: fastify.authenticate,
      schema: {
        security: cookieAuth,
        response: {
          200: MeResponseSchema,
          404: ErrorResponseSchema,
        },
      },
    },
    /**
     * GET /me — return the currently authenticated user's profile.
     *
     * Requires a valid auth-token cookie. Returns user id, username,
     * name, role, and organizationId, or 404 if the user no longer exists.
     */
    async (request, reply) => {
      const userRepo = createUserRepo(fastify.db);
      const ctx = getRequestContext(request);
      const user = await userRepo.findByOrganizationAndId(ctx, ctx.actorId);

      if (!user) {
        return reply
          .code(404)
          .send(buildErrorResponse(request.id, "RESOURCE_NOT_FOUND"));
      }

      const response = MeResponseSchema.parse({
        id: user.id,
        username: user.username,
        name: user.name,
        // RBAC-M10-E: role is the primary-assignment projection resolved at
        // authenticate time, NOT a fresh re-read of users.role. The two are
        // kept in sync by syncUsersRoleFromPrimary, but the authenticated ctx
        // is the authoritative projection for this response.
        role: ctx.role,
        organizationId: user.organizationId,
        // capabilities: the authoritative union resolved at authenticate time
        // from active user_role_assignments. Surfaced here (and on
        // PATCH /me/profile) so the frontend does not have to re-derive
        // visibility from presetFor(user.role) — which would hide secondary-
        // role capabilities from multi-role actors on session restore.
        capabilities: ctx.capabilities,
      });
      return reply.code(200).send(response);
    },
  );

  fastify.patch(
    "/me/password",
    {
      preHandler: fastify.authenticate,
      schema: {
        security: cookieAuth,
        body: ChangePasswordRequestSchema,
        response: {
          200: okResponseSchema,
          400: ErrorResponseSchema,
          404: ErrorResponseSchema,
        },
      },
    },
    /**
     * PATCH /me/password — change the authenticated user's password.
     *
     * Verifies the current password before hashing and persisting
     * the new one. Returns 400 if the current password is invalid,
     * or 404 if the user record is missing.
     */
    async (request, reply) => {
      const parsed = ChangePasswordRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send(buildValidationErrorResponse(request.id, parsed.error));
      }
      const { currentPassword, newPassword } = parsed.data;
      const ctx = getRequestContext(request);
      const targetCtx = {
        ...ctx,
        targetOrganizationId: ctx.targetOrganizationId ?? ctx.organizationId,
      };
      const userRepo = createUserRepo(fastify.db);
      const user = await userRepo.findByOrganizationAndId(
        targetCtx,
        targetCtx.actorId,
      );
      if (!user) {
        return reply
          .code(404)
          .send(buildErrorResponse(request.id, "RESOURCE_NOT_FOUND"));
      }

      const isValid = await verifyPassword(currentPassword, user.passwordHash);
      if (!isValid) {
        return reply
          .code(400)
          .send(buildErrorResponse(request.id, "CURRENT_PASSWORD_INVALID"));
      }

      const newHash = await hashPassword(newPassword);
      const updated = await userRepo.update(targetCtx, user.id, {
        passwordHash: newHash,
      });
      if (!updated) {
        return reply
          .code(404)
          .send(buildErrorResponse(request.id, "RESOURCE_NOT_FOUND"));
      }
      return { ok: true as const };
    },
  );

  fastify.patch(
    "/me/profile",
    {
      preHandler: fastify.authenticate,
      schema: {
        security: cookieAuth,
        body: UpdateProfileRequestSchema,
        response: {
          200: MeResponseSchema,
          400: ErrorResponseSchema,
          404: ErrorResponseSchema,
        },
      },
    },
    /**
     * PATCH /me/profile — update the authenticated user's own profile.
     *
     * Phase 1 supports editing the display name only. Returns the updated
     * user profile, or 404 if the user record is missing.
     */
    async (request, reply) => {
      const parsed = UpdateProfileRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send(buildValidationErrorResponse(request.id, parsed.error));
      }
      const { name } = parsed.data;
      const ctx = getRequestContext(request);
      const targetCtx = {
        ...ctx,
        targetOrganizationId: ctx.targetOrganizationId ?? ctx.organizationId,
      };
      const userRepo = createUserRepo(fastify.db);
      const updated = await userRepo.update(targetCtx, targetCtx.actorId, {
        name,
      });
      if (!updated) {
        return reply
          .code(404)
          .send(buildErrorResponse(request.id, "RESOURCE_NOT_FOUND"));
      }
      recordAudit(
        fastify,
        request,
        targetCtx,
        "auth.profile_update",
        "user",
        updated.id,
        { name },
      );
      const profile = {
        id: updated.id,
        username: updated.username,
        name: updated.name,
        // RBAC-M10-E: role + capabilities come from the authenticated ctx
        // (the authoritative assignment-backed projection), NOT from a fresh
        // re-read of the users row. Profile update does not change authority,
        // so the authenticated projection is correct and avoids surface area
        // where a stale users.role cache could leak into the response.
        role: ctx.role,
        organizationId: updated.organizationId,
        capabilities: ctx.capabilities,
      };
      const validated = MeResponseSchema.safeParse(profile);
      return validated.success ? validated.data : profile;
    },
  );
};

export default authRoutes;
