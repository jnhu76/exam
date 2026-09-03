import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  LoginRequestSchema,
  LoginResponseSchema,
  MeResponseSchema,
  ChangePasswordRequestSchema,
  UpdateProfileRequestSchema,
  ErrorResponseSchema,
  AcceptInvitationRequestSchema,
  AcceptInvitationResponseSchema,
  PasswordResetRequestSchema,
  PasswordResetRequestAcceptedSchema,
  PasswordResetConsumeRequestSchema,
  PasswordResetConsumeResponseSchema,
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
import { generateToken, hashToken } from "@exam/auth/src/tokens.js";
import { signJWT, verifyJWT } from "@exam/auth/src/session.js";
import { createUserRepo } from "@exam/db/src/repository/userRepo.js";
import { createUserRoleAssignmentRepo } from "@exam/db/src/repository/userRoleAssignmentRepo.js";
import { createOrganizationRepo } from "@exam/db/src/repository/organizationRepo.js";
import { createStaffInvitationRepo } from "@exam/db/src/repository/staffInvitationRepo.js";
import { createPasswordResetTokenRepo } from "@exam/db/src/repository/passwordResetTokenRepo.js";
import { createEmailOutboxRepo } from "@exam/db/src/repository/emailOutboxRepo.js";
import { executeInTransaction } from "@exam/db/src/types.js";
import type { PublicBrandingContext, RequestContext, Role } from "@exam/domain";
import { NotFoundError } from "@exam/domain";
import { mutateWithAuthorityInvariants } from "../authz/adminMaintainerExclusion.js";
import {
  buildInviteAcceptLink,
  buildPasswordResetLink,
} from "../identity/identityLinks.js";
import {
  INVITATION_TTL_DAYS,
  INVITATION_TTL_MS,
  PASSWORD_RESET_TTL_MINUTES,
  PASSWORD_RESET_TTL_MS,
  PASSWORD_RESET_COOLDOWN_MS,
} from "../identity/identityPolicy.js";
import { renderPasswordResetEmail } from "../identity/identityEmails.js";
import {
  buildErrorResponse,
  buildValidationErrorResponse,
} from "../lib/errorResponse.js";
import {
  recordAtomicHttpAudit,
  recordBestEffortAudit,
} from "../audit/auditWriter.js";
import { getRequestContext } from "./helpers.js";
import { getRuntimeConfig } from "../config/runtimeConfig.js";
import { loadAssignmentAuthority } from "../authz/assignmentAuthority.js";

/**
 * Fastify plugin that registers authentication routes.
 *
 * Provides login, logout, current-user retrieval, and password change
 * for the internal default organization. Registration is disabled in Phase 1.
 */
/**
 * Login-capable assignable roles (RBAC runtime activation). Static.
 * P7-E2A (ADR-017 D2): Maintainer is a login-capable built-in role.
 */
const ASSIGNABLE_LOGIN_ROLES = new Set([
  "Admin",
  "Teacher",
  "Proctor",
  "Grader",
  "Candidate",
  "Maintainer",
]);

/**
 * Reset-request outcomes that did NOT issue a capability. Internal audit
 * routing only — every one of them produces the same uniform HTTP response.
 */
