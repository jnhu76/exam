import { z } from "zod";
import { PaginationParamsSchema } from "./common.js";

/**
 * Query schema for listing audit log entries, extending pagination with
 * optional action / targetType string filters and an inclusive `createdAt`
 * date range (`from` / `to` as ISO 8601 datetime strings).
 *
 * - `action`, `targetType`: exact-match filters.
 * - `from`: inclusive lower bound on `createdAt` (ISO datetime, e.g.
 *   `2026-01-01T00:00:00.000Z`).
 * - `to`: inclusive upper bound on `createdAt` (ISO datetime).
 *
 * The route parses `from`/`to` into JS `Date` objects before reaching the repo.
 * A bare date (`2026-01-01`) is rejected on purpose so callers must supply an
 * unambiguous instant.
 */
export const AuditLogQuerySchema = PaginationParamsSchema.extend({
  action: z.string().min(1).max(120).optional(),
  targetType: z.string().min(1).max(120).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

/** Type for audit log listing query parameters. */
export type AuditLogQuery = z.infer<typeof AuditLogQuerySchema>;

/**
 * Response schema for a single audit log entry, recording an actor's action on a target resource.
 */
export const AuditLogResponseSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  actorId: z.string(),
  action: z.string(),
  targetType: z.string(),
  targetId: z.string(),
  metadata: z.record(z.string(), z.unknown()),
  ipAddress: z.string().nullable(),
  userAgent: z.string().nullable(),
  createdAt: z.string().datetime(),
});

/** Type for a single audit log entry. */
export type AuditLogResponse = z.infer<typeof AuditLogResponseSchema>;

/**
 * Response schema for a single timeline event. A timeline event is a
 * projection of an audit log entry scoped to one attempt target; the shape
 * is identical to `AuditLogResponseSchema`.
 */
export const AttemptTimelineEventSchema = AuditLogResponseSchema;

/** Type for a single timeline event. */
export type AttemptTimelineEvent = z.infer<typeof AttemptTimelineEventSchema>;

/**
 * Response schema for `GET /api/admin/attempts/:attemptId/timeline`: the
 * ordered list of audit-log events for one attempt, oldest-first.
 */
export const AttemptTimelineResponseSchema = z.object({
  events: z.array(AttemptTimelineEventSchema),
});

/** Type for the attempt timeline response. */
export type AttemptTimelineResponse = z.infer<
  typeof AttemptTimelineResponseSchema
>;
