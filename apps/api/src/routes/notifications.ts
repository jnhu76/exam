import { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import {
  NotificationListQuerySchema,
  NotificationListResponseSchema,
  NotificationSchema,
  UnreadCountResponseSchema,
  ErrorResponseSchema,
} from "@exam/contracts";
import { createNotificationRepo } from "@exam/db/src/repository/notificationRepo.js";
import { buildErrorResponse } from "../lib/errorResponse.js";
import { getRequestContext } from "./helpers.js";

// P5-N1-I3 — Notification Inbox API routes (V1: result_published only).
//
// Authority: P5-N1-R0 §19 (frozen V1 API contract).
//
// All four endpoints are authenticate-only (no requireCapability) — the
// Inbox is the authenticated user's own. Scope derives from ctx
// (organizationId + actorId); clients NEVER pass organizationId or
// recipientUserId. Cross-user access returns a non-leaking 404
// (anti-enumeration, same message for missing and foreign).

/** OpenAPI security scheme requiring cookie-based authentication. */
const cookieAuth = [{ cookieAuth: [] }] as const;

/** Zod schema for route params containing a UUID `id`. */
const idParamsSchema = z.object({ id: z.string().uuid() });

/** Maps a persisted notification row to the API DTO shape. */
function toDTO(row: {
  id: string;
  organizationId: string;
  recipientUserId: string;
  type: string;
  title: string;
  body: string;
  actionPath: string | null;
  createdAt: Date;
  readAt: Date | null;
}) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    recipientUserId: row.recipientUserId,
    type: row.type,
    title: row.title,
    body: row.body,
    actionPath: row.actionPath,
    createdAt: row.createdAt.toISOString(),
    readAt: row.readAt ? row.readAt.toISOString() : null,
  };
}

/**
 * Fastify plugin that registers the candidate Inbox routes.
 *
 * Routes (all authenticate-only, scoped to the actor's own notifications):
 *   GET  /notifications             — paginated list (offset/page)
 *   GET  /notifications/unread-count — bell badge count
 *   POST /notifications/:id/read    — mark one read (idempotent)
 *   POST /notifications/read-all    — mark all unread read
 */
const notificationRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    "/notifications",
    {
      preHandler: fastify.authenticate,
      schema: {
        querystring: NotificationListQuerySchema,
        security: cookieAuth,
        response: {
          200: NotificationListResponseSchema,
          400: ErrorResponseSchema,
        },
      },
    },
    /**
     * GET /notifications — list the authenticated user's own Inbox.
     *
     * Pagination reuses PaginationParamsSchema (page/pageSize, default 20,
     * max 100). Optional ?unread=true filters server-side. Stable order:
     * created_at DESC, id DESC. Scope derives from ctx; the recipientUserId
     * is the actor — clients never pass it.
     */
    async (request) => {
      const ctx = getRequestContext(request);
      const query = NotificationListQuerySchema.parse(request.query);
      const repo = createNotificationRepo(fastify.db);
      const { items, total } = await repo.list(ctx, ctx.actorId, {
        page: query.page,
        pageSize: query.pageSize,
        unreadOnly: query.unread === "true",
      });
      return {
        items: items.map(toDTO),
        total,
        page: query.page,
        pageSize: query.pageSize,
        totalPages: Math.ceil(total / query.pageSize),
      };
    },
  );

  fastify.get(
    "/notifications/unread-count",
    {
      preHandler: fastify.authenticate,
      schema: {
        security: cookieAuth,
        response: { 200: UnreadCountResponseSchema },
      },
    },
    /**
     * GET /notifications/unread-count — bell badge count.
     *
     * Counts rows with read_at IS NULL scoped to (org, actor).
     */
    async (request) => {
      const ctx = getRequestContext(request);
      const repo = createNotificationRepo(fastify.db);
      const count = await repo.countUnread(ctx, ctx.actorId);
      return { count };
    },
  );

  fastify.post(
    "/notifications/:id/read",
    {
      preHandler: fastify.authenticate,
      schema: {
        params: idParamsSchema,
        security: cookieAuth,
        response: {
          200: NotificationSchema,
          404: ErrorResponseSchema,
        },
      },
    },
    /**
     * POST /notifications/:id/read — mark one notification read.
     *
     * Idempotent: a repeat call on an already-read row is a 200 no-op that
     * returns the row unchanged. Returns 404 for a missing OR foreign
     * notification (anti-enumeration: same response for both).
     */
    async (request: FastifyRequest, reply: FastifyReply) => {
      const ctx = getRequestContext(request);
      const { id } = request.params as { id: string };
      const repo = createNotificationRepo(fastify.db);
      const updated = await repo.markRead(ctx, ctx.actorId, id);
      if (!updated) {
        return reply
          .code(404)
          .send(buildErrorResponse(request.id, "RESOURCE_NOT_FOUND"));
      }
      return toDTO(updated);
    },
  );

  fastify.post(
    "/notifications/read-all",
    {
      preHandler: fastify.authenticate,
      schema: {
        security: cookieAuth,
        response: {
          200: z.object({ updated: z.number().int().min(0) }),
        },
      },
    },
    /**
     * POST /notifications/read-all — mark all unread notifications read.
     *
     * Scoped to (org, actor). Returns the number of rows updated.
     */
    async (request) => {
      const ctx = getRequestContext(request);
      const repo = createNotificationRepo(fastify.db);
      const updated = await repo.markAllRead(ctx, ctx.actorId);
      return { updated };
    },
  );
};

export default notificationRoutes;
