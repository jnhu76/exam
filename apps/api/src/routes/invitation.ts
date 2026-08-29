import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  CreateStaffInvitationRequestSchema,
  StaffInvitationListResponseSchema,
  CreateStaffInvitationResponseSchema,
  ErrorResponseSchema,
  PaginationParamsSchema,
} from "@exam/contracts";
import { Permission } from "@exam/authz";
import { computeStaffInvitationStatus } from "@exam/domain";
import { generateToken, hashToken } from "@exam/auth/src/tokens.js";
import { createStaffInvitationRepo } from "@exam/db/src/repository/staffInvitationRepo.js";
import type { StaffInvitationRow } from "@exam/db/src/repository/staffInvitationRepo.js";
import { createEmailOutboxRepo } from "@exam/db/src/repository/emailOutboxRepo.js";
import { executeInTransaction } from "@exam/db/src/types.js";
import { ensureTargetOrg, getRequestContext } from "./helpers.js";
import { recordAtomicHttpAudit } from "../audit/auditWriter.js";
import { buildErrorResponse } from "../lib/errorResponse.js";
import { getRuntimeConfig } from "../config/runtimeConfig.js";
import { buildInviteAcceptLink } from "../identity/identityLinks.js";
import {
  INVITATION_TTL_DAYS,
  INVITATION_TTL_MS,
} from "../identity/identityPolicy.js";
import { renderStaffInvitationEmail } from "../identity/identityEmails.js";

const cookieAuth = [{ cookieAuth: [] }] as const;
const idParamsSchema = z.object({ id: z.string().uuid() });

/**
 * Maps an invitation row to its API DTO, deriving the computed lifecycle
 * status from the persisted timestamps (`fastify.now` keeps expiry tests
 * deterministic).
 */
function toInvitationDTO(row: StaffInvitationRow, now: Date) {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    status: computeStaffInvitationStatus({
      consumedAt: row.consumedAt,
      revokedAt: row.revokedAt,
      expiresAt: row.expiresAt,
      now,
    }),
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    consumedAt: row.consumedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
  };
}

/**
 * Staff invitation routes (#297).
 *
 * Provisioning authority: creating and revoking invitations both gate on
 * `UserCreate` — an invitation IS a pending account provision (the created
 * account's role is chosen at invite time), so it carries the same gate as
 * `POST /users`, not a weaker one. Listing gates on `UserView` like the user
 * list. Revocation cannot touch accepted invitations (fail-closed 404), so
 * it never mutates an account.
 */
const invitationRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post(
    "/invitations",
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireCapability(Permission.UserCreate),
      ],
      config: { rateLimit: { max: 20, timeWindow: 60 * 1000 } },
      schema: {
        body: CreateStaffInvitationRequestSchema,
        security: cookieAuth,
        "x-role": ["Admin"],
        response: { 201: CreateStaffInvitationResponseSchema },
      },
    },
    /**
     * POST /invitations — invite a staff member by email.
     *
     * One transaction commits the authoritative invitation row, the audit
     * fact, and the durable outbox row (ADR-011 §5: identity flows not
     * coupled to a business mutation may create their outbox row in their own
     * transaction). SMTP failure never rolls back the invitation; a rolled
     * back transaction never leaves an invitation without its email. The raw
     * acceptance URL is returned ONCE in the response (it is never stored —
     * only its SHA-256 hash is), so email-disabled deployments remain usable
     * (ADR-011 §12: `sent` with no provider id is not proof of delivery).
     */
    async (request, reply) => {
      const ctx = ensureTargetOrg(getRequestContext(request));
      const data = CreateStaffInvitationRequestSchema.parse(request.body);
      const email = data.email.toLowerCase();
      const rawToken = generateToken();
      const config = getRuntimeConfig();
      const now = fastify.now();
      const expiresAt = new Date(now.getTime() + INVITATION_TTL_MS);

      const invitation = await executeInTransaction(fastify.db, async (tx) => {
        const created = await createStaffInvitationRepo(
          tx,
        ).createWithinTransaction(ctx, {
          email,
          role: data.role,
          tokenHash: hashToken(rawToken),
          expiresAt,
          createdBy: ctx.actorId,
          now,
        });
        const content = renderStaffInvitationEmail({
          role: data.role,
          acceptUrl: buildInviteAcceptLink(
            rawToken,
            config.publicWebOrigin.origin,
          ),
          expiresInDays: INVITATION_TTL_DAYS,
        });
        await createEmailOutboxRepo(tx).create(ctx, {
          type: "staff_invitation",
          recipientEmail: email,
          subject: content.subject,
          bodyText: content.bodyText,
          bodyHtml: content.bodyHtml,
          maxAttempts: config.email.maxAttempts,
        });
        await recordAtomicHttpAudit(tx, request, ctx, {
          action: "user.invited",
          targetType: "staff_invitation",
          targetId: created.id,
          metadata: { invitationId: created.id, email, role: data.role },
        });
        return created;
      });

      return reply.code(201).send({
        invitation: toInvitationDTO(invitation, now),
        acceptUrl: buildInviteAcceptLink(
          rawToken,
          config.publicWebOrigin.origin,
        ),
      });
    },
  );

  fastify.get(
    "/invitations",
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireCapability(Permission.UserView),
      ],
      schema: {
        querystring: PaginationParamsSchema,
        security: cookieAuth,
        "x-role": ["Admin"],
        response: { 200: StaffInvitationListResponseSchema },
      },
    },
    /** GET /invitations — list invitations with computed lifecycle status. */
    async (request) => {
      const ctx = ensureTargetOrg(getRequestContext(request));
      const { page, pageSize } = PaginationParamsSchema.parse(request.query);
      const { items, total } = await createStaffInvitationRepo(
        fastify.db,
      ).listPaginated(ctx, { limit: pageSize, offset: (page - 1) * pageSize });
      const now = fastify.now();
      return {
        items: items.map((row) => toInvitationDTO(row, now)),
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      };
    },
  );

  fastify.delete(
    "/invitations/:id",
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireCapability(Permission.UserCreate),
      ],
      schema: {
        params: idParamsSchema,
        security: cookieAuth,
        "x-role": ["Admin"],
        response: {
          200: z.object({ ok: z.literal(true) }),
          404: ErrorResponseSchema,
        },
      },
    },
    /**
     * DELETE /invitations/:id — revoke a PENDING invitation. Missing,
     * foreign-org, and non-open invitations all fold into 404
     * (anti-enumeration): an accepted or already-revoked invitation cannot
     * be distinguished from a nonexistent one.
     */
    async (request, reply) => {
      const ctx = ensureTargetOrg(getRequestContext(request));
      const { id } = request.params as { id: string };
      const revoked = await executeInTransaction(fastify.db, async (tx) => {
        const row = await createStaffInvitationRepo(tx).revokeById(
          ctx,
          id,
          fastify.now(),
        );
        if (!row) return null;
        await recordAtomicHttpAudit(tx, request, ctx, {
          action: "user.invitation_revoked",
          targetType: "staff_invitation",
          targetId: row.id,
          metadata: { invitationId: row.id, email: row.email, role: row.role },
        });
        return row;
      });
      if (!revoked) {
        return reply
          .code(404)
          .send(buildErrorResponse(request.id, "RESOURCE_NOT_FOUND"));
      }
      return { ok: true as const };
    },
  );
};

export default invitationRoutes;
