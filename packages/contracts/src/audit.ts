import { z } from "zod";
import { PaginationParamsSchema } from "./common.js";

export const AuditLogQuerySchema = PaginationParamsSchema.extend({
  action: z.string().min(1).max(120).optional(),
});
export type AuditLogQuery = z.infer<typeof AuditLogQuerySchema>;

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
  createdAt: z.string(),
});
export type AuditLogResponse = z.infer<typeof AuditLogResponseSchema>;
