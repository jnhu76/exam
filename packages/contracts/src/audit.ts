import { z } from "zod";
import { PaginationParamsSchema } from "./common.js";

/**
 * Query schema for listing audit log entries, extending pagination with an optional action filter.
 */
export const AuditLogQuerySchema = PaginationParamsSchema.extend({
  action: z.string().min(1).max(120).optional(),
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
