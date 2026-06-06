import type { SqliteDatabase } from "../sqlite.js";
import { auditLogs } from "../schema/sqlite.js";
import { createTenantCrudRepo } from "./baseRepo.js";

export function createAuditLogRepo(db: SqliteDatabase) {
  return createTenantCrudRepo(db, auditLogs);
}
