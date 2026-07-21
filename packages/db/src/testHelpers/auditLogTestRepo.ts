import { randomUUID } from "node:crypto";
import type { RequestContext } from "@exam/domain";
import { auditLogs } from "../schema/pg.js";
import type { Database, TenantContext } from "../types.js";
import {
  createAuditLogQueryRepo,
  type AuditLogInsert,
} from "../repository/auditLogRepo.js";
import { resolveOrganizationId } from "../repository/baseRepo.js";

export function createAuditLogTestRepo(db: Database) {
  return {
    ...createAuditLogQueryRepo(db),
    async create(
      ctx: TenantContext | RequestContext,
      event: AuditLogInsert<string>,
    ) {
      const row = {
        id: randomUUID(),
        organizationId: resolveOrganizationId(ctx),
        actorId: event.actorId,
        action: event.action,
        targetType: event.targetType,
        targetId: event.targetId,
        metadata: event.metadata,
        ipAddress: event.ipAddress ?? null,
        userAgent: event.userAgent ?? null,
        createdAt: new Date(),
      };
      await db.insert(auditLogs).values(row);
      return row;
    },
  };
}