type PasswordResetRequestRejection =
  | "unknown_user"
  | "no_email"
  | "disabled_user"
  | "cooldown";

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
              event: "security.authentication",
              outcome: "denied",
              reason: "unknown_organization",
              organizationKnown: false,
              requestId: request.id,
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
        const reason = !user
          ? "unknown_user"
          : !user.isActive
            ? "disabled_user"
            : "invalid_password";
        fastify.log.warn(
          {
            event: "security.authentication",
            outcome: "denied",
            reason,
            organizationKnown: true,
            organizationId: org.id,
            actorId: user?.id,
            requestId: request.id,
          },
          "Login denied",
        );
        const failureCtx: RequestContext = {
          actorId: user?.id ?? "anonymous",
          organizationId: org.id,
          targetOrganizationId: org.id,
          role: "Candidate",
          permissions: [],
          sessionId: "anonymous",
        };
        recordBestEffortAudit(fastify, request, failureCtx, {
          action: "login.failure",
          targetType: "login",
          targetId: user?.id ?? "anonymous",
          metadata: { reason },
        });
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
          recordBestEffortAudit(fastify, request, noAssignmentCtx, {
            action: "login.failure",
            targetType: "login",
            targetId: user.id,
            metadata: { reason: "no_active_assignments" },
          });
          fastify.log.warn(
            {
              event: "security.authentication",
              outcome: "denied",
              reason: "no_active_assignments",
              organizationKnown: true,
              organizationId: org.id,
              actorId: user.id,
              requestId: request.id,
            },
            "Login failed: user has no active role assignment",
          );
          return reply
            .code(401)
            .send(buildErrorResponse(request.id, "AUTH_INVALID_CREDENTIALS"));
        }
        if (authority.reason === "dual_admin_maintainer") {
          // P7-RBAC-REMEDIATION F-05 / ADR-017 D14: the authority kernel
          // (`deriveAssignmentAuthority`) now rejects an active set containing
          // BOTH Admin and Maintainer — the write-side seam makes this
          // unreachable through the product, but a hand-edited / bypass-written
          // row set must still fail closed at login (the union authority would
          // otherwise grant the full Admin capability set to a Maintainer
          // account). The response stays generic so it does not leak the reason.
          const excludedCtx: RequestContext = {
            actorId: user.id,
            organizationId: user.organizationId,
            targetOrganizationId: user.organizationId,
            role: user.role as Role,
            permissions: [],
            sessionId: "anonymous",
          };
          recordBestEffortAudit(fastify, request, excludedCtx, {
            action: "login.failure",
            targetType: "login",
            targetId: user.id,
            metadata: { reason: "admin_maintainer_exclusion" },
          });
          fastify.log.error(
            {
              event: "security.authentication",
              outcome: "denied",
              reason: "admin_maintainer_exclusion",
              organizationKnown: true,
              organizationId: org.id,
              actorId: user.id,
              requestId: request.id,
            },
            "Login denied: account holds both Admin and Maintainer assignments (D14 invariant violated in committed state)",
          );
          return reply
            .code(401)
            .send(buildErrorResponse(request.id, "AUTH_INVALID_CREDENTIALS"));
        }
        fastify.log.error(
          {
            event: "security.authentication",
            outcome: "error",
            reason: authority.reason,
            organizationKnown: true,
            organizationId: org.id,
            actorId: user.id,
            requestId: request.id,
          },
          "Login failed: assignment authority resolution failed — fail closed",
        );
        return reply
          .code(503)
          .send(buildErrorResponse(request.id, "AUTHZ_UNAVAILABLE"));
      }

      const primaryRole = authority.authority.primaryRole;
      const activeRoles = authority.authority.activeRoles;
      // P7-RBAC-REMEDIATION F-05: the D14 Admin↔Maintainer exclusion is now
      // enforced in the authority kernel (`deriveAssignmentAuthority`), which
      // both this login path and the per-request `authenticate` decorator
      // traverse. An active {Admin, Maintainer} set therefore returns
      // `{ ok:false, reason:"dual_admin_maintainer" }` above (401 here, 503 on
      // the authenticated-request path) — it can no longer reach this branch.

      // RBAC runtime activation: only the 6 assignable human roles
      // (Admin/Maintainer/Teacher/Proctor/Grader/Candidate) may log in. System
      // is the synthetic non-login actor; any other/unknown role string
      // (SuperAdmin, legacy future roles, garbage) is rejected. ADR §System
      // Actor Policy. The check is against the authoritative primaryRole, not
      // users.role.
      if (!ASSIGNABLE_LOGIN_ROLES.has(primaryRole)) {
        const blockedCtx: RequestContext = {
          actorId: user.id,
          organizationId: user.organizationId,
          targetOrganizationId: user.organizationId,
          role: primaryRole as unknown as Role,
          permissions: [],
          sessionId: "anonymous",
        };
        recordBestEffortAudit(fastify, request, blockedCtx, {
          action: "login.failure",
          targetType: "login",
          targetId: user.id,
          metadata: {
            reason: "non_login_role",
            role: primaryRole,
          },
        });
        fastify.log.warn(
          {
            event: "security.authentication",
            outcome: "denied",
            reason: "non_login_role",
            organizationKnown: true,
            organizationId: org.id,
            actorId: user.id,
            requestId: request.id,
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
      // #325: the token also carries the user's current credential epoch —
      // the durable revocation authority checked on every request.
      const token = signJWT(
        {
          actorId: user.id,
          role: primaryRole as Role,
          organizationId: user.organizationId,
          authEpoch: user.authEpoch,
        },
        getRuntimeConfig().authSecret.jwtSecret,
      );

      const successCtx: RequestContext = {
        actorId: user.id,
        organizationId: user.organizationId,
        targetOrganizationId: user.organizationId,
        role: primaryRole as Role,
        permissions: [],
        sessionId: "login",
      };
      fastify.log.info(
        {
          event: "security.authentication",
          outcome: "success",
          reason: "credentials_and_authority_accepted",
          organizationKnown: true,
          organizationId: org.id,
          actorId: user.id,
          requestId: request.id,
        },
        "Login accepted",
      );
      recordBestEffortAudit(fastify, request, successCtx, {
        action: "login.success",
        targetType: "user",
        targetId: user.id,
      });

      reply.setCookie("auth-token", token, {
        httpOnly: true,
        secure: getRuntimeConfig().authSecret.cookieSecure,
        sameSite: "strict",
        maxAge: 24 * 60 * 60,
        path: "/",
      });

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
     * POST /logout — revoke the presented credential epoch, then clear the
     * auth-token cookie (#325).
     *
     * Logout is intentionally callable with an absent/invalid/expired cookie
     * so the browser cookie can always be cleared: 204 in every path. Only a
     * VALID token performs durable revocation, and revocation is a CAS on
     * `users.auth_epoch` — a stale already-revoked token cannot advance the
     * authority over a newer login session. Revocation is all-tab /
     * all-device: every JWT sharing the revoked epoch becomes invalid.
     *
     * Audit records the event best-effort (valid-token paths); audit
     * availability never blocks clearing the browser cookie.
     */
    async (request, reply) => {
      const token = request.cookies["auth-token"];
      if (token) {
        try {
          const payload = verifyJWT(
            token,
            getRuntimeConfig().authSecret.jwtSecret,
          );
          // Conditional mutation: only a credential that is CURRENT at this
          // instant may advance the authority (stale-token replay against
          // /logout must not invalidate a newer session).
          let revokedEpoch: number | null = null;
          try {
            revokedEpoch = await createUserRepo(
              fastify.db,
            ).advanceAuthEpochIfCurrent(
              {
                actorId: payload.actorId,
                organizationId: payload.organizationId,
                role: payload.role,
                permissions: [],
                sessionId: "logout",
              },
              payload.actorId,
              payload.authEpoch,
            );
          } catch (err) {
            fastify.log.error(
              { err, requestId: request.id },
              "logout: epoch revocation failed",
            );
          }
          const ctx: RequestContext = {
            actorId: payload.actorId,
            organizationId: payload.organizationId,
            targetOrganizationId: payload.organizationId,
            role: payload.role,
            permissions: [],
            sessionId: "logout",
          };
          recordBestEffortAudit(fastify, request, ctx, {
            action: "logout",
            targetType: "user",
            targetId: payload.actorId,
            metadata: { revoked: revokedEpoch !== null },
          });
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
      // #325: password change revokes every existing JWT for this user —
      // hash + epoch advance are one atomic write. The current request
      // returns success but its credential is dead for the NEXT protected
      // request; the client is redirected to login by the 401.
      const updated = await executeInTransaction(fastify.db, async (tx) => {
        const changed = await createUserRepo(
          tx,
        ).updatePasswordAndAdvanceAuthEpoch(targetCtx, user.id, newHash);
        if (!changed) return null;
        await recordAtomicHttpAudit(tx, request, targetCtx, {
          action: "auth.password_update",
          targetType: "user",
          targetId: user.id,
        });
        return changed;
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
      const updated = await createUserRepo(fastify.db).update(
        targetCtx,
        targetCtx.actorId,
        { name },
      );
      if (updated) {
        recordBestEffortAudit(fastify, request, targetCtx, {
          action: "auth.profile_update",
          targetType: "user",
          targetId: updated.id,
          metadata: { changedFields: ["name"] },
        });
      }
      if (!updated) {
        return reply
          .code(404)
          .send(buildErrorResponse(request.id, "RESOURCE_NOT_FOUND"));
      }
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

  // ── Identity lifecycle (#297): invitation acceptance + email password
  // reset. All three endpoints are public (token IS the credential) and
  // per-IP rate-limited. Every mutation is a single PostgreSQL transaction:
  // token CAS consumption + authoritative state + audit fact (+ durable
  // outbox row) commit atomically; SMTP is never called here (ADR-011 §5).

  /**
   * Resolves the single default organization for public identity flows, or
   * null when the deployment has no default tenant yet (uniform failure —
   * these flows must not reveal deployment state).
   *
   * INVARIANT: only the expected "no default tenant" domain failure folds
   * into the uniform public result (mirrors POST /login). Operational or
   * programming errors propagate to the canonical error handling path — a
   * database outage must never masquerade as an invalid token or a fake
   * success.
   */
  async function resolveDefaultOrgForIdentity() {
    try {
      return await createOrganizationRepo(fastify.db).resolveBrandingTenant(
        { purpose: "public_branding" } as PublicBrandingContext,
        getRuntimeConfig().tenancy.defaultTenantSlug,
      );
    } catch (error) {
      if (error instanceof NotFoundError) return null;
      throw error;
    }
  }

  fastify.post(
    "/invitations/accept",
    {
      config: { rateLimit: { max: 10, timeWindow: 60 * 1000 } },
      schema: {
        body: AcceptInvitationRequestSchema,
        response: {
          201: AcceptInvitationResponseSchema,
          400: ErrorResponseSchema,
        },
      },
    },
    /**
     * POST /invitations/accept — consume an invitation token and activate
     * the account. The invitation CAS-consumes first; on any invalid,
     * expired, or revoked token the response is one generic 400 and no
     * state changes. Username uniqueness is enforced by the repository: a
     * conflict rolls the whole transaction back, leaving the invitation
     * open for a retry with a different username.
     *
     * The user + primary role assignment creation runs inside
     * {@link mutateWithAuthorityInvariants} — the canonical authority
     * mutation seam (org advisory lock + Admin∩Maintainer post-condition).
     * The HTTP actor is anonymous and the role was decided at invite time,
     * but account creation IS authority creation: it must traverse the same
     * fence as POST /users, never a second path.
     */
    async (request, reply) => {
      const data = AcceptInvitationRequestSchema.parse(request.body);
      const passwordHash = await hashPassword(data.password);
      const org = await resolveDefaultOrgForIdentity();
      if (!org) {
        return reply
          .code(400)
          .send(buildErrorResponse(request.id, "INVITATION_INVALID"));
      }
      const anonCtx = {
        organizationId: org.id,
        actorId: "anonymous",
        role: "Candidate" as Role,
        permissions: [],
        sessionId: "anonymous",
      };

      const created = await mutateWithAuthorityInvariants(
        fastify.db,
        anonCtx,
        async (tx) => {
          const invitation = await createStaffInvitationRepo(
            tx,
          ).consumeByTokenHashWithinTransaction(
            anonCtx,
            hashToken(data.token),
            fastify.now(),
          );
          if (!invitation) return null;

          const user = await createUserRepo(tx).createUnique(anonCtx, {
            username: data.username,
            passwordHash,
            name: data.name,
            role: invitation.role,
            isActive: true,
            email: invitation.email,
          });
          await createUserRoleAssignmentRepo(tx).assignWithinTransaction(
            tx,
            anonCtx,
            {
              userId: user.id,
              role: invitation.role,
              isPrimary: true,
              isActive: true,
            },
          );
          await recordAtomicHttpAudit(tx, request, anonCtx, {
            action: "user.invitation_accepted",
            targetType: "user",
            targetId: user.id,
            metadata: {
              invitationId: invitation.id,
              email: invitation.email,
              role: invitation.role,
              userId: user.id,
            },
          });
          return user;
        },
      );

      if (!created) {
        return reply
          .code(400)
          .send(buildErrorResponse(request.id, "INVITATION_INVALID"));
      }
      return reply.code(201).send({
        user: {
          id: created.id,
          username: created.username,
          name: created.name,
          role: created.role,
        },
      });
    },
  );

  fastify.post(
    "/password-reset/request",
    {
      config: { rateLimit: { max: 5, timeWindow: 10 * 60 * 1000 } },
      schema: {
        body: PasswordResetRequestSchema,
        response: { 200: PasswordResetRequestAcceptedSchema },
      },
    },
    /**
     * POST /password-reset/request — begin an email password reset.
     *
     * The response is CONSTANT for every input (anti-enumeration): account
     * unknown, no email on file, account disabled, cooldown, and success all
     * return `{ ok: true }`.
     *
     * LOCK ORDER: the transaction locks the user row FIRST (canonical order
     * USER → PASSWORD_RESET_TOKEN(S) → credential mutation — see
     * passwordResetTokenRepo) and re-evaluates EVERY gate under that lock:
     * existence, organization, active state, cooldown, email eligibility.
     * A user snapshot read before the transaction is never trusted, so an
     * in-flight issuance cannot interleave between a deactivation commit
     * and its own token insert (deactivation burns what issuance wins; a
     * committed deactivation fail-closes what issuance would issue).
     *
     * Issuing a reset capability is an authority-grade credential fact: the
     * atomic audit row commits in the same transaction as token + outbox.
     * Rejected/burst observations are best-effort under the separate
     * `auth.password_reset_request_rejected` action. The actor on both is
     * the anonymous HTTP requester — never the target account.
     */
    async (request, reply) => {
      const data = PasswordResetRequestSchema.parse(request.body);
      const uniform = () => reply.code(200).send({ ok: true as const });
      const org = await resolveDefaultOrgForIdentity();
      if (!org) return uniform();
      const anonCtx = {
        organizationId: org.id,
        actorId: "anonymous",
        role: "Candidate" as Role,
        permissions: [],
        sessionId: "anonymous",
      };

      const rawToken = generateToken();
      const config = getRuntimeConfig();
      const content = renderPasswordResetEmail({
        resetUrl: buildPasswordResetLink(
          rawToken,
          config.publicWebOrigin.origin,
        ),
        expiresInMinutes: PASSWORD_RESET_TTL_MINUTES,
      });

      // "read committed" is LOAD-BEARING (same rationale as
      // mutateWithAuthorityInvariants / mutateWithEffectiveAdminPostcondition):
      // the transaction blocks on the user row lock held by a concurrent
      // deactivation and must see the POST-wait committed account state when
      // it revalidates. Under the default repeatable read its snapshot would
      // predate that deactivation and a disabled account could receive a
      // fresh reset capability.
      const result = await executeInTransaction(
        fastify.db,
        async (
          tx,
        ): Promise<{
          outcome: "issued" | PasswordResetRequestRejection;
          userId: string | null;
        }> => {
          // First statement of the transaction: acquire the user row lock
          // (canonical order), then revalidate everything under it.
          const locked = await createUserRepo(
            tx,
          ).lockByUsernameWithinTransaction(anonCtx, data.username);
          if (!locked) return { outcome: "unknown_user", userId: null };
          if (!locked.isActive) {
            return { outcome: "disabled_user", userId: locked.id };
          }
          if (!locked.email) return { outcome: "no_email", userId: locked.id };
          const latest = await createPasswordResetTokenRepo(
            tx,
          ).getLatestCreatedAt(anonCtx, locked.id);
          if (
            latest &&
            fastify.now().getTime() - latest.getTime() <
              PASSWORD_RESET_COOLDOWN_MS
          ) {
            return { outcome: "cooldown", userId: locked.id };
          }

          const recipientEmail = locked.email;
          await createPasswordResetTokenRepo(tx).issueWithinTransaction(
            anonCtx,
            {
              userId: locked.id,
              tokenHash: hashToken(rawToken),
              expiresAt: new Date(
                fastify.now().getTime() + PASSWORD_RESET_TTL_MS,
              ),
              now: fastify.now(),
            },
          );
          await createEmailOutboxRepo(tx).create(anonCtx, {
            type: "password_reset",
            recipientEmail,
            subject: content.subject,
            bodyText: content.bodyText,
            bodyHtml: content.bodyHtml,
            maxAttempts: config.email.maxAttempts,
            recipientUserId: locked.id,
          });
          await recordAtomicHttpAudit(tx, request, anonCtx, {
            action: "auth.password_reset_requested",
            targetType: "user",
            targetId: locked.id,
            metadata: { outcome: "issued" },
          });
          return { outcome: "issued", userId: locked.id };
        },
        "read committed",
      );

      if (result.outcome !== "issued") {
        recordBestEffortAudit(fastify, request, anonCtx, {
          action: "auth.password_reset_request_rejected",
          targetType: "user",
          targetId: result.userId ?? "anonymous",
          metadata: { outcome: result.outcome },
        });
      }
      return uniform();
    },
  );

  fastify.post(
    "/password-reset/consume",
    {
      config: { rateLimit: { max: 10, timeWindow: 60 * 1000 } },
      schema: {
        body: PasswordResetConsumeRequestSchema,
        response: {
          200: PasswordResetConsumeResponseSchema,
          400: ErrorResponseSchema,
        },
      },
    },
    /**
     * POST /password-reset/consume — set a new password with a reset token.
     *
     * LOCK ORDER: the transaction first identifies the token's owner with a
     * read-only lookup (no mutation, no locks), then locks the USER row —
     * the canonical USER → PASSWORD_RESET_TOKEN(S) → credential mutation
     * order — and only then CAS-consumes the token and writes the new
     * password + auth epoch. Because deactivation takes the same order
     * (user row first, then token burn), the two commands serialize without
     * any retry layer: if deactivation commits first the reset fails
     * closed; if the reset commits first the subsequent deactivation still
     * deactivates the account and advances the epoch, so both final states
     * are safe and no schedule can deadlock.
     *
     * Concurrent double-submit yields exactly one success; expired,
     * consumed, revoked-by-deactivation, and unknown tokens are one generic
     * 400.
     */
    async (request, reply) => {
      const data = PasswordResetConsumeRequestSchema.parse(request.body);
      const passwordHash = await hashPassword(data.password);
      const org = await resolveDefaultOrgForIdentity();
      if (!org) {
        return reply
          .code(400)
          .send(buildErrorResponse(request.id, "PASSWORD_RESET_INVALID"));
      }
      const anonCtx = {
        organizationId: org.id,
        actorId: "anonymous",
        role: "Candidate" as Role,
        permissions: [],
        sessionId: "anonymous",
      };

      // "read committed" is LOAD-BEARING (see the reset-request handler):
      // the consume must observe the freshest committed account state after
      // its user-row-lock wait so a concurrently committed deactivation
      // fail-closes the reset, and deactivation must see tokens this
      // transaction commits if it follows us.
      const reset = await executeInTransaction(
        fastify.db,
        async (tx) => {
          const tokenRepo = createPasswordResetTokenRepo(tx);
          // 1. Identify the owner without mutating state (advisory only).
          const identified = await tokenRepo.findOpenUserIdByTokenHash(
            anonCtx,
            hashToken(data.token),
            fastify.now(),
          );
          if (!identified) return null;
          // 2. Acquire the user row lock (canonical order) and revalidate the
          // account state under it.
          const locked = await createUserRepo(tx).lockByIdWithinTransaction(
            anonCtx,
            identified.userId,
          );
          if (!locked || !locked.isActive) return null;
          // 3. CAS-consume under the user lock; the statement re-checks the
          // full open/unexpired/active predicate (defense in depth).
          const consumed =
            await tokenRepo.consumeByTokenHashForUserWithinTransaction(
              anonCtx,
              { tokenHash: hashToken(data.token), userId: identified.userId },
              fastify.now(),
            );
          if (!consumed) return null;
          const tokenCtx = {
            organizationId: consumed.organizationId,
            actorId: consumed.userId,
            role: "Candidate" as Role,
            permissions: [],
            sessionId: "anonymous",
          };
          const updated = await createUserRepo(
            tx,
          ).updatePasswordAndAdvanceAuthEpoch(
            tokenCtx,
            consumed.userId,
            passwordHash,
          );
          if (!updated) return null;
          await recordAtomicHttpAudit(tx, request, tokenCtx, {
            action: "auth.password_reset",
            targetType: "user",
            targetId: consumed.userId,
          });
          return updated;
        },
        "read committed",
      );

      if (!reset) {
        return reply
          .code(400)
          .send(buildErrorResponse(request.id, "PASSWORD_RESET_INVALID"));
      }
      return reply.code(200).send({ ok: true as const });
    },
  );
};

export default authRoutes;
