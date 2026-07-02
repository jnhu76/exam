import { z } from "zod";
import { Permission } from "@exam/authz";
import { AuditAction } from "@exam/authz";
import type { FastifyPluginAsync } from "fastify";
import {
  ProctorAttemptListResponseSchema,
  ProctorAttemptEventListResponseSchema,
  MarkProctorIncidentRequestSchema,
  MarkProctorIncidentResponseSchema,
  ErrorResponseSchema,
} from "@exam/contracts";
import {
  ensureTargetOrg,
  getRequestContext,
  formatZodError,
} from "./helpers.js";
import { buildErrorResponse } from "../lib/errorResponse.js";
import {
  buildProctorAttemptStatuses,
  buildProctorAttemptEventTimeline,
} from "../lib/proctorMonitoringService.js";
import { createAttemptRepo } from "@exam/db/src/repository/attemptRepo.js";
import { createAuditLogRepo } from "@exam/db/src/repository/auditLogRepo.js";
import type { Database } from "@exam/db/src/types.js";

/**
 * OpenAPI security definition for cookie-based authentication.
 *
 * NAMING NOTE: "proctor" in these paths denotes the monitoring DOMAIN, not a
 * standalone role. Phase 2.1 gates these routes with Admin only (there is no
 * Proctor role yet). A formal Proctor role + proctor_assignments + scoped RBAC
 * are Phase 3. The path name is kept stable so the domain vocabulary does not
 * churn across phases.
 */
const cookieAuth = [{ cookieAuth: [] }] as const;

/** Path params for the per-exam monitoring list. */
const examIdParamsSchema = z.object({
  examId: z.string().uuid(),
});

/** Path params + querystring for the per-attempt event timeline. */
const attemptEventsParamsSchema = z.object({
  attemptId: z.string().uuid(),
});

const attemptEventsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  page: z.coerce.number().int().min(1).default(1),
});

const proctorMonitoringRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /admin/exams/:examId/proctor/attempts
   *
   * Returns the live monitoring status for every active (in_progress /
   * disrupted) attempt in the exam. Admin-only; org-scoped via the context.
   * `warningLevel` and `onlineState` are computed server-side. Response carries
   * no answer text / question content / sensitive metadata.
   */
  fastify.get(
    "/admin/exams/:examId/proctor/attempts",
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireCapability(Permission.ExamRoomView),
      ],
      schema: {
        params: examIdParamsSchema,
        security: cookieAuth,
        "x-role": ["Admin"],
        response: {
          200: ProctorAttemptListResponseSchema,
          400: ErrorResponseSchema,
          403: ErrorResponseSchema,
        },
      },
    },
    async (request) => {
      const ctx = ensureTargetOrg(getRequestContext(request));
      const { examId } = examIdParamsSchema.parse(request.params);
      const items = await buildProctorAttemptStatuses(
        fastify.db,
        ctx,
        examId,
        fastify.now(),
      );
      return { items, total: items.length };
    },
  );

  /**
   * GET /admin/attempts/:attemptId/proctor-events
   *
   * Returns the merged event timeline (client_events + audit_logs) for one
   * attempt, newest first. Admin-only; org-scoped via the context. The attempt
   * must belong to the caller's organization (404 otherwise). Each row carries
   * ONLY allowlisted metadata — the raw client_events.metadata blob is never
   * returned.
   */
  fastify.get(
    "/admin/attempts/:attemptId/proctor-events",
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireCapability(Permission.AttemptTimelineView),
      ],
      schema: {
        params: attemptEventsParamsSchema,
        querystring: attemptEventsQuerySchema,
        security: cookieAuth,
        "x-role": ["Admin"],
        response: {
          200: ProctorAttemptEventListResponseSchema,
          400: ErrorResponseSchema,
          403: ErrorResponseSchema,
          404: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const ctx = ensureTargetOrg(getRequestContext(request));
      const { attemptId } = attemptEventsParamsSchema.parse(request.params);
      const { limit, page } = attemptEventsQuerySchema.parse(request.query);

      // Verify the attempt belongs to the caller's org (cross-org → 404).
      const attemptRepo = createAttemptRepo(fastify.db);
      const attempt = await attemptRepo.findById(ctx, attemptId);
      if (!attempt) {
        return reply
          .code(404)
          .send(buildErrorResponse(request.id, "RESOURCE_NOT_FOUND"));
      }

      const { items, total } = await buildProctorAttemptEventTimeline(
        fastify.db,
        ctx,
        attemptId,
        { limit, page },
      );
      return {
        items,
        total,
        page,
        pageSize: limit,
        totalPages: total === 0 ? 0 : Math.ceil(total / limit),
      };
    },
  );

  /**
   * POST /admin/attempts/:attemptId/proctor-incident — Proctor/Admin records
   * an incident observation on an attempt. Audit-event-only storage (no
   * dedicated incident table). Payload must not contain candidate answers.
   *
   * M9 v0: lightweight incident recording only. Full proctor authority
   * boundary (force-submit, extend-time, dashboard) is L7.
   */
  fastify.post(
    "/admin/attempts/:attemptId/proctor-incident",
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireCapability(Permission.AttemptMisconductMark),
      ],
      schema: {
        params: attemptEventsParamsSchema,
        body: MarkProctorIncidentRequestSchema,
        security: cookieAuth,
        "x-role": ["Admin"],
        response: {
          200: MarkProctorIncidentResponseSchema,
          400: ErrorResponseSchema,
          403: ErrorResponseSchema,
          404: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const parsed = attemptEventsParamsSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply.code(400).send(formatZodError(request.id, parsed.error));
      }
      const body = MarkProctorIncidentRequestSchema.safeParse(
        request.body ?? {},
      );
      if (!body.success) {
        return reply.code(400).send(formatZodError(request.id, body.error));
      }
      const ctx = ensureTargetOrg(getRequestContext(request));
      const { attemptId } = parsed.data;
      const { incidentType, examId, candidateId, reasonCode, note } = body.data;

      // Verify the attempt belongs to the caller's org (cross-org → 404).
      const attemptRepo = createAttemptRepo(fastify.db);
      const attempt = await attemptRepo.findById(ctx, attemptId);
      if (!attempt) {
        return reply
          .code(404)
          .send(buildErrorResponse(request.id, "RESOURCE_NOT_FOUND"));
      }

      // Audit-event-only storage: write to audit_logs, no incident table.
      try {
        await createAuditLogRepo(fastify.db as Database).create(ctx, {
          actorId: ctx.actorId,
          action: AuditAction.ProctorIncidentMarked,
          targetType: "attempt",
          targetId: attemptId,
          metadata: {
            requestId: request.id,
            incidentType,
            examId,
            candidateId: candidateId ?? null,
            attemptId,
            reasonCode: reasonCode ?? null,
            note: note ?? null,
          },
        });
      } catch (err) {
        request.log.error(
          { err, attemptId, action: AuditAction.ProctorIncidentMarked },
          "Failed to record proctor incident audit",
        );
      }

      return reply.send({ ok: true } as const);
    },
  );
};

export default proctorMonitoringRoutes;
